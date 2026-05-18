import { useCallback } from 'react';
import {
  buildDeleteCellsPayload,
  buildMergeSelectionPayload,
} from '../../lib/scheduleMergeUtils.js';

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
  applyImmediateMergeSpan,
  clearImmediateCellDisplay,
  addToast,
  setContextMenu,
}) {
  const deleteCells = useCallback(async (keys) => {
    const { oldMemos, payload } = buildDeleteCellsPayload({
      keys,
      memos,
      pendingDisplayValues,
      currentYear,
      currentMonth,
      cellKey,
    });
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
    const isAlreadyMerged = selection.isMergedMaster;
    const hasMultipleSelectedCells = (selectedKeys?.size || 0) > 1;
    if (!isAlreadyMerged && !selection.selectionMultiple && !hasMultipleSelectedCells) return;

    const { oldMemos, payload } = buildMergeSelectionPayload({
      selection,
      memos,
      currentYear,
      currentMonth,
      cellKey,
    });

    if (payload.length > 0) {
      recordUndo({ type: 'bulk-edit', oldMemos });
      applyImmediateCellDisplay(payload);
      applyImmediateMergeSpan(payload);
      setContextMenu(null);

      const success = await saveShockwaveMemosBulk(payload);
      if (success) {
        clearImmediateCellDisplay(payload);
        addToast(isAlreadyMerged ? '병합이 해제되었습니다' : '셀이 병합되었습니다', 'info');
      } else {
        applyImmediateCellDisplay(oldMemos);
        applyImmediateMergeSpan(oldMemos);
        addToast(isAlreadyMerged ? '병합 해제 실패' : '병합 실패', 'error');
      }
    }
  }, [
    computeSelectionInfo,
    currentYear,
    currentMonth,
    memos,
    saveShockwaveMemosBulk,
    addToast,
    cellKey,
    recordUndo,
    selectedKeys,
    setContextMenu,
    applyImmediateCellDisplay,
    applyImmediateMergeSpan,
    clearImmediateCellDisplay,
  ]);

  return {
    deleteCells,
    tryMergeSelection,
  };
}
