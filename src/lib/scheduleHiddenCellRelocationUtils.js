import { getDateOverridesForMonth, getMonthlyDayOverrides } from './schedulerOperatingHours.js';
import { getScheduleDisplaySlotMinutes } from './schedulerUtils.js';

const DEFAULT_MERGE_SPAN = { rowSpan: 1, colSpan: 1, mergedInto: null };
const RELOCATED_FROM_META_KEY = 'relocated_from_hidden_merge_cell';
const DEFAULT_START_TIME = '09:00';
const DEFAULT_END_TIME = '18:00';

function normalizeTime(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return '';
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return '';
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return '';
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function timeToMinutes(value) {
  const normalized = normalizeTime(value);
  if (!normalized) return null;
  const [hour, minute] = normalized.split(':').map(Number);
  return hour * 60 + minute;
}

function hasVisibleText(value) {
  return String(value || '').trim().replace(/\u200B/g, '') !== '';
}

function itemKey(item) {
  if (!item) return '';
  return `${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`;
}

function parseKey(key) {
  const [w, d, r, c] = String(key || '').split('-').map(Number);
  return { w, d, r, c };
}

function cloneMergeSpan(mergeSpan = DEFAULT_MERGE_SPAN) {
  const base = mergeSpan && typeof mergeSpan === 'object' ? mergeSpan : DEFAULT_MERGE_SPAN;
  const cloned = {
    rowSpan: Math.max(1, Number(base.rowSpan) || 1),
    colSpan: Math.max(1, Number(base.colSpan) || 1),
    mergedInto: base.mergedInto || null,
  };
  if (base.meta && typeof base.meta === 'object' && !Array.isArray(base.meta)) {
    cloned.meta = { ...base.meta };
  }
  return cloned;
}

function compareUpdatedAt(left, right) {
  const leftTime = left?.updated_at ? Date.parse(left.updated_at) : 0;
  const rightTime = right?.updated_at ? Date.parse(right.updated_at) : 0;
  const safeLeft = Number.isFinite(leftTime) ? leftTime : 0;
  const safeRight = Number.isFinite(rightTime) ? rightTime : 0;
  return safeLeft - safeRight;
}

function buildLatestRowMap(rows) {
  const byKey = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const key = itemKey(row);
    if (!key || key.includes('undefined')) return;
    const existing = byKey.get(key);
    if (!existing || compareUpdatedAt(existing, row) <= 0) byKey.set(key, row);
  });
  return byKey;
}

function buildPayloadItem(source, overrides = {}) {
  return {
    year: source.year,
    month: source.month,
    week_index: source.week_index,
    day_index: source.day_index,
    row_index: source.row_index,
    col_index: source.col_index,
    content: source.content || '',
    bg_color: source.bg_color || null,
    merge_span: cloneMergeSpan(source.merge_span),
    prescription: source.prescription || null,
    body_part: source.body_part || null,
    updated_at: source.updated_at,
    ...overrides,
  };
}

function hasMeaningfulCellPayload(item) {
  if (!item) return false;
  if (hasVisibleText(item.content)) return true;
  if (String(item.prescription || '').trim()) return true;
  if (String(item.body_part || '').trim()) return true;
  if (String(item.bg_color || '').trim()) return true;
  const meta = item.merge_span?.meta;
  if (Array.isArray(meta?.memo_list) && meta.memo_list.some((entry) => String(entry || '').trim())) return true;
  if (Array.isArray(meta?.body_part_options) && meta.body_part_options.some((entry) => String(entry || '').trim())) return true;
  return false;
}

function getCoveredCellKeys(byKey) {
  const covered = new Set();
  byKey.forEach((item, key) => {
    const mergeSpan = cloneMergeSpan(item?.merge_span);
    if (mergeSpan.mergedInto || (mergeSpan.rowSpan <= 1 && mergeSpan.colSpan <= 1)) return;
    const { w, d, r, c } = parseKey(key);
    if (![w, d, r, c].every(Number.isFinite)) return;
    for (let row = r; row < r + mergeSpan.rowSpan; row += 1) {
      for (let col = c; col < c + mergeSpan.colSpan; col += 1) {
        covered.add(`${w}-${d}-${row}-${col}`);
      }
    }
  });
  return covered;
}

function isCellCoveredByMaster({ sourceKey, masterKey, byKey }) {
  const master = byKey.get(masterKey);
  if (!master) return false;
  const masterSpan = cloneMergeSpan(master.merge_span);
  if (masterSpan.mergedInto) return false;

  const source = parseKey(sourceKey);
  const masterCell = parseKey(masterKey);
  if (![source.w, source.d, source.r, source.c, masterCell.w, masterCell.d, masterCell.r, masterCell.c].every(Number.isFinite)) {
    return false;
  }
  const endRow = masterCell.r + masterSpan.rowSpan - 1;
  const endCol = masterCell.c + masterSpan.colSpan - 1;
  return source.w === masterCell.w &&
    source.d === masterCell.d &&
    source.r >= masterCell.r &&
    source.r <= endRow &&
    source.c >= masterCell.c &&
    source.c <= endCol;
}

function buildDestinationMergeSpan(sourceKey, sourceMergeSpan) {
  const meta = { ...(sourceMergeSpan?.meta || {}) };
  delete meta.intentional_clear;
  meta[RELOCATED_FROM_META_KEY] = sourceKey;
  return {
    ...DEFAULT_MERGE_SPAN,
    meta,
  };
}

function findExistingRelocationTarget(sourceKey, byKey) {
  for (const [key, item] of byKey.entries()) {
    if (item?.merge_span?.meta?.[RELOCATED_FROM_META_KEY] !== sourceKey) continue;
    if (cloneMergeSpan(item?.merge_span).mergedInto) continue;
    if (hasVisibleText(item.content)) return key;
  }
  return '';
}

