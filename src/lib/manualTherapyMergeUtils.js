import { getScheduleCellKey, parseScheduleCellKey } from './scheduleSelectionUtils.js';
import { buildScheduleCellPayload, markIntentionalClearPayload } from './scheduleMergeUtils.js';

const DEFAULT_MERGE_SPAN = { rowSpan: 1, colSpan: 1, mergedInto: null };
const DEFAULT_SLOT_MINUTES = 20;

function normalizeDurationMinutes(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function getConfiguredDurationMinutes(prescription, durationMinutesMap = {}) {
  const text = String(prescription || '').trim();
  if (!durationMinutesMap || typeof durationMinutesMap !== 'object') return 0;
  if (Object.prototype.hasOwnProperty.call(durationMinutesMap, text)) {
    return normalizeDurationMinutes(durationMinutesMap[text]);
  }
  if (!text) return 0;
  return normalizeDurationMinutes(durationMinutesMap[text]);
}

function getDurationMinutesFromPrescriptionName(prescription) {
  const text = String(prescription || '').trim();
  const match = text.match(/(\d{2,3})\s*분?/);
  return match ? normalizeDurationMinutes(match[1]) : 0;
}

export function getManualTherapyRowSpan(prescription, options = {}) {
  const durationMinutes = getConfiguredDurationMinutes(prescription, options.durationMinutesMap)
    || getDurationMinutesFromPrescriptionName(prescription);
  const slotMinutes = normalizeDurationMinutes(options.slotMinutes) || DEFAULT_SLOT_MINUTES;
  if (durationMinutes <= slotMinutes) return 1;
  return Math.max(1, Math.ceil(durationMinutes / slotMinutes));
}

function normalizeMergeSpan(mergeSpan) {
  return mergeSpan || DEFAULT_MERGE_SPAN;
}

function getMemoListFromMergeSpan(mergeSpan) {
  const list = mergeSpan?.meta?.memo_list;
  return Array.isArray(list) ? list.map((item) => String(item || '').trim()).filter(Boolean) : [];
}

function mergeMemoLists(...lists) {
  const merged = [];
  const seen = new Set();
  lists.flat().forEach((item) => {
    const value = String(item || '').trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    merged.push(value);
  });
  return merged;
}

function buildMergeSpanWithMemoList(mergeSpan, memoList) {
  const next = { ...normalizeMergeSpan(mergeSpan) };
  const nextMeta = { ...(next.meta || {}) };
  const list = mergeMemoLists(memoList);
  if (list.length > 0) nextMeta.memo_list = list;
  else delete nextMeta.memo_list;

  if (Object.keys(nextMeta).length > 0) next.meta = nextMeta;
  else delete next.meta;
  return next;
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
  durationMinutesMap = {},
  slotMinutes = DEFAULT_SLOT_MINUTES,
}) {
  const targetRowSpan = getManualTherapyRowSpan(prescription, { durationMinutesMap, slotMinutes });
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
  const currentSpan = getCurrentMergeSpan({ key, memos, pendingMergeSpans });
  const currentMasterKey = currentSpan?.mergedInto || key;
  const currentMasterSpan = getCurrentMergeSpan({ key: currentMasterKey, memos, pendingMergeSpans });
  const masterMemoList = mergeMemoLists(
    getMemoListFromMergeSpan(mergeSpan),
    getMemoListFromMergeSpan(currentMasterSpan),
    getMemoListFromMergeSpan(memos?.[key]?.merge_span)
  );
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
  const masterMergeSpan = buildMergeSpanWithMemoList({
    ...normalizeMergeSpan(mergeSpan || currentMasterSpan),
    rowSpan: targetRowSpan,
    colSpan: 1,
    mergedInto: null,
  }, masterMemoList);

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
  const masterMemoList = mergeMemoLists(
    getMemoListFromMergeSpan(masterSpan),
    getMemoListFromMergeSpan(memos?.[masterKey]?.merge_span)
  );
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
            merge_span: buildMergeSpanWithMemoList(DEFAULT_MERGE_SPAN, masterMemoList),
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
