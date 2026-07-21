const DEFAULT_MERGE_SPAN = { rowSpan: 1, colSpan: 1, mergedInto: null };
const INTENTIONAL_CLEAR_META_KEY = 'intentional_clear';
const RELOCATED_FROM_HIDDEN_MERGE_CELL_META_KEY = 'relocated_from_hidden_merge_cell';

function parseKey(key) {
  const [w, d, r, c] = String(key || '').split('-').map(Number);
  return { w, d, r, c };
}

function cloneMergeSpan(mergeSpan) {
  return mergeSpan || DEFAULT_MERGE_SPAN;
}

function getRelocatedHiddenSourceKey(memo) {
  const sourceKey = String(memo?.merge_span?.meta?.[RELOCATED_FROM_HIDDEN_MERGE_CELL_META_KEY] || '').trim();
  if (!sourceKey) return '';
  const { w, d, r, c } = parseKey(sourceKey);
  return [w, d, r, c].every(Number.isFinite) ? sourceKey : '';
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
  const next = { ...(mergeSpan || DEFAULT_MERGE_SPAN) };
  const nextMeta = { ...(next.meta || {}) };
  const list = mergeMemoLists(memoList);
  if (list.length > 0) nextMeta.memo_list = list;
  else delete nextMeta.memo_list;

  if (Object.keys(nextMeta).length > 0) next.meta = nextMeta;
  else delete next.meta;
  return next;
}

function clearVisitCopyLinkFromMergeSpan(mergeSpan) {
  const base = cloneMergeSpan(mergeSpan);
  const nextMeta = { ...(base.meta || {}) };
  delete nextMeta.visit_copy_source_key;
  delete nextMeta.visit_copy_original_content;
  delete nextMeta.visit_copy_incremented_content;

  const nextMergeSpan = { ...base };
  if (Object.keys(nextMeta).length > 0) nextMergeSpan.meta = nextMeta;
  else delete nextMergeSpan.meta;
  return nextMergeSpan;
}

export function buildScheduleMemoSnapshot({
  key,
  memo,
  currentYear,
  currentMonth,
  contentOverride,
}) {
  const { w, d, r, c } = parseKey(key);
  return {
    year: currentYear,
    month: currentMonth,
    week_index: w,
    day_index: d,
    row_index: r,
    col_index: c,
    content: contentOverride ?? memo?.content ?? '',
    bg_color: memo?.bg_color || null,
    merge_span: cloneMergeSpan(memo?.merge_span),
    prescription: memo?.prescription || null,
    body_part: memo?.body_part || null,
  };
}

export function buildScheduleCellPayload({
  key,
  currentYear,
  currentMonth,
  memo,
  overrides = {},
}) {
  const { w, d, r, c } = parseKey(key);
  return {
    year: currentYear,
    month: currentMonth,
    week_index: w,
    day_index: d,
    row_index: r,
    col_index: c,
    content: memo?.content || '',
    bg_color: memo?.bg_color || null,
    merge_span: cloneMergeSpan(memo?.merge_span),
    prescription: memo?.prescription || null,
    body_part: memo?.body_part || null,
    ...overrides,
  };
}

export function markIntentionalClearPayload(payload) {
  const mergeSpan = payload.merge_span || DEFAULT_MERGE_SPAN;
  return {
    ...payload,
    merge_span: {
      ...mergeSpan,
      meta: {
        ...(mergeSpan.meta || {}),
        [INTENTIONAL_CLEAR_META_KEY]: true,
      },
    },
  };
}

export function getExpandedMergeKeys(keys, memos, cellKey, pendingMergeSpans = {}) {
  const affectedKeys = new Set();

  for (const key of keys || []) {
    const mergeSpan = pendingMergeSpans?.[key] || memos?.[key]?.merge_span;
    const masterKey = mergeSpan?.mergedInto || key;
    const { w, d, r, c } = parseKey(masterKey);
    const masterSpan = pendingMergeSpans?.[masterKey] || memos?.[masterKey]?.merge_span || DEFAULT_MERGE_SPAN;
    const rowSpan = Math.max(1, masterSpan.rowSpan || 1);
    const colSpan = Math.max(1, masterSpan.colSpan || 1);

    for (let row = r; row < r + rowSpan; row += 1) {
      for (let col = c; col < c + colSpan; col += 1) {
        affectedKeys.add(cellKey(w, d, row, col));
      }
    }
  }

  return affectedKeys;
}

