import {
  buildMergeSpanWithReservationTime,
} from './schedulerUtils.js';

const DEFAULT_MERGE_SPAN = { rowSpan: 1, colSpan: 1, mergedInto: null };
export const RESERVATION_GROUP_SAME = 'same';

function parseKey(key) {
  const [w, d, r, c] = String(key || '').split('-').map(Number);
  return { w, d, r, c };
}

function getKeySortValue(key) {
  const { w, d, c, r } = parseKey(key);
  if (![w, d, c, r].every(Number.isFinite)) return Number.MAX_SAFE_INTEGER;
  return (((w * 10 + d) * 10 + c) * 1000) + r;
}

function cloneMergeSpanWithoutReservationGroup(mergeSpan) {
  const base = mergeSpan || DEFAULT_MERGE_SPAN;
  const nextMeta = { ...(base.meta || {}) };
  delete nextMeta.reservation_group_id;
  delete nextMeta.reservation_group_mode;
  delete nextMeta.reservation_group_anchor_key;
  delete nextMeta.reservation_group_base_time;
  delete nextMeta.reservation_group_index;
  delete nextMeta.reservation_group_size;

  const next = { ...base };
  if (Object.keys(nextMeta).length > 0) next.meta = nextMeta;
  else delete next.meta;
  return next;
}

function cloneMergeSpanWithoutReservationGroupAndTime(mergeSpan) {
  return buildMergeSpanWithReservationTime(cloneMergeSpanWithoutReservationGroup(mergeSpan), '');
}

export function getReservationGroupFromMergeSpan(mergeSpan) {
  const meta = mergeSpan?.meta || {};
  const mode = String(meta.reservation_group_mode || '').trim();
  if (mode !== RESERVATION_GROUP_SAME) return null;
  return {
    id: String(meta.reservation_group_id || '').trim(),
    mode,
    anchorKey: String(meta.reservation_group_anchor_key || '').trim(),
    baseTime: String(meta.reservation_group_base_time || '').trim(),
    index: Number(meta.reservation_group_index) || 0,
    size: Number(meta.reservation_group_size) || 0,
    minRow: Number(meta.reservation_group_min_row),
    maxRow: Number(meta.reservation_group_max_row),
    minCol: Number(meta.reservation_group_min_col),
    maxCol: Number(meta.reservation_group_max_col),
  };
}

export function buildMergeSpanWithReservationGroup(mergeSpan, group) {
  if (!group) return cloneMergeSpanWithoutReservationGroup(mergeSpan);
  const timed = buildMergeSpanWithReservationTime(mergeSpan || DEFAULT_MERGE_SPAN, group.reservationTime || group.baseTime);
  const nextMeta = {
    ...(timed.meta || {}),
    reservation_group_id: group.id,
    reservation_group_mode: group.mode,
    reservation_group_anchor_key: group.anchorKey,
    reservation_group_base_time: group.baseTime,
    reservation_group_index: group.index,
    reservation_group_size: group.size,
    reservation_group_min_row: group.minRow,
    reservation_group_max_row: group.maxRow,
    reservation_group_min_col: group.minCol,
    reservation_group_max_col: group.maxCol,
  };
  return { ...timed, meta: nextMeta };
}

export function expandKeysToReservationGroup({
  keys,
  memos = {},
  pendingMergeSpans = {},
}) {
  const expanded = new Set(keys || []);
  const groupIds = new Set();

  expanded.forEach((key) => {
    const group = getReservationGroupFromMergeSpan(pendingMergeSpans[key] || memos[key]?.merge_span);
    if (group?.id) groupIds.add(group.id);
  });

  if (groupIds.size === 0) return expanded;

  Object.entries(memos || {}).forEach(([key, memo]) => {
    const group = getReservationGroupFromMergeSpan(pendingMergeSpans[key] || memo?.merge_span);
    if (group?.id && groupIds.has(group.id)) expanded.add(key);
  });
  Object.entries(pendingMergeSpans || {}).forEach(([key, mergeSpan]) => {
    const group = getReservationGroupFromMergeSpan(mergeSpan);
    if (group?.id && groupIds.has(group.id)) expanded.add(key);
  });

  return expanded;
}

export function selectionHasReservationGroup({
  keys,
  memos = {},
  pendingMergeSpans = {},
}) {
  return Array.from(keys || []).some((key) => {
    const group = getReservationGroupFromMergeSpan(pendingMergeSpans[key] || memos[key]?.merge_span);
    return Boolean(group?.id);
  });
}

export function buildClearReservationGroupPayload({
  keys,
  memos = {},
  pendingDisplayValues = {},
  pendingMergeSpans = {},
  currentYear,
  currentMonth,
}) {
  const targetKeys = expandKeysToReservationGroup({ keys, memos, pendingMergeSpans });
  const oldMemos = [];
  const payload = [];

  targetKeys.forEach((key) => {
    const group = getReservationGroupFromMergeSpan(pendingMergeSpans[key] || memos[key]?.merge_span);
    if (!group?.id) return;
    const { w, d, r, c } = parseKey(key);
    if (![w, d, r, c].every(Number.isFinite)) return;
    const memo = memos[key] || {};
    const content = Object.prototype.hasOwnProperty.call(pendingDisplayValues || {}, key)
      ? String(pendingDisplayValues[key] || '')
      : (memo.content || '');
    const currentMergeSpan = pendingMergeSpans[key] || memo.merge_span || DEFAULT_MERGE_SPAN;

    oldMemos.push({
      year: currentYear,
      month: currentMonth,
      week_index: w,
      day_index: d,
      row_index: r,
      col_index: c,
      content,
      bg_color: memo.bg_color || null,
      merge_span: currentMergeSpan,
      prescription: memo.prescription || null,
      body_part: memo.body_part || null,
    });

    payload.push({
      year: currentYear,
      month: currentMonth,
      week_index: w,
      day_index: d,
      row_index: r,
      col_index: c,
      content,
      bg_color: memo.bg_color || null,
      merge_span: cloneMergeSpanWithoutReservationGroupAndTime(currentMergeSpan),
      prescription: memo.prescription || null,
      body_part: memo.body_part || null,
    });
  });

  return { oldMemos, payload };
}

