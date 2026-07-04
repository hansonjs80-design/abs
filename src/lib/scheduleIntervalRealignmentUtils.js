import {
  getClosestScheduleSlotIndexByTime,
  getReservationTimeFromMergeSpan,
  getScheduleDisplaySlotMinutes,
  minutesToTimeValue,
  timeValueToMinutes,
} from './schedulerUtils.js';

const DEFAULT_MERGE_SPAN = { rowSpan: 1, colSpan: 1, mergedInto: null };

function rowKey(row) {
  return `${row.week_index}-${row.day_index}-${row.row_index}-${row.col_index}`;
}

function cellKey(w, d, r, c) {
  return `${w}-${d}-${r}-${c}`;
}

function buildSlots(settings = {}) {
  const startMinutes = timeValueToMinutes(settings.start_time || '09:00');
  const endMinutes = timeValueToMinutes(settings.end_time || '18:00');
  const interval = getScheduleDisplaySlotMinutes(settings, 10);
  if (
    startMinutes === null ||
    endMinutes === null ||
    startMinutes >= endMinutes ||
    !Number.isFinite(interval) ||
    interval <= 0
  ) {
    return [];
  }

  const slots = [];
  for (let minutes = startMinutes; minutes < endMinutes; minutes += interval) {
    slots.push({
      idx: slots.length,
      time: minutesToTimeValue(minutes),
    });
  }
  return slots;
}

function normalizeMergeSpan(mergeSpan) {
  return mergeSpan && typeof mergeSpan === 'object' ? mergeSpan : DEFAULT_MERGE_SPAN;
}

function buildFootprintKeys({ w, d, r, c, rowSpan, colSpan }) {
  const keys = [];
  for (let rowOffset = 0; rowOffset < rowSpan; rowOffset += 1) {
    for (let colOffset = 0; colOffset < colSpan; colOffset += 1) {
      keys.push(cellKey(w, d, r + rowOffset, c + colOffset));
    }
  }
  return keys;
}

export function buildShockwaveIntervalRealignmentUpdates(rows = [], settings = {}) {
  const slots = buildSlots(settings);
  if (slots.length === 0) return [];

  const rowsByKey = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    if (!row) return;
    rowsByKey.set(rowKey(row), row);
  });

  const reservedTargets = new Set();
  const updates = [];

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    if (!row?.id) return;
    const mergeSpan = normalizeMergeSpan(row.merge_span);
    if (mergeSpan.mergedInto) return;

    const reservationTime = getReservationTimeFromMergeSpan(mergeSpan);
    const nextRowIndex = getClosestScheduleSlotIndexByTime(slots, reservationTime);
    if (nextRowIndex === null || nextRowIndex === Number(row.row_index)) return;

    const w = Number(row.week_index);
    const d = Number(row.day_index);
    const r = Number(row.row_index);
    const c = Number(row.col_index);
    const rowSpan = Math.max(1, Number(mergeSpan.rowSpan) || 1);
    const colSpan = Math.max(1, Number(mergeSpan.colSpan) || 1);
    if (![w, d, r, c].every(Number.isFinite)) return;
    if (nextRowIndex < 0 || nextRowIndex + rowSpan > slots.length) return;

    const oldKeys = new Set(buildFootprintKeys({ w, d, r, c, rowSpan, colSpan }));
    const targetKeys = buildFootprintKeys({ w, d, r: nextRowIndex, c, rowSpan, colSpan });
    const hasConflict = targetKeys.some((targetKey) => (
      (rowsByKey.has(targetKey) && !oldKeys.has(targetKey)) ||
      (reservedTargets.has(targetKey) && !oldKeys.has(targetKey))
    ));
    if (hasConflict) return;

    targetKeys.forEach((targetKey) => reservedTargets.add(targetKey));

    const newMasterKey = cellKey(w, d, nextRowIndex, c);
    const groupUpdates = [];
    for (let rowOffset = 0; rowOffset < rowSpan; rowOffset += 1) {
      for (let colOffset = 0; colOffset < colSpan; colOffset += 1) {
        const sourceKey = cellKey(w, d, r + rowOffset, c + colOffset);
        const sourceRow = rowsByKey.get(sourceKey);
        if (!sourceRow?.id) continue;
        const isMaster = rowOffset === 0 && colOffset === 0;
        const sourceMergeSpan = normalizeMergeSpan(sourceRow.merge_span);
        groupUpdates.push({
          ...sourceRow,
          row_index: nextRowIndex + rowOffset,
          merge_span: isMaster
            ? { ...mergeSpan, rowSpan, colSpan, mergedInto: null }
            : { ...sourceMergeSpan, rowSpan: 1, colSpan: 1, mergedInto: newMasterKey },
          sortOffset: rowOffset,
        });
      }
    }

    groupUpdates
      .sort((a, b) => (nextRowIndex > r ? b.sortOffset - a.sortOffset : a.sortOffset - b.sortOffset))
      .forEach(({ sortOffset: _sortOffset, ...update }) => updates.push(update));
  });

  return updates;
}
