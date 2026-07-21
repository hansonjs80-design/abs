import { supabase } from './supabaseClient.js';
import { mapShockwaveScheduleItemToCurrentMonthView } from './shockwaveScheduleDateMapping.js';
import {
  getPrescriptionScheduleSettings,
  isInactiveLegacyManualDoseScheduleItem,
} from './prescriptionScheduleSettings.js';
import {
  getShockwaveScheduleBaseRowCount,
  relocateHiddenMergedScheduleRows,
} from './scheduleHiddenCellRelocationUtils.js';
import { sanitizeShockwaveScheduleItemForDisplay } from './shockwaveScheduleSanitize.js';
import { getExplicitVisitSuffix, parseSchedulerPatientIdentity } from './schedulerCellTextUtils.js';

const SCHEDULE_STATS_QUERY_TIMEOUT_MS = 15000;

function withScheduleStatsQueryTimeout(queryPromise, label, timeoutMs = SCHEDULE_STATS_QUERY_TIMEOUT_MS) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} query timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([
    Promise.resolve(queryPromise),
    timeoutPromise,
  ]).finally(() => {
    clearTimeout(timeoutId);
  });
}

function hasStatsScheduleMemoPayload(memo) {
  if (!memo) return false;
  if (String(memo.content || '').trim()) return true;
  if (String(memo.body_part || '').trim()) return true;
  if (String(memo.prescription || '').trim()) return true;
  if (memo.bg_color !== undefined && memo.bg_color !== null && memo.bg_color !== '') return true;

  const merge = memo.merge_span;
  if (Array.isArray(merge?.meta?.memo_list) && merge.meta.memo_list.some((item) => String(item || '').trim())) return true;
  if (Array.isArray(merge?.meta?.body_part_options) && merge.meta.body_part_options.some((item) => String(item || '').trim())) return true;
  return Boolean(
    merge &&
    (
      (merge.rowSpan && merge.rowSpan !== 1) ||
      (merge.colSpan && merge.colSpan !== 1) ||
      merge.mergedInto
    )
  );
}

function getScheduleCellKey(item) {
  return `${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`;
}

function parseScheduleCellKey(key) {
  const [weekIndex, dayIndex, rowIndex, colIndex] = String(key || '').split('-').map(Number);
  return { weekIndex, dayIndex, rowIndex, colIndex };
}

function buildCoveredCellKeys(rows) {
  const covered = new Set();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const mergeSpan = row?.merge_span || {};
    if (mergeSpan.mergedInto) return;

    const rowSpan = Math.max(1, Number(mergeSpan.rowSpan) || 1);
    const colSpan = Math.max(1, Number(mergeSpan.colSpan) || 1);
    if (rowSpan <= 1 && colSpan <= 1) return;

    const masterKey = getScheduleCellKey(row);
    const { weekIndex, dayIndex, rowIndex, colIndex } = parseScheduleCellKey(masterKey);
    if (![weekIndex, dayIndex, rowIndex, colIndex].every(Number.isFinite)) return;

    for (let r = rowIndex; r < rowIndex + rowSpan; r += 1) {
      for (let c = colIndex; c < colIndex + colSpan; c += 1) {
        const key = `${weekIndex}-${dayIndex}-${r}-${c}`;
        if (key !== masterKey) covered.add(key);
      }
    }
  });
  return covered;
}

function getUpdatedAtTime(item) {
  const time = item?.updated_at ? Date.parse(item.updated_at) : 0;
  return Number.isFinite(time) ? time : 0;
}

function normalizeStatsComparableText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeStatsPatientName(value) {
  return normalizeStatsComparableText(value).replace(/\*/g, '');
}

function getStatsTreatmentValue(item, field) {
  const directValue = normalizeStatsComparableText(item?.[field]);
  if (directValue) return directValue;

  if (field === 'body_part') {
    const options = item?.merge_span?.meta?.body_part_options;
    if (Array.isArray(options)) {
      return options
        .map(normalizeStatsComparableText)
        .filter(Boolean)
        .join('|');
    }
  }

  return '';
}

