import { buildScheduleCellPayload, markIntentionalClearPayload } from './scheduleMergeUtils.js';
import {
  getEffectiveScheduleMergeSpan,
  parseScheduleCellKey,
} from './scheduleSelectionUtils.js';

export const EMPTY_SCHEDULE_MERGE_SPAN = { rowSpan: 1, colSpan: 1, mergedInto: null };
const INTENTIONAL_GREEN_BG = '#93c47d';

function hasVisibleText(value) {
  return String(value || '').trim().replace(/\u200B/g, '') !== '';
}

function getContentForKey({ key, memos, pendingDisplayValues = {} }) {
  if (Object.prototype.hasOwnProperty.call(pendingDisplayValues, key)) {
    return pendingDisplayValues[key];
  }
  return memos?.[key]?.content;
}

function hasMemoList(mergeSpan) {
  if (mergeSpan?.meta?.intentional_clear === true) return false;
  return Array.isArray(mergeSpan?.meta?.memo_list) && mergeSpan.meta.memo_list.length > 0;
}

function isDefaultMergeSpan(mergeSpan) {
  if (!mergeSpan) return true;
  const rowSpan = mergeSpan.rowSpan || 1;
  const colSpan = mergeSpan.colSpan || 1;
  const metaKeys = Object.keys(mergeSpan.meta || {}).filter((key) => key !== 'intentional_clear');
  return rowSpan === 1 && colSpan === 1 && !mergeSpan.mergedInto && metaKeys.length === 0;
}

function masterHasVisibleContent({ masterKey, memos, pendingDisplayValues }) {
  return hasVisibleText(getContentForKey({ key: masterKey, memos, pendingDisplayValues }));
}

export function isVisuallyEmptyDirtyScheduleCell({
  key,
  memos,
  pendingDisplayValues = {},
  pendingMergeSpans = {},
}) {
  const memo = memos?.[key];
  if (!memo) return false;

  const content = getContentForKey({ key, memos, pendingDisplayValues });
  if (hasVisibleText(content)) return false;

  const mergeSpan = getEffectiveScheduleMergeSpan({ key, memos, pendingMergeSpans });
  if (hasMemoList(memo.merge_span) || hasMemoList(mergeSpan)) return false;

  // Active merged cells (whether master or child) should not be treated as visually empty dirty cells to be cleaned up.
  if (!isDefaultMergeSpan(memo.merge_span) || !isDefaultMergeSpan(mergeSpan)) {
    // Exception: If it is a child cell but its master does not exist in the memos, it is an orphaned stale child and should be cleaned up.
    const originalMergedInto = memo?.merge_span?.mergedInto || mergeSpan?.mergedInto;
    if (originalMergedInto) {
      const masterKey = originalMergedInto;
      const masterMemo = memos?.[masterKey];
      if (!masterMemo) {
        return true;
      }
    }
    return false;
  }

  if ((memo.bg_color || null) === INTENTIONAL_GREEN_BG && isDefaultMergeSpan(memo.merge_span) && isDefaultMergeSpan(mergeSpan)) {
    return false;
  }

  if (mergeSpan?.mergedInto) {
    return !masterHasVisibleContent({
      masterKey: mergeSpan.mergedInto,
      memos,
      pendingDisplayValues,
    });
  }

  return Boolean(
    memo.bg_color ||
    memo.prescription ||
    memo.body_part ||
    !isDefaultMergeSpan(memo.merge_span) ||
    !isDefaultMergeSpan(mergeSpan)
  );
}

export function sanitizeBlankScheduleCellData({
  key,
  memos,
  cellData,
  pendingDisplayValues = {},
  pendingMergeSpans = {},
}) {
  if (!isVisuallyEmptyDirtyScheduleCell({
    key,
    memos,
    pendingDisplayValues,
    pendingMergeSpans,
  })) {
    return {
      cellData,
      mergeSpan: null,
      wasSanitized: false,
    };
  }

  return {
    cellData: {
      ...(cellData || {}),
      content: '',
      bg_color: null,
      prescription: null,
      body_part: null,
      merge_span: { ...EMPTY_SCHEDULE_MERGE_SPAN },
    },
    mergeSpan: { ...EMPTY_SCHEDULE_MERGE_SPAN },
    wasSanitized: true,
  };
}

export function buildBlankScheduleCellCleanupPayload({
  key,
  memos,
  currentYear,
  currentMonth,
}) {
  return markIntentionalClearPayload(buildScheduleCellPayload({
    key,
    currentYear,
    currentMonth,
    memo: memos?.[key],
    overrides: {
      content: '',
      bg_color: null,
      merge_span: { ...EMPTY_SCHEDULE_MERGE_SPAN },
      prescription: null,
      body_part: null,
    },
  }));
}

export function buildBlankScheduleCleanupPayload({
  memos,
  currentYear,
  currentMonth,
  pendingDisplayValues = {},
  pendingMergeSpans = {},
}) {
  return Object.keys(memos || {}).flatMap((key) => {
    const { w, d, r, c } = parseScheduleCellKey(key);
    if (![w, d, r, c].every(Number.isFinite)) return [];
    if (!isVisuallyEmptyDirtyScheduleCell({
      key,
      memos,
      pendingDisplayValues,
      pendingMergeSpans,
    })) return [];

    return [buildBlankScheduleCellCleanupPayload({
      key,
      memos,
      currentYear,
      currentMonth,
    })];
  });
}
