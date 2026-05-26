import { useCallback } from 'react';
import {
  SCHEDULER_HOLIDAY_BG,
} from '../../lib/schedulerUtils';
import {
  buildHolidayBackgroundPayload,
  buildTreatmentStatusPayload,
} from '../../lib/scheduleStatusUtils';

export default function useScheduleStatusActions({
  selectedKeys,
  memos,
  currentYear,
  currentMonth,
  normalizeKeysToMergeMasters,
  cellKey,
  saveShockwaveMemosBulk,
  addToast,
  recordUndo,
  setContextMenu,
  pendingCellBgColors = {},
  applyImmediateCellBg,
  clearImmediateCellBg,
}) {
  const applyTreatmentCompleteToSelection = useCallback(async (mode, options = {}) => {
    const { keepContextMenuOpen = false } = options;
    const batch = buildTreatmentStatusPayload({
      mode,
      selectedKeys,
      memos,
      currentYear,
      currentMonth,
      normalizeKeysToMergeMasters,
      cellKey,
      pendingCellBgColors,
    });
    if (!batch) {
      if (!keepContextMenuOpen) setContextMenu(null);
      return false;
    }

    recordUndo({ type: 'bulk-edit', oldMemos: batch.oldMemos });
    applyImmediateCellBg?.(batch.payload, { keepContextMenuOpen });
    const success = await saveShockwaveMemosBulk(batch.payload);
    if (!success) {
      clearImmediateCellBg?.(batch.payload);
      addToast(
        mode === 'cancel-toggle'
          ? '취소 상태 변경 실패'
          : mode === 'complete'
            ? '치료 완료 표시 실패'
            : mode === 'clear'
              ? '치료 완료 해제 실패'
              : '치료 완료/해제 실패',
        'error'
      );
      if (!keepContextMenuOpen) setContextMenu(null);
      return false;
    }

    if (!keepContextMenuOpen) setContextMenu(null);
    return true;
  }, [
    selectedKeys,
    memos,
    currentYear,
    currentMonth,
    normalizeKeysToMergeMasters,
    cellKey,
    pendingCellBgColors,
    saveShockwaveMemosBulk,
    addToast,
    recordUndo,
    setContextMenu,
    applyImmediateCellBg,
    clearImmediateCellBg,
  ]);

  const handleToggleTreatmentComplete = useCallback(async (options) => {
    await applyTreatmentCompleteToSelection('toggle', options);
  }, [applyTreatmentCompleteToSelection]);

  const handleToggleTreatmentCancel = useCallback(async (options) => {
    await applyTreatmentCompleteToSelection('cancel-toggle', options);
  }, [applyTreatmentCompleteToSelection]);

  const handleToggleHolidayBackground = useCallback(async () => {
    const batch = buildHolidayBackgroundPayload({
      selectedKeys,
      memos,
      currentYear,
      currentMonth,
      normalizeKeysToMergeMasters,
      cellKey,
      holidayBgColor: SCHEDULER_HOLIDAY_BG,
      pendingCellBgColors,
    });
    if (!batch) return;

    recordUndo({ type: 'bulk-edit', oldMemos: batch.oldMemos });
    applyImmediateCellBg?.(batch.payload);
    const success = await saveShockwaveMemosBulk(batch.payload);
    if (!success) {
      clearImmediateCellBg?.(batch.payload);
      addToast('배경색 변경 실패', 'error');
    }
  }, [
    selectedKeys,
    memos,
    currentYear,
    currentMonth,
    normalizeKeysToMergeMasters,
    cellKey,
    saveShockwaveMemosBulk,
    addToast,
    recordUndo,
    pendingCellBgColors,
    applyImmediateCellBg,
    clearImmediateCellBg,
  ]);

  return {
    handleToggleTreatmentComplete,
    handleToggleTreatmentCancel,
    handleToggleHolidayBackground,
  };
}