function getStatsPatientGroupKey(key, item) {
  const { weekIndex, dayIndex, colIndex } = parseScheduleCellKey(key);
  if (![weekIndex, dayIndex, colIndex].every(Number.isFinite)) return '';

  const parsed = parseSchedulerPatientIdentity(item?.content || '');
  const chart = normalizeStatsComparableText(parsed?.patientChart);
  const name = normalizeStatsPatientName(parsed?.patientName);
  const identity = chart || name;
  if (!identity) return '';

  return [
    weekIndex,
    dayIndex,
    colIndex,
    identity,
    getStatsTreatmentValue(item, 'prescription'),
    getStatsTreatmentValue(item, 'body_part'),
  ].join('|');
}

function isStarVisitScheduleItem(item) {
  const suffix = getExplicitVisitSuffix(item?.content || '');
  return suffix === '*' || suffix === '(*)';
}

function removeStaleStarVisitDuplicates(memoMap) {
  const grouped = new Map();
  Object.entries(memoMap || {}).forEach(([key, item]) => {
    if (!hasStatsScheduleMemoPayload(item)) return;
    const groupKey = getStatsPatientGroupKey(key, item);
    if (!groupKey) return;
    const entries = grouped.get(groupKey) || [];
    entries.push({ key, item, isStarVisit: isStarVisitScheduleItem(item) });
    grouped.set(groupKey, entries);
  });

  const keysToRemove = new Set();
  grouped.forEach((entries) => {
    const hasNonStarVisit = entries.some((entry) => !entry.isStarVisit);
    if (!hasNonStarVisit) return;
    entries.forEach((entry) => {
      if (entry.isStarVisit) keysToRemove.add(entry.key);
    });
  });

  if (keysToRemove.size === 0) return memoMap;
  const nextMemoMap = { ...memoMap };
  keysToRemove.forEach((key) => {
    delete nextMemoMap[key];
  });
  return nextMemoMap;
}

export function getRecentScheduleMonthTargets({ currentYear, currentMonth, recentPeriodMonths }) {
  const period = Math.max(1, Number.parseInt(String(recentPeriodMonths || 1), 10) || 1);
  const targets = [];

  for (let index = period - 1; index >= 0; index -= 1) {
    const targetDate = new Date(Number(currentYear), Number(currentMonth) - 1 - index, 1);
    targets.push({
      year: targetDate.getFullYear(),
      month: targetDate.getMonth() + 1,
    });
  }

  return targets;
}

export function buildScheduleMemoSignature(memos) {
  const entries = Object.entries(memos || {})
    .filter(([, memo]) => hasStatsScheduleMemoPayload(memo))
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey, undefined, { numeric: true }))
    .map(([key, memo]) => [
      key,
      memo?.content || '',
      memo?.bg_color || '',
      memo?.prescription || '',
      memo?.body_part || '',
      memo?.updated_at || '',
      memo?.merge_span ? JSON.stringify(memo.merge_span) : '',
    ]);

  return entries.length > 0 ? JSON.stringify(entries) : 'empty';
}

export function buildScheduleMemoMapForStats(rows, { year, month, settings = {} } = {}) {
  const prescriptionScheduleSettings = getPrescriptionScheduleSettings(settings, year, month);
  const visibleRows = [];
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    if (!hasStatsScheduleMemoPayload(row)) return;
    const visible = mapShockwaveScheduleItemToCurrentMonthView(row, year, month);
    if (isInactiveLegacyManualDoseScheduleItem(visible, prescriptionScheduleSettings)) return;
    if (visible) visibleRows.push(visible);
  });

  const relocation = relocateHiddenMergedScheduleRows(visibleRows, {
    rowCount: getShockwaveScheduleBaseRowCount(settings, year, month),
  });
  const coveredKeys = buildCoveredCellKeys(relocation.rows);

  const memoMap = (relocation.rows || []).reduce((nextMemoMap, row) => {
    if (!hasStatsScheduleMemoPayload(row)) return nextMemoMap;
    const visible = sanitizeShockwaveScheduleItemForDisplay(row);
    if (!visible || !hasStatsScheduleMemoPayload(visible)) return nextMemoMap;
    const key = getScheduleCellKey(visible);
    if (coveredKeys.has(key)) return nextMemoMap;
    const existing = nextMemoMap[key];
    if (!existing || getUpdatedAtTime(visible) >= getUpdatedAtTime(existing)) {
      nextMemoMap[key] = visible;
    }
    return nextMemoMap;
  }, {});

  return removeStaleStarVisitDuplicates(memoMap);
}

