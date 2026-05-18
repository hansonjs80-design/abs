import { useCallback, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

export default function useScheduleUndoActions({
  applyImmediateCellDisplay,
  applyImmediateMergeSpan,
  clearImmediateCellDisplay,
  currentMonth,
  currentYear,
  memos,
  onSaveMemo,
  pendingDisplayValues,
  saveShockwaveMemosBulk,
  setContextMenu,
  setEditingCell,
}) {
  const [, setUndoStack] = useState([]);
  const undoStackRef = useRef([]);
  const undoQueueRef = useRef(Promise.resolve());

  const recordUndo = useCallback((action) => {
    undoStackRef.current = [action, ...undoStackRef.current].slice(0, 50);
    setUndoStack(undoStackRef.current);
  }, []);

  const buildMemoSnapshotForKeys = useCallback((keys) => {
    return Array.from(new Set(keys || [])).map((key) => {
      const [w, d, r, c] = key.split('-').map(Number);
      const memo = memos[key] || {};
      const stableContent = key in pendingDisplayValues ? pendingDisplayValues[key] : memo.content;
      return {
        year: currentYear,
        month: currentMonth,
        week_index: w,
        day_index: d,
        row_index: r,
        col_index: c,
        content: stableContent || '',
        bg_color: memo.bg_color || null,
        merge_span: memo.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null },
        prescription: memo.prescription || null,
        body_part: memo.body_part || null,
      };
    });
  }, [currentYear, currentMonth, memos, pendingDisplayValues]);

  const doUndo = useCallback(() => {
    const [action, ...rest] = undoStackRef.current;
    if (!action) return false;
    undoStackRef.current = rest;
    flushSync(() => {
      setUndoStack(rest);
      setEditingCell(null);
      setContextMenu(null);
    });

    const undoPayload = action.type === 'bulk-edit'
      ? action.oldMemos
      : action.type === 'edit'
        ? [{
            year: action.year || currentYear,
            month: action.month || currentMonth,
            week_index: action.w,
            day_index: action.d,
            row_index: action.r,
            col_index: action.c,
            content: action.oldContent,
            bg_color: action.oldBg,
            merge_span: action.oldMergeSpan,
            prescription: action.oldPrescription,
            body_part: action.oldBodyPart,
          }]
        : [];
    applyImmediateCellDisplay(undoPayload);
    applyImmediateMergeSpan(undoPayload);

    undoQueueRef.current = undoQueueRef.current.then(async () => {
      if (action.type === 'bulk-edit') {
        const success = await saveShockwaveMemosBulk(action.oldMemos);
        if (success) clearImmediateCellDisplay(action.oldMemos);
      } else if (action.type === 'edit') {
        const {
          year,
          month,
          w,
          d,
          r,
          c,
          oldContent,
          oldBg,
          oldMergeSpan,
          oldPrescription,
          oldBodyPart,
        } = action;
        const undoMemo = {
          year: year || currentYear,
          month: month || currentMonth,
          week_index: w,
          day_index: d,
          row_index: r,
          col_index: c,
          content: oldContent,
          bg_color: oldBg,
          merge_span: oldMergeSpan,
          prescription: oldPrescription,
          body_part: oldBodyPart,
        };
        const success = await onSaveMemo(
          year || currentYear,
          month || currentMonth,
          w,
          d,
          r,
          c,
          oldContent,
          oldBg,
          oldMergeSpan,
          oldPrescription,
          oldBodyPart
        );
        if (success) clearImmediateCellDisplay(undoMemo);
      }
    }).catch((error) => {
      console.error('Undo failed:', error);
    });
    return true;
  }, [
    applyImmediateCellDisplay,
    applyImmediateMergeSpan,
    clearImmediateCellDisplay,
    currentMonth,
    currentYear,
    onSaveMemo,
    saveShockwaveMemosBulk,
    setContextMenu,
    setEditingCell,
  ]);

  return {
    buildMemoSnapshotForKeys,
    doUndo,
    recordUndo,
  };
}
