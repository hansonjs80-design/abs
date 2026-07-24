import { useCallback } from 'react';
import {
  buildDeleteCellsPayload,
  buildMergeSelectionPayload,
} from '../../lib/scheduleMergeUtils.js';
import {
  rememberDeletedShockwaveScheduleItem,
  removeDeletedShockwaveScheduleItem,
} from '../../lib/scheduleDraftIdentityUtils.js';
import { buildClearReservationGroupPayload } from '../../lib/scheduleReservationGroupUtils.js';
import { removePendingScheduleDraft } from '../../lib/schedulerUtils.js';

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
  onDeletePayloadStart,
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
    const deletedKeys = new Set(
      deleteBatch.payload.map((item) => (
        `${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`
      ))
    );
    const payload = Array.from(payloadByKey.values());
    const oldMemoByKey = new Map();
    [...(clearGroupBatch.oldMemos || []), ...deleteBatch.oldMemos].forEach((item) => {
      oldMemoByKey.set(`${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`, item);
    });
    const oldMemos = Array.from(oldMemoByKey.values());
    if (payload.length > 0) {
      onDeletePayloadStart?.(payload);
      recordUndo({ type: 'bulk-edit', oldMemos });
      payload.forEach((item) => {
        const visibleKey = `${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`;
        if (!deletedKeys.has(visibleKey)) return;
        const draftYear = item.year ?? currentYear;
        const draftMonth = item.month ?? currentMonth;
        rememberDeletedShockwaveScheduleItem(item, currentYear, currentMonth);
        removePendingScheduleDraft(draftYear, draftMonth, visibleKey);
      });
      applyImmediateCellDisplay(payload);
      applyImmediateMergeSpan(payload);
      const success = await saveShockwaveMemosBulk(payload);
      if (success) {
        clearImmediateCellDisplay(payload, { force: true });
      } else {
        payload.forEach((item) => {
          const visibleKey = `${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`;
          if (!deletedKeys.has(visibleKey)) return;
          removeDeletedShockwaveScheduleItem(item, currentYear, currentMonth);
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
    onDeletePayloadStart,
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