function getSafeRowCount(rowCount, byKey) {
  const configuredRowCount = Number(rowCount);
  const maxExistingRow = Array.from(byKey.keys()).reduce((maxRow, key) => {
    const { r } = parseKey(key);
    return Number.isFinite(r) ? Math.max(maxRow, r) : maxRow;
  }, -1);
  return Math.max(
    Number.isFinite(configuredRowCount) && configuredRowCount > 0 ? Math.floor(configuredRowCount) : 0,
    maxExistingRow + 2
  );
}

function findRelocationTarget({ sourceKey, masterKey, byKey, coveredKeys, reservedKeys, rowCount }) {
  const source = parseKey(sourceKey);
  const master = parseKey(masterKey);
  const masterSpan = cloneMergeSpan(byKey.get(masterKey)?.merge_span);
  if (![source.w, source.d, source.c, master.r].every(Number.isFinite)) return '';

  const masterStart = master.r;
  const masterEnd = master.r + masterSpan.rowSpan - 1;
  const isFree = (row) => {
    if (row < 0 || row >= rowCount) return false;
    const key = `${source.w}-${source.d}-${row}-${source.c}`;
    if (reservedKeys.has(key)) return false;
    if (coveredKeys.has(key)) return false;
    const existing = byKey.get(key);
    return !hasMeaningfulCellPayload(existing);
  };

  for (let offset = 0; offset < rowCount; offset += 1) {
    const below = masterEnd + 1 + offset;
    if (isFree(below)) return `${source.w}-${source.d}-${below}-${source.c}`;

    const above = masterStart - 1 - offset;
    if (isFree(above)) return `${source.w}-${source.d}-${above}-${source.c}`;
  }

  return '';
}

export function getShockwaveScheduleBaseRowCount(settings = {}, year, month) {
  const effectiveDayOverrides = getMonthlyDayOverrides(settings?.day_overrides, year, month);
  const dateOverrides = getDateOverridesForMonth(settings?.date_overrides, year, month);
  const startCandidates = [
    settings?.start_time,
    ...Object.values(effectiveDayOverrides || {}).map((override) => override?.start_time),
    ...Object.values(dateOverrides || {}).map((override) => override?.start_time),
  ].map(timeToMinutes).filter(Number.isFinite);
  const endCandidates = [
    settings?.end_time,
    ...Object.values(effectiveDayOverrides || {}).map((override) => override?.end_time),
    ...Object.values(dateOverrides || {}).map((override) => override?.end_time),
  ].map(timeToMinutes).filter(Number.isFinite);
  const startMinutes = startCandidates.length ? Math.min(...startCandidates) : timeToMinutes(DEFAULT_START_TIME);
  const endMinutes = endCandidates.length ? Math.max(...endCandidates) : timeToMinutes(DEFAULT_END_TIME);
  const interval = getScheduleDisplaySlotMinutes(settings, 10);
  if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes) || startMinutes >= endMinutes || interval <= 0) {
    return 31;
  }
  return Math.ceil((endMinutes - startMinutes) / interval);
}

export function relocateHiddenMergedScheduleRows(rows, options = {}) {
  const byKey = buildLatestRowMap(rows);
  const rowCount = getSafeRowCount(options.rowCount, byKey);
  if (rowCount <= 0) return { rows: Array.from(byKey.values()), payload: [] };

  const coveredKeys = getCoveredCellKeys(byKey);
  const reservedKeys = new Set();
  const payloadByKey = new Map();

  Array.from(byKey.entries())
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey, undefined, { numeric: true }))
    .forEach(([sourceKey, source]) => {
      const sourceMergeSpan = cloneMergeSpan(source?.merge_span);
      if (!sourceMergeSpan.mergedInto || !hasVisibleText(source?.content)) return;

      if (!isCellCoveredByMaster({ sourceKey, masterKey: sourceMergeSpan.mergedInto, byKey })) {
        const detached = buildPayloadItem(source, {
          merge_span: { ...DEFAULT_MERGE_SPAN },
        });
        byKey.set(sourceKey, { ...source, ...detached });
        payloadByKey.set(sourceKey, detached);
        return;
      }

      const existingTargetKey = findExistingRelocationTarget(sourceKey, byKey);
      const targetKey = existingTargetKey || findRelocationTarget({
        sourceKey,
        masterKey: sourceMergeSpan.mergedInto,
        byKey,
        coveredKeys,
        reservedKeys,
        rowCount,
      });
      if (!targetKey) return;

      const clearedSource = buildPayloadItem(source, {
        content: '',
        bg_color: null,
        merge_span: {
          rowSpan: sourceMergeSpan.rowSpan,
          colSpan: sourceMergeSpan.colSpan,
          mergedInto: sourceMergeSpan.mergedInto,
        },
        prescription: null,
        body_part: null,
      });
      byKey.set(sourceKey, { ...source, ...clearedSource });
      payloadByKey.set(sourceKey, clearedSource);

      if (!existingTargetKey) {
        const target = parseKey(targetKey);
        const movedTarget = buildPayloadItem(source, {
          week_index: target.w,
          day_index: target.d,
          row_index: target.r,
          col_index: target.c,
          merge_span: buildDestinationMergeSpan(sourceKey, sourceMergeSpan),
        });
        byKey.set(targetKey, movedTarget);
        payloadByKey.set(targetKey, movedTarget);
        reservedKeys.add(targetKey);
      }
    });

  return {
    rows: Array.from(byKey.values()),
    payload: Array.from(payloadByKey.values()),
  };
}
