import { useCallback } from 'react';
import { clearVisitCopyLinkFromMergeSpan } from '../../lib/schedulerUtils';

export default function useScheduleMergeActions({
  currentYear,
  currentMonth,
  memos,
  pendingDisplayValues,
  selectedKeys,
  cellKey,
  computeSelectionInfo,
  saveShockwaveMemosBulk,
  recordUndo,
  applyImmediateCellDisplay,
  clearImmediateCellDisplay,
  addToast,
  setContextMenu,
}) {
  const deleteCells = useCallback(async (keys) => {
    const affectedKeys = new Set();

    for (const key of keys || []) {
      const mergeSpan = memos[key]?.merge_span;
      const masterKey = mergeSpan?.mergedInto || key;
      const [w, d, r, c] = masterKey.split('-').map(Number);
      const masterSpan = memos[masterKey]?.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null };
      const rowSpan = Math.max(1, masterSpan.rowSpan || 1);
      const colSpan = Math.max(1, masterSpan.colSpan || 1);

      for (let row = r; row < r + rowSpan; row += 1) {
        for (let col = c; col < c + colSpan; col += 1) {
          affectedKeys.add(cellKey(w, d, row, col));
        }
      }
    }

    const oldMemos = [];
    const oldMemoKeys = new Set();
    const payloadByKey = new Map();
    const addOldMemo = (key, memoOverride = undefined) => {
      if (oldMemoKeys.has(key)) return;
      const [w, d, r, c] = key.split('-').map(Number);
      const memo = memoOverride !== undefined ? memoOverride : memos[key];
      const stableContent = key in pendingDisplayValues ? pendingDisplayValues[key] : memo?.content;
      oldMemoKeys.add(key);
      oldMemos.push({
        year: currentYear,
        month: currentMonth,
        week_index: w,
        day_index: d,
        row_index: r,
        col_index: c,
        content: stableContent || '',
        bg_color: memo?.bg_color || null,
        merge_span: memo?.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null },
        prescription: memo?.prescription || null,
        body_part: memo?.body_part || null,
      });
    };

    for (const key of affectedKeys) {
      const [w, d, r, c] = key.split('-').map(Number);
      addOldMemo(key);
      payloadByKey.set(key, {
        year: currentYear,
        month: currentMonth,
        week_index: w,
        day_index: d,
        row_index: r,
        col_index: c,
        content: '',
        bg_color: null,
        merge_span: { rowSpan: 1, colSpan: 1, mergedInto: null },
        prescription: null,
        body_part: null,
      });
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

      const [w, d, r, c] = targetKey.split('-').map(Number);
      addOldMemo(targetKey, targetMemo);
      payloadByKey.set(targetKey, {
        year: currentYear,
        month: currentMonth,
        week_index: w,
        day_index: d,
        row_index: r,
        col_index: c,
        content: originalContent,
        bg_color: targetMemo?.bg_color || null,
        merge_span: clearVisitCopyLinkFromMergeSpan(targetMemo?.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null }),
        prescription: targetMemo?.prescription || null,
        body_part: targetMemo?.body_part || null,
      });
    });

    const payload = Array.from(payloadByKey.values());
    if (payload.length > 0) {
      recordUndo({ type: 'bulk-edit', oldMemos });
      applyImmediateCellDisplay(payload);
      const success = await saveShockwaveMemosBulk(payload);
      if (success) clearImmediateCellDisplay(payload);
      else {
        applyImmediateCellDisplay(oldMemos);
        addToast('삭제 실패', 'error');
      }
    }
  }, [
    currentYear,
    currentMonth,
    memos,
    pendingDisplayValues,
    saveShockwaveMemosBulk,
    recordUndo,
    cellKey,
    applyImmediateCellDisplay,
    clearImmediateCellDisplay,
    addToast,
  ]);

  const tryMergeSelection = useCallback(async () => {
    const selection = computeSelectionInfo();
    if (!selection) return;
    const { w, d, minRow, minCol, maxRow, maxCol, masterKey } = selection;
    const isAlreadyMerged = selection.isMergedMaster;
    const hasMultipleSelectedCells = (selectedKeys?.size || 0) > 1;
    if (!isAlreadyMerged && !selection.selectionMultiple && !hasMultipleSelectedCells) return;

    const oldMemos = [];
    const payload = [];
    const combinedContent = [];
    if (isAlreadyMerged) {
      for (let row = minRow; row <= maxRow; row += 1) {
        for (let col = minCol; col <= maxCol; col += 1) {
          const k = cellKey(w, d, row, col);
          const memo = memos[k];
          oldMemos.push({
            year: currentYear,
            month: currentMonth,
            week_index: w,
            day_index: d,
            row_index: row,
            col_index: col,
            content: memo?.content || '',
            bg_color: memo?.bg_color || null,
            merge_span: memo?.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null },
          });
          payload.push({
            year: currentYear,
            month: currentMonth,
            week_index: w,
            day_index: d,
            row_index: row,
            col_index: col,
            merge_span: { rowSpan: 1, colSpan: 1, mergedInto: null },
            content: memo?.content || '',
          });
        }
      }
    } else {
      for (let row = minRow; row <= maxRow; row += 1) {
        for (let col = minCol; col <= maxCol; col += 1) {
          const k = cellKey(w, d, row, col);
          const isMaster = k === masterKey;
          const memo = memos[k];
          if (memo?.content) {
            combinedContent.push(memo.content);
          }
          oldMemos.push({
            year: currentYear,
            month: currentMonth,
            week_index: w,
            day_index: d,
            row_index: row,
            col_index: col,
            content: memo?.content || '',
            bg_color: memo?.bg_color || null,
            merge_span: memo?.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null },
          });
          payload.push({
            year: currentYear,
            month: currentMonth,
            week_index: w,
            day_index: d,
            row_index: row,
            col_index: col,
            merge_span: isMaster
              ? { rowSpan: maxRow - minRow + 1, colSpan: maxCol - minCol + 1, mergedInto: null }
              : { rowSpan: 1, colSpan: 1, mergedInto: masterKey },
            content: '',
          });
        }
      }

      const mergedText = combinedContent.filter(Boolean).join('\n');
      payload.forEach((item) => {
        if (!item.merge_span.mergedInto) {
          item.content = mergedText;
        }
      });
    }

    if (payload.length > 0) {
      recordUndo({ type: 'bulk-edit', oldMemos });
      await saveShockwaveMemosBulk(payload);
      addToast(isAlreadyMerged ? '병합이 해제되었습니다' : '셀이 병합되었습니다', 'info');
    }
    setContextMenu(null);
  }, [computeSelectionInfo, currentYear, currentMonth, memos, saveShockwaveMemosBulk, addToast, cellKey, recordUndo, selectedKeys, setContextMenu]);

  return {
    deleteCells,
    tryMergeSelection,
  };
}
