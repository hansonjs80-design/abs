import { useCallback } from 'react';
import {
  buildDeleteCellsPayload,
  buildMergeSelectionPayload,
} from '../../lib/scheduleMergeUtils.js';
import { buildClearReservationGroupPayload } from '../../lib/scheduleReservationGroupUtils.js';
import { rememberDeletedScheduleDraft, removeDeletedScheduleDraft, removePendingScheduleDraft } from '../../lib/schedulerUtils.js';

export default function useScheduleMergeActions({
  currentYear,
  currentMonth,
  memos,
  pendingDisplayValues,
  pendingMergeSpans,
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
    const deleteBatch = buildDeleteCellsPayload({
      keys,
      memos,
      pendingDisplayValues,
      pendingMergeSpans,
      currentYear,
      currentMonth,
      cellKey,
    });
    const clearGroupBatch = buildClearReservationGroupPayload({
      keys,
      memos,
      pendingDisplayValues,
      pendingMergeSpans,
      currentYear,
      currentMonth,
    });
    const payloadByKey = new Map();
    (clearGroupBatch.payload || []).forEach((item) => {
      payloadByKey.set(`${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`, item);
    });
    deleteBatch.payload.forEach((item) => {
      payloadByKey.set(`${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`, item);
    });
    const payload = Array.from(payloadByKey.values());
    const oldMemoByKey = new Map();
    [...(clearGroupBatch.oldMemos || []), ...deleteBatch.oldMemos].forEach((item) => {
      oldMemoByKey.set(`${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`, item);
    });
    const oldMemos = Array.from(oldMemoByKey.values());
    if (payload.length > 0) {
      recordUndo({ type: 'bulk-edit', oldMemos });
      payload.forEach((item) => {
        const draftYear = item.year ?? currentYear;
        const draftMonth = item.month ?? currentMonth;
        const draftKey = `${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`;
        rememberDeletedScheduleDraft(draftYear, draftMonth, draftKey);
        removePendingScheduleDraft(draftYear, draftMonth, draftKey);
      });
      applyImmediateCellDisplay(payload);
      applyImmediateMergeSpan(payload);
      const success = await saveShockwaveMemosBulk(payload);
      if (success) {
        clearImmediateCellDisplay(payload, { force: true });
      } else {
        payload.forEach((item) => {
          const draftYear = item.year ?? currentYear;
          const draftMonth = item.month ?? currentMonth;
          const draftKey = `${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`;
          removeDeletedScheduleDraft(draftYear, draftMonth, draftKey);
        });
        applyImmediateCellDisplay(oldMemos);
        applyImmediateMergeSpan(oldMemos);
        addToast('삭제 실패', 'error');
      }
    }
  }, [
    currentYear,
    currentMonth,
    memos,
    pendingDisplayValues,
    pendingMergeSpans,
    saveShockwaveMemosBulk,
    recordUndo,
    cellKey,
    applyImmediateCellDisplay,
    applyImmediateMergeSpan,
    clearImmediateCellDisplay,
    addToast,
  ]);

  const tryMergeSelection = useCallback(async () => {
    const selection = computeSelectionInfo();
    if (!selection) return;
    const isAlreadyMerged = selection.isMergedMaster &&
                            selection.selectionRowSpan === (selection.masterSpan?.rowSpan || 1) &&
                            selection.selectionColSpan === (selection.masterSpan?.colSpan || 1);
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
