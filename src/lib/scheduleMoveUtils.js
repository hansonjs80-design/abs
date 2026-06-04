import {
  markIntentionalClearPayload,
} from './scheduleMergeUtils.js';
import {
  stripReservationTimeFromMergeSpan,
} from './schedulerUtils.js';
import {
  getEffectiveScheduleMergeSpan,
  getScheduleCellKey,
  normalizeScheduleKeysToMergeMasters,
  parseScheduleCellKey,
} from './scheduleSelectionUtils.js';

const DEFAULT_MERGE_SPAN = { rowSpan: 1, colSpan: 1, mergedInto: null };

function cloneMergeSpan(mergeSpan) {
  if (!mergeSpan) return { ...DEFAULT_MERGE_SPAN };
  return {
    ...mergeSpan,
    meta: mergeSpan.meta ? { ...mergeSpan.meta } : undefined,
  };
}

function cleanMergeSpan(mergeSpan) {
  const cloned = cloneMergeSpan(mergeSpan);
  if (!cloned.meta) delete cloned.meta;
  return cloned;
}

function normalizeMasterSpan(mergeSpan) {
  const span = cleanMergeSpan(stripReservationTimeFromMergeSpan(mergeSpan));
  return {
    ...span,
    rowSpan: Math.max(1, span.rowSpan || 1),
    colSpan: Math.max(1, span.colSpan || 1),
    mergedInto: null,
  };
}

function hasText(value) {
  return String(value || '').trim().replace(/\u200B/g, '') !== '';
}

function hasMemoList(mergeSpan) {
  if (mergeSpan?.meta?.intentional_clear === true) return false;
  return Array.isArray(mergeSpan?.meta?.memo_list) && mergeSpan.meta.memo_list.length > 0;
}

function isMeaningfulMergeSpan(mergeSpan) {
  if (!mergeSpan) return false;
  return Boolean(
    mergeSpan.mergedInto ||
    (mergeSpan.rowSpan || 1) > 1 ||
    (mergeSpan.colSpan || 1) > 1 ||
    hasMemoList(mergeSpan)
  );
}

function getVisibleContentForKey({ key, memos, pendingDisplayValues }) {
  const memo = memos?.[key] || {};
  return Object.prototype.hasOwnProperty.call(pendingDisplayValues || {}, key)
    ? pendingDisplayValues[key]
    : memo.content;
}

function isDestinationOccupied({
  key,
  memos,
  pendingDisplayValues,
  pendingMergeSpans,
  sourceFootprintKeys,
}) {
  if (sourceFootprintKeys.has(key)) return false;
  const content = getVisibleContentForKey({ key, memos, pendingDisplayValues });
  if (hasText(content)) return true;

  const mergeSpan = getEffectiveScheduleMergeSpan({
    key,
    memos,
    pendingMergeSpans,
  });
  const isIntentionalClear = mergeSpan?.meta?.intentional_clear === true;
  if (isIntentionalClear && !hasText(content)) {
    return false;
  }

  if (!isMeaningfulMergeSpan(mergeSpan)) return false;

  if (mergeSpan?.mergedInto) {
    if (sourceFootprintKeys.has(mergeSpan.mergedInto)) return false;
    return hasText(getVisibleContentForKey({
      key: mergeSpan.mergedInto,
      memos,
      pendingDisplayValues,
    }));
  }

  return false;
}

function buildPayloadItem({ key, currentYear, currentMonth, memo, overrides }) {
  const { w, d, r, c } = parseScheduleCellKey(key);
  return {
    year: currentYear,
    month: currentMonth,
    week_index: w,
    day_index: d,
    row_index: r,
    col_index: c,
    content: memo?.content || '',
    bg_color: memo?.bg_color || null,
    merge_span: cleanMergeSpan(memo?.merge_span),
    prescription: memo?.prescription || null,
    body_part: memo?.body_part || null,
    ...overrides,
  };
}

function addFootprintKeys({ key, rowSpan, colSpan, targetSet }) {
  const { w, d, r, c } = parseScheduleCellKey(key);
  for (let rowOffset = 0; rowOffset < rowSpan; rowOffset += 1) {
    for (let colOffset = 0; colOffset < colSpan; colOffset += 1) {
      targetSet.add(getScheduleCellKey(w, d, r + rowOffset, c + colOffset));
    }
  }
}

