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

function getDirectMergeSpan({ key, memos, pendingMergeSpans }) {
  return pendingMergeSpans?.[key] || memos?.[key]?.merge_span;
}

function isCellInsideMasterSpan({ key, masterKey, masterSpan }) {
  const cell = parseScheduleCellKey(key);
  const master = parseScheduleCellKey(masterKey);
  if (![cell.w, cell.d, cell.r, cell.c, master.w, master.d, master.r, master.c].every(Number.isFinite)) {
    return false;
  }

  const rowSpan = Math.max(1, Number(masterSpan?.rowSpan) || 1);
  const colSpan = Math.max(1, Number(masterSpan?.colSpan) || 1);
  return (
    cell.w === master.w &&
    cell.d === master.d &&
    cell.r >= master.r &&
    cell.r < master.r + rowSpan &&
    cell.c >= master.c &&
    cell.c < master.c + colSpan
  );
}

function hasCompleteMergeFootprint({ masterKey, masterSpan, memos, pendingMergeSpans }) {
  if (!masterSpan || masterSpan.mergedInto) return false;
  const rowSpan = Math.max(1, Number(masterSpan.rowSpan) || 1);
  const colSpan = Math.max(1, Number(masterSpan.colSpan) || 1);
  if (rowSpan === 1 && colSpan === 1) return false;

  const master = parseScheduleCellKey(masterKey);
  if (![master.w, master.d, master.r, master.c].every(Number.isFinite)) return false;

  for (let row = master.r; row < master.r + rowSpan; row += 1) {
    for (let col = master.c; col < master.c + colSpan; col += 1) {
      const childKey = `${master.w}-${master.d}-${row}-${col}`;
      if (childKey === masterKey) continue;
      const childSpan = getDirectMergeSpan({ key: childKey, memos, pendingMergeSpans });
      if (childSpan?.mergedInto !== masterKey) return false;
    }
  }

  return true;
}

function isStructurallyValidActiveMerge({ key, memos, pendingMergeSpans }) {
  const mergeSpan = getDirectMergeSpan({ key, memos, pendingMergeSpans });
  if (!mergeSpan) return false;

  const masterKey = mergeSpan.mergedInto || key;
  const masterSpan = mergeSpan.mergedInto
    ? getDirectMergeSpan({ key: masterKey, memos, pendingMergeSpans })
    : mergeSpan;
  if (!hasCompleteMergeFootprint({ masterKey, masterSpan, memos, pendingMergeSpans })) {
    return false;
  }

  return !mergeSpan.mergedInto || isCellInsideMasterSpan({ key, masterKey, masterSpan });
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

  // A deliberately merged blank area is still meaningful UI state. Keep it when
  // the master footprint and child links agree, including during optimistic saves.
  if (isStructurallyValidActiveMerge({ key, memos, pendingMergeSpans })) {
    return false;
  }

  // Incomplete merge metadata can be left behind by older data or interrupted
  // writes. Only those structurally invalid blank spans should be sanitized.
  if (!isDefaultMergeSpan(memo.merge_span) || !isDefaultMergeSpan(mergeSpan)) {
    const isMasterEmpty = !hasVisibleText(content) && !memo.prescription && !memo.body_part;
    const originalMergedInto = memo?.merge_span?.mergedInto || mergeSpan?.mergedInto;
    if (originalMergedInto) {
      const masterKey = originalMergedInto;
      const masterMemo = memos?.[masterKey];
      const masterContent = getContentForKey({ key: masterKey, memos, pendingDisplayValues });
      if (!masterMemo || (!hasVisibleText(masterContent) && !masterMemo.prescription && !masterMemo.body_part)) {
        return true;
      }
    } else if (isMasterEmpty) {
      return true;
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
