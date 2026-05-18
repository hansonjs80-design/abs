import { useCallback } from 'react';
import {
  SCHEDULER_HOLIDAY_BG,
} from '../../lib/schedulerUtils';
import {
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
  const applyTreatmentCompleteToSelection = useCallback(async (mode) => {
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
      setContextMenu(null);
      return false;
    }

    recordUndo({ type: 'bulk-edit', oldMemos: batch.oldMemos });
    applyImmediateCellBg?.(batch.payload);
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
      setContextMenu(null);
      return false;
    }

    setContextMenu(null);
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

  const handleToggleTreatmentComplete = useCallback(async () => {
    await applyTreatmentCompleteToSelection('toggle');
  }, [applyTreatmentCompleteToSelection]);

  const handleToggleTreatmentCancel = useCallback(async () => {
    await applyTreatmentCompleteToSelection('cancel-toggle');
  }, [applyTreatmentCompleteToSelection]);

  const handleToggleHolidayBackground = useCallback(async () => {
    if (!selectedKeys || selectedKeys.size === 0) return;

    const effectiveKeys = normalizeKeysToMergeMasters(selectedKeys);
    const shouldClearSelection = Array.from(effectiveKeys).some(
      (key) => memos[key]?.bg_color === SCHEDULER_HOLIDAY_BG
    );
    const nextBgColor = shouldClearSelection ? null : SCHEDULER_HOLIDAY_BG;
    const touchedKeys = new Set();
    const oldMemos = [];
    const payload = [];

    Array.from(effectiveKeys).forEach((key) => {
      const [w, d, r, c] = key.split('-').map(Number);
      const memo = memos[key];
      const masterSpan = memo?.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null };
      const rowSpan = Math.max(1, masterSpan.rowSpan || 1);
      const colSpan = Math.max(1, masterSpan.colSpan || 1);

      for (let row = r; row < r + rowSpan; row += 1) {
        for (let col = c; col < c + colSpan; col += 1) {
          const rangeKey = cellKey(w, d, row, col);
          if (touchedKeys.has(rangeKey)) continue;
          touchedKeys.add(rangeKey);

          const rangeMemo = memos[rangeKey];
          if ((rangeMemo?.bg_color || null) === nextBgColor) continue;

          oldMemos.push({
            year: currentYear,
            month: currentMonth,
            week_index: w,
            day_index: d,
            row_index: row,
            col_index: col,
            content: rangeMemo?.content || '',
            bg_color: rangeMemo?.bg_color || null,
            merge_span: rangeMemo?.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null },
            prescription: rangeMemo?.prescription || null,
            body_part: rangeMemo?.body_part || null,
          });

          payload.push({
            year: currentYear,
            month: currentMonth,
            week_index: w,
            day_index: d,
            row_index: row,
            col_index: col,
            content: rangeMemo?.content || '',
            bg_color: nextBgColor,
            merge_span: rangeMemo?.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null },
            prescription: rangeMemo?.prescription || null,
            body_part: rangeMemo?.body_part || null,
          });
        }
      }
    });

    if (payload.length === 0) return;
    recordUndo({ type: 'bulk-edit', oldMemos });
    const success = await saveShockwaveMemosBulk(payload);
    if (!success) addToast('배경색 변경 실패', 'error');
  }, [selectedKeys, memos, currentYear, currentMonth, normalizeKeysToMergeMasters, cellKey, saveShockwaveMemosBulk, addToast, recordUndo]);

  return {
    handleToggleTreatmentComplete,
    handleToggleTreatmentCancel,
    handleToggleHolidayBackground,
  };
}