export function refreshReservationGroupsInPayload({
  payload = [],
  getDefaultReservationTime,
}) {
  const nextPayload = payload.map((item) => ({ ...item }));
  const groups = new Map();

  nextPayload.forEach((item, index) => {
    if (!String(item?.content || '').trim()) return;
    const group = getReservationGroupFromMergeSpan(item.merge_span);
    if (!group?.id) return;
    if (!groups.has(group.id)) groups.set(group.id, []);
    groups.get(group.id).push({ item, index });
  });

  groups.forEach((entries) => {
    const sorted = [...entries].sort((a, b) => getKeySortValue(
      `${a.item.week_index}-${a.item.day_index}-${a.item.row_index}-${a.item.col_index}`
    ) - getKeySortValue(
      `${b.item.week_index}-${b.item.day_index}-${b.item.row_index}-${b.item.col_index}`
    ));
    const anchor = sorted[0]?.item;
    if (!anchor) return;

    const anchorKey = `${anchor.week_index}-${anchor.day_index}-${anchor.row_index}-${anchor.col_index}`;
    const baseTime = getDefaultReservationTime?.(
      anchor.week_index,
      anchor.day_index,
      anchor.row_index
    ) || '';
    const minRow = Math.min(...sorted.map(({ item }) => item.row_index));
    const maxRow = Math.max(...sorted.map(({ item }) => item.row_index));
    const minCol = Math.min(...sorted.map(({ item }) => item.col_index));
    const maxCol = Math.max(...sorted.map(({ item }) => item.col_index));
    const size = sorted.length;

    sorted.forEach(({ item, index }, groupIndex) => {
      nextPayload[index] = {
        ...item,
        merge_span: buildMergeSpanWithReservationGroup(item.merge_span, {
          id: getReservationGroupFromMergeSpan(item.merge_span)?.id,
          mode: RESERVATION_GROUP_SAME,
          anchorKey,
          baseTime,
          reservationTime: baseTime,
          index: groupIndex,
          size,
          minRow,
          maxRow,
          minCol,
          maxCol,
        }),
      };
    });
  });

  return nextPayload;
}

export function buildReservationGroupPayload({
  keys,
  memos = {},
  pendingMergeSpans = {},
  currentYear,
  currentMonth,
  getDefaultReservationTime,
  mode: _mode,
}) {
  const targetKeys = Array.from(new Set(Array.from(keys || [])))
    .filter((key) => {
      const { w, d, r, c } = parseKey(key);
      return [w, d, r, c].every(Number.isFinite);
    })
    .sort((a, b) => getKeySortValue(a) - getKeySortValue(b));

  if (targetKeys.length === 0) return null;

  const anchorKey = targetKeys[0];
  const anchor = parseKey(anchorKey);
  const baseTime = getDefaultReservationTime?.(anchor.w, anchor.d, anchor.r) || '';
  const groupId = `${currentYear}-${String(currentMonth).padStart(2, '0')}:${anchorKey}:${Date.now()}`;
  const parsedKeys = targetKeys.map(parseKey);
  const minRow = Math.min(...parsedKeys.map(({ r }) => r));
  const maxRow = Math.max(...parsedKeys.map(({ r }) => r));
  const minCol = Math.min(...parsedKeys.map(({ c }) => c));
  const maxCol = Math.max(...parsedKeys.map(({ c }) => c));

  const oldMemos = [];
  const payload = targetKeys.map((key, index) => {
    const { w, d, r, c } = parseKey(key);
    const memo = memos[key] || {};
    const currentMergeSpan = pendingMergeSpans[key] || memo.merge_span || DEFAULT_MERGE_SPAN;
    oldMemos.push({
      year: currentYear,
      month: currentMonth,
      week_index: w,
      day_index: d,
      row_index: r,
      col_index: c,
      content: memo.content || '',
      bg_color: memo.bg_color || null,
      merge_span: currentMergeSpan,
      prescription: memo.prescription || null,
      body_part: memo.body_part || null,
    });

    return {
      year: currentYear,
      month: currentMonth,
      week_index: w,
      day_index: d,
      row_index: r,
      col_index: c,
      content: memo.content || '',
      bg_color: memo.bg_color || null,
      merge_span: buildMergeSpanWithReservationGroup(currentMergeSpan, {
        id: groupId,
        mode: RESERVATION_GROUP_SAME,
        anchorKey,
        baseTime,
        reservationTime: baseTime,
        index,
        size: targetKeys.length,
        minRow,
        maxRow,
        minCol,
        maxCol,
      }),
      prescription: memo.prescription || null,
      body_part: memo.body_part || null,
    };
  });

  return { oldMemos, payload };
}