export function buildDeleteCellsPayload({
  keys,
  memos,
  pendingDisplayValues = {},
  pendingMergeSpans = {},
  currentYear,
  currentMonth,
  cellKey,
}) {
  const affectedKeys = getExpandedMergeKeys(keys, memos, cellKey, pendingMergeSpans);
  const relocatedHiddenSourceKeys = new Set();

  Array.from(affectedKeys).forEach((key) => {
    const sourceKey = getRelocatedHiddenSourceKey(memos?.[key]);
    if (!sourceKey || affectedKeys.has(sourceKey)) return;
    affectedKeys.add(sourceKey);
    relocatedHiddenSourceKeys.add(sourceKey);
  });

  const oldMemos = [];
  const oldMemoKeys = new Set();
  const payloadByKey = new Map();

  const addOldMemo = (key, memoOverride = undefined) => {
    if (oldMemoKeys.has(key)) return;
    const memo = memoOverride !== undefined ? memoOverride : memos?.[key];
    const stableContent = key in pendingDisplayValues ? pendingDisplayValues[key] : memo?.content;
    oldMemoKeys.add(key);
    oldMemos.push(buildScheduleMemoSnapshot({
      key,
      memo,
      currentYear,
      currentMonth,
      contentOverride: stableContent || '',
    }));
  };

  for (const key of affectedKeys) {
    const memo = memos?.[key];
    const nextMergeSpan = relocatedHiddenSourceKeys.has(key) && memo?.merge_span?.mergedInto
      ? cloneMergeSpan(memo.merge_span)
      : DEFAULT_MERGE_SPAN;

    addOldMemo(key);
    payloadByKey.set(key, markIntentionalClearPayload(buildScheduleCellPayload({
      key,
      currentYear,
      currentMonth,
      memo,
      overrides: {
        content: '',
        bg_color: null,
        merge_span: nextMergeSpan,
        prescription: null,
        body_part: null,
      },
    })));
  }

  Object.entries(memos || {}).forEach(([targetKey, targetMemo]) => {
    if (affectedKeys.has(targetKey)) return;
    const meta = targetMemo?.merge_span?.meta;
    const sourceKey = String(meta?.visit_copy_source_key || '').trim();
    if (!sourceKey || !affectedKeys.has(sourceKey)) return;

    const originalContent = String(meta?.visit_copy_original_content || '');
    const incrementedContent = String(meta?.visit_copy_incremented_content || '');
    const currentContent = String(targetMemo?.content || '');
    if (!originalContent || currentContent !== incrementedContent) return;

    addOldMemo(targetKey, targetMemo);
    payloadByKey.set(targetKey, buildScheduleCellPayload({
      key: targetKey,
      currentYear,
      currentMonth,
      memo: targetMemo,
      overrides: {
        content: originalContent,
        merge_span: clearVisitCopyLinkFromMergeSpan(cloneMergeSpan(targetMemo?.merge_span)),
      },
    }));
  });

  return {
    oldMemos,
    payload: Array.from(payloadByKey.values()),
  };
}

export function buildMergeSelectionPayload({
  selection,
  memos,
  currentYear,
  currentMonth,
  cellKey,
}) {
  if (!selection) return { isAlreadyMerged: false, oldMemos: [], payload: [] };
  const { w, d, minRow, minCol, maxRow, maxCol, masterKey } = selection;
  const isAlreadyMerged = selection.isMergedMaster &&
    (selection.selectionRowSpan === undefined ||
     (selection.selectionRowSpan === (selection.masterSpan?.rowSpan || 1) &&
      selection.selectionColSpan === (selection.masterSpan?.colSpan || 1)));
  const oldMemos = [];
  const payload = [];
  const combinedContent = [];
  const selectedMemoList = [];
  let mergedPrescription = '';
  let mergedBodyPart = '';

  for (let row = minRow; row <= maxRow; row += 1) {
    for (let col = minCol; col <= maxCol; col += 1) {
      const key = cellKey(w, d, row, col);
      const memo = memos?.[key];
      const isMaster = key === masterKey;
      oldMemos.push(buildScheduleMemoSnapshot({ key, memo, currentYear, currentMonth }));

      if (isAlreadyMerged) {
        const nextMergeSpan = isMaster
          ? buildMergeSpanWithMemoList(DEFAULT_MERGE_SPAN, getMemoListFromMergeSpan(memo?.merge_span))
          : DEFAULT_MERGE_SPAN;
        payload.push(buildScheduleCellPayload({
          key,
          currentYear,
          currentMonth,
          memo,
          overrides: { merge_span: nextMergeSpan },
        }));
      } else {
        if (memo?.content) combinedContent.push(memo.content);
        selectedMemoList.push(...getMemoListFromMergeSpan(memo?.merge_span));
        if (!mergedPrescription && memo?.prescription) mergedPrescription = memo.prescription;
        if (!mergedBodyPart && memo?.body_part) mergedBodyPart = memo.body_part;
        payload.push(buildScheduleCellPayload({
          key,
          currentYear,
          currentMonth,
          memo,
          overrides: {
            content: '',
            merge_span: isMaster
              ? { rowSpan: maxRow - minRow + 1, colSpan: maxCol - minCol + 1, mergedInto: null }
              : { rowSpan: 1, colSpan: 1, mergedInto: masterKey },
          },
        }));
      }
    }
  }

  if (!isAlreadyMerged) {
    const mergedText = combinedContent.filter(Boolean).join('\n');
    payload.forEach((item) => {
      if (!item.merge_span.mergedInto) {
        item.content = mergedText;
        item.prescription = item.prescription || mergedPrescription || null;
        item.body_part = item.body_part || mergedBodyPart || null;
        item.merge_span = buildMergeSpanWithMemoList(item.merge_span, selectedMemoList);
      }
    });
  }

  return { isAlreadyMerged, oldMemos, payload };
}