export function buildMoveScheduleSelectionPayload({
  selectedKeys,
  memos,
  pendingDisplayValues = {},
  pendingMergeSpans = {},
  rowDelta,
  rowCount,
  currentYear,
  currentMonth,
}) {
  const masterKeys = normalizeScheduleKeysToMergeMasters({
    keys: selectedKeys,
    memos,
    pendingMergeSpans,
  });
  if (!masterKeys.size || !rowDelta || !rowCount) {
    return { ok: false, reason: 'empty', oldMemos: [], payload: [], movedKeys: [] };
  }

  const moveItems = [];
  const sourceFootprintKeys = new Set();

  for (const key of masterKeys) {
    const memo = memos?.[key] || {};
    const content = Object.prototype.hasOwnProperty.call(pendingDisplayValues, key)
      ? String(pendingDisplayValues[key] || '')
      : (memo.content || '');
    const span = normalizeMasterSpan(getEffectiveScheduleMergeSpan({
      key,
      memos,
      pendingMergeSpans,
    }));
    const { w, d, r, c } = parseScheduleCellKey(key);
    const targetRow = r + rowDelta;

    if (targetRow < 0 || targetRow + span.rowSpan > rowCount) {
      return { ok: false, reason: 'bounds', oldMemos: [], payload: [], movedKeys: [] };
    }

    addFootprintKeys({ key, rowSpan: span.rowSpan, colSpan: span.colSpan, targetSet: sourceFootprintKeys });
    moveItems.push({
      key,
      targetKey: getScheduleCellKey(w, d, targetRow, c),
      memo,
      content,
      span,
    });
  }

  for (const item of moveItems) {
    const destinationKeys = new Set();
    addFootprintKeys({
      key: item.targetKey,
      rowSpan: item.span.rowSpan,
      colSpan: item.span.colSpan,
      targetSet: destinationKeys,
    });

    for (const key of destinationKeys) {
      if (isDestinationOccupied({
        key,
        memos,
        pendingDisplayValues,
        pendingMergeSpans,
        sourceFootprintKeys,
      })) {
        return { ok: false, reason: 'occupied', oldMemos: [], payload: [], movedKeys: [] };
      }
    }
  }

  const oldMemoKeys = new Set(sourceFootprintKeys);
  moveItems.forEach((item) => {
    addFootprintKeys({
      key: item.targetKey,
      rowSpan: item.span.rowSpan,
      colSpan: item.span.colSpan,
      targetSet: oldMemoKeys,
    });
  });

  const oldMemos = Array.from(oldMemoKeys).map((key) => {
    const memo = memos?.[key] || {};
    const content = Object.prototype.hasOwnProperty.call(pendingDisplayValues, key)
      ? String(pendingDisplayValues[key] || '')
      : (memo.content || '');
    return buildPayloadItem({
      key,
      currentYear,
      currentMonth,
      memo,
      overrides: { content },
    });
  });

  const payloadByKey = new Map();
  sourceFootprintKeys.forEach((key) => {
    payloadByKey.set(key, markIntentionalClearPayload(buildPayloadItem({
      key,
      currentYear,
      currentMonth,
      memo: memos?.[key],
      overrides: {
        content: '',
        bg_color: null,
        merge_span: { ...DEFAULT_MERGE_SPAN },
        prescription: null,
        body_part: null,
      },
    })));
  });

  const movedKeys = [];
  moveItems.forEach((item) => {
    const { w, d, r, c } = parseScheduleCellKey(item.targetKey);
    movedKeys.push(item.targetKey);

    for (let rowOffset = 0; rowOffset < item.span.rowSpan; rowOffset += 1) {
      for (let colOffset = 0; colOffset < item.span.colSpan; colOffset += 1) {
        const key = getScheduleCellKey(w, d, r + rowOffset, c + colOffset);
        const isMaster = rowOffset === 0 && colOffset === 0;
        payloadByKey.set(key, buildPayloadItem({
          key,
          currentYear,
          currentMonth,
          memo: isMaster ? item.memo : memos?.[key],
          overrides: {
            content: isMaster ? item.content : '',
            bg_color: isMaster ? (item.memo.bg_color || null) : null,
            merge_span: isMaster
              ? item.span
              : { rowSpan: 1, colSpan: 1, mergedInto: item.targetKey },
            prescription: isMaster ? (item.memo.prescription || null) : null,
            body_part: isMaster ? (item.memo.body_part || null) : null,
          },
        }));
      }
    }
  });

  return {
    ok: true,
    reason: null,
    oldMemos,
    payload: Array.from(payloadByKey.values()),
    movedKeys,
  };
}
