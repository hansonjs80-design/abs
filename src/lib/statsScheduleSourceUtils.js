import { supabase } from './supabaseClient.js';
import { getVisibleShockwaveScheduleMonths, mapShockwaveScheduleItemToVisibleMonth } from './shockwaveScheduleDateMapping.js';
import {
  getShockwaveScheduleBaseRowCount,
  relocateHiddenMergedScheduleRows,
} from './scheduleHiddenCellRelocationUtils.js';
import { sanitizeShockwaveScheduleItemForDisplay } from './shockwaveScheduleSanitize.js';

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

function getUpdatedAtTime(item) {
  const time = item?.updated_at ? Date.parse(item.updated_at) : 0;
  return Number.isFinite(time) ? time : 0;
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
  const visibleRows = [];
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    if (!hasStatsScheduleMemoPayload(row)) return;
    const visible = mapShockwaveScheduleItemToVisibleMonth(row, year, month);
    if (visible) visibleRows.push(visible);
  });

  const relocation = relocateHiddenMergedScheduleRows(visibleRows, {
    rowCount: getShockwaveScheduleBaseRowCount(settings, year, month),
  });

  return (relocation.rows || []).reduce((memoMap, row) => {
    if (!hasStatsScheduleMemoPayload(row)) return memoMap;
    const visible = sanitizeShockwaveScheduleItemForDisplay(row);
    if (!visible || !hasStatsScheduleMemoPayload(visible)) return memoMap;
    const key = getScheduleCellKey(visible);
    const existing = memoMap[key];
    if (!existing || getUpdatedAtTime(visible) >= getUpdatedAtTime(existing)) {
      memoMap[key] = visible;
    }
    return memoMap;
  }, {});
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
  const visibleMonths = getVisibleShockwaveScheduleMonths(year, month);
  const results = await Promise.allSettled(
    visibleMonths.map((target) => fetchShockwaveScheduleRowsForStorageMonth(target))
  );

  const currentIndex = visibleMonths.findIndex(
    (target) => Number(target.year) === Number(year) && Number(target.month) === Number(month)
  );
  const currentResult = results[currentIndex];
  if (currentResult?.status === 'rejected') {
    throw currentResult.reason;
  }

  const rows = results.flatMap((result, index) => {
    if (result.status === 'fulfilled') return result.value || [];
    const target = visibleMonths[index];
    console.warn(`Failed to load adjacent schedule month for stats ${target.year}-${target.month}; continuing without it.`, result.reason);
    return [];
  });

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
