import { getScheduleCellKey, parseScheduleCellKey } from './scheduleSelectionUtils.js';
import { buildScheduleCellPayload, markIntentionalClearPayload } from './scheduleMergeUtils.js';

const DEFAULT_MERGE_SPAN = { rowSpan: 1, colSpan: 1, mergedInto: null };

export function getManualTherapyRowSpan(prescription) {
  const text = String(prescription || '').trim();
  if (text === '40분') return 2;
  if (text === '60분') return 3;
  return 1;
}

function normalizeMergeSpan(mergeSpan) {
  return mergeSpan || DEFAULT_MERGE_SPAN;
}

function getCurrentMergeSpan({ key, memos, pendingMergeSpans }) {
  return pendingMergeSpans?.[key] || memos?.[key]?.merge_span || DEFAULT_MERGE_SPAN;
}

function collectCurrentFootprint({ key, memos, pendingMergeSpans }) {
  const currentSpan = getCurrentMergeSpan({ key, memos, pendingMergeSpans });
  const masterKey = currentSpan?.mergedInto || key;
  const masterSpan = getCurrentMergeSpan({ key: masterKey, memos, pendingMergeSpans });
  const { w, d, r, c } = parseScheduleCellKey(masterKey);
  const rowSpan = Math.max(1, masterSpan?.rowSpan || 1);
  const colSpan = Math.max(1, masterSpan?.colSpan || 1);
  const keys = new Set();

  for (let row = r; row < r + rowSpan; row += 1) {
    for (let col = c; col < c + colSpan; col += 1) {
      keys.add(getScheduleCellKey(w, d, row, col));
    }
  }

  return keys;
}

function isEmptyStructuralCell(memo = {}, mergeSpan = memo?.merge_span) {
  if (mergeSpan?.meta?.intentional_clear === true) return true;
  if (String(memo?.content || '').trim()) return false;
  if (Array.isArray(mergeSpan?.meta?.memo_list) && mergeSpan.meta.memo_list.length > 0) return false;
  if (mergeSpan?.mergedInto) return false;
  return true;
}

export function buildManualTherapyMergePayload({
  key,
  memos = {},
  pendingMergeSpans = {},
  currentYear,
  currentMonth,
  rowCount,
  content = '',
  bgColor = null,
  prescription = '',
  bodyPart = null,
  mergeSpan,
}) {
  const targetRowSpan = getManualTherapyRowSpan(prescription);
  if (targetRowSpan <= 1) {
    return { ok: false, reason: 'not-manual-therapy', payload: [], affectedKeys: [] };
  }

  const { w, d, r, c } = parseScheduleCellKey(key);
  if (![w, d, r, c].every(Number.isFinite)) {
    return { ok: false, reason: 'invalid-key', payload: [], affectedKeys: [] };
  }
  if (r + targetRowSpan > rowCount) {
    return { ok: false, reason: 'bounds', payload: [], affectedKeys: [] };
  }

  const currentFootprint = collectCurrentFootprint({ key, memos, pendingMergeSpans });
  const targetFootprint = new Set();
  for (let row = r; row < r + targetRowSpan; row += 1) {
    targetFootprint.add(getScheduleCellKey(w, d, row, c));
  }

  for (let row = r + 1; row < r + targetRowSpan; row += 1) {
    const targetKey = getScheduleCellKey(w, d, row, c);
    const memo = memos[targetKey] || {};
    const nextSpan = pendingMergeSpans?.[targetKey] || memo.merge_span;
    if (!currentFootprint.has(targetKey) && !isEmptyStructuralCell(memo, nextSpan)) {
      return { ok: false, reason: 'occupied', payload: [], affectedKeys: [] };
    }
  }

  const affectedKeys = new Set([...currentFootprint, ...targetFootprint]);
  const masterMergeSpan = {
    ...normalizeMergeSpan(mergeSpan),
    rowSpan: targetRowSpan,
    colSpan: 1,
    mergedInto: null,
  };

  const payloadByKey = new Map();
  payloadByKey.set(key, buildScheduleCellPayload({
    key,
    currentYear,
    currentMonth,
    memo: memos[key],
    overrides: {
      content,
      bg_color: bgColor,
      merge_span: masterMergeSpan,
      prescription,
      body_part: bodyPart,
    },
  }));

  for (let row = r + 1; row < r + targetRowSpan; row += 1) {
    const childKey = getScheduleCellKey(w, d, row, c);
    payloadByKey.set(childKey, buildScheduleCellPayload({
      key: childKey,
      currentYear,
      currentMonth,
      memo: memos[childKey],
      overrides: {
        content: '',
        bg_color: null,
        merge_span: { rowSpan: 1, colSpan: 1, mergedInto: key },
        prescription: null,
        body_part: null,
      },
    }));
  }

  currentFootprint.forEach((oldKey) => {
    if (targetFootprint.has(oldKey)) return;
    payloadByKey.set(oldKey, markIntentionalClearPayload(buildScheduleCellPayload({
      key: oldKey,
      currentYear,
      currentMonth,
      memo: memos[oldKey],
      overrides: {
        content: '',
        bg_color: null,
        merge_span: DEFAULT_MERGE_SPAN,
        prescription: null,
        body_part: null,
      },
    })));
  });

  return {
    ok: true,
    reason: null,
    payload: Array.from(payloadByKey.values()),
    affectedKeys: Array.from(affectedKeys),
  };
}

export function buildManualTherapyUnmergePayload({
  key,
  memos = {},
  pendingMergeSpans = {},
  currentYear,
  currentMonth,
  content = '',
  bgColor = null,
  prescription = '',
  bodyPart = null,
}) {
  const currentSpan = getCurrentMergeSpan({ key, memos, pendingMergeSpans });
  const masterKey = currentSpan?.mergedInto || key;
  const masterSpan = getCurrentMergeSpan({ key: masterKey, memos, pendingMergeSpans });
  const rowSpan = Math.max(1, masterSpan?.rowSpan || 1);
  const colSpan = Math.max(1, masterSpan?.colSpan || 1);

  if (!currentSpan?.mergedInto && rowSpan === 1 && colSpan === 1) {
    return { ok: false, reason: 'not-merged', payload: [], affectedKeys: [] };
  }

  const { w, d, r, c } = parseScheduleCellKey(masterKey);
  if (![w, d, r, c].every(Number.isFinite)) {
    return { ok: false, reason: 'invalid-key', payload: [], affectedKeys: [] };
  }

  const affectedKeys = [];
  const payload = [];
  for (let row = r; row < r + rowSpan; row += 1) {
    for (let col = c; col < c + colSpan; col += 1) {
      const targetKey = getScheduleCellKey(w, d, row, col);
      affectedKeys.push(targetKey);

      if (targetKey === masterKey) {
        payload.push(buildScheduleCellPayload({
          key: targetKey,
          currentYear,
          currentMonth,
          memo: memos[targetKey],
          overrides: {
            content,
            bg_color: bgColor,
            merge_span: DEFAULT_MERGE_SPAN,
            prescription,
            body_part: bodyPart,
          },
        }));
      } else {
        payload.push(markIntentionalClearPayload(buildScheduleCellPayload({
          key: targetKey,
          currentYear,
          currentMonth,
          memo: memos[targetKey],
          overrides: {
            content: '',
            bg_color: null,
            merge_span: DEFAULT_MERGE_SPAN,
            prescription: null,
            body_part: null,
          },
        })));
      }
    }
  }

  return { ok: true, reason: null, payload, affectedKeys, masterKey };
}