async function fetchShockwaveScheduleRowsForStorageMonth({ year, month }) {
  const rows = [];
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await withScheduleStatsQueryTimeout(
      supabase
        .from('shockwave_schedules')
        .select('*')
        .eq('year', year)
        .eq('month', month)
        .range(page * 1000, (page + 1) * 1000 - 1),
      `shockwave_schedules stats source ${year}-${month} page ${page + 1}`
    );

    if (error) throw error;
    if (Array.isArray(data)) rows.push(...data);
    hasMore = Array.isArray(data) && data.length >= 1000;
    page += 1;
  }

  return rows;
}

export async function loadScheduleMemosForStatsMonth({ year, month, settings = {} }) {
  const rows = await fetchShockwaveScheduleRowsForStorageMonth({ year, month });

  return buildScheduleMemoMapForStats(rows, { year, month, settings });
}

async function fetchActiveTherapistsForStats(type) {
  const tableName = type === 'manual_therapy' ? 'manual_therapy_therapists' : 'shockwave_therapists';
  const { data, error } = await withScheduleStatsQueryTimeout(
    supabase
      .from(tableName)
      .select('*')
      .eq('is_active', true)
      .order('slot_index'),
    `${tableName} stats fallback`
  );

  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

function buildMonthlyTherapistRowsFromRoster({ year, month, type, roster }) {
  const lastDay = new Date(year, month, 0).getDate();
  return (Array.isArray(roster) ? roster : []).map((therapist, index) => ({
    slot_index: Number.isInteger(Number(therapist?.slot_index)) ? Number(therapist.slot_index) : index,
    therapist_name: therapist?.therapist_name || therapist?.name || '',
    start_day: 1,
    end_day: lastDay,
    year,
    month,
    type,
  }));
}

export async function loadStatsMonthlyTherapists({
  year,
  month,
  type = 'shockwave',
  baseTherapists = [],
} = {}) {
  const { data, error } = await withScheduleStatsQueryTimeout(
    supabase
      .from('shockwave_monthly_therapists')
      .select('*')
      .eq('year', year)
      .eq('month', month)
      .eq('type', type)
      .order('slot_index')
      .order('start_day'),
    `shockwave_monthly_therapists stats ${type} ${year}-${month}`
  );

  if (error) throw error;
  if (Array.isArray(data) && data.length > 0) return data;

  const currentValue = Number(year) * 12 + Number(month);
  const { data: previousRows, error: previousError } = await withScheduleStatsQueryTimeout(
    supabase
      .from('shockwave_monthly_therapists')
      .select('*')
      .eq('type', type)
      .gte('year', Number(year) - 1)
      .order('year', { ascending: false })
      .order('month', { ascending: false })
      .order('slot_index')
      .order('start_day')
      .limit(50),
    `shockwave_monthly_therapists stats previous ${type} ${year}-${month}`
  );

  if (!previousError && Array.isArray(previousRows) && previousRows.length > 0) {
    const previousMonths = previousRows.filter((item) => {
      const itemValue = Number(item.year) * 12 + Number(item.month);
      return Number.isFinite(itemValue) && itemValue < currentValue;
    });
    const inheritedValue = previousMonths.reduce((max, item) => {
      const value = Number(item.year) * 12 + Number(item.month);
      return Math.max(max, value);
    }, -Infinity);
    const inheritedRows = previousMonths.filter((item) => {
      const value = Number(item.year) * 12 + Number(item.month);
      return value === inheritedValue;
    });

    if (inheritedRows.length > 0) {
      const slotMap = new Map();
      inheritedRows.forEach((item) => {
        const existing = slotMap.get(item.slot_index);
        if (!existing || Number(item.start_day) > Number(existing.start_day)) {
          slotMap.set(item.slot_index, item);
        }
      });
      return buildMonthlyTherapistRowsFromRoster({
        year,
        month,
        type,
        roster: Array.from(slotMap.values()),
      });
    }
  } else if (previousError) {
    console.warn(`Failed to load previous monthly therapists for stats ${type} ${year}-${month}; using roster fallback.`, previousError);
  }

  const fallbackRoster = Array.isArray(baseTherapists) && baseTherapists.length > 0
    ? baseTherapists
    : await fetchActiveTherapistsForStats(type);

  return buildMonthlyTherapistRowsFromRoster({
    year,
    month,
    type,
    roster: fallbackRoster,
  });
}
