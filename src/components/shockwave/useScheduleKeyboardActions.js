import { useCallback } from 'react';
import {
  applyVisitCountToSchedulerContent,
  getExplicitVisitSuffix,
  isUndoShortcutEvent,
  stepVisitInputValue,
} from '../../lib/schedulerUtils';

export default function useScheduleKeyboardActions({
  contextMenu,
  selectedCell,
  editingCell,
  selectedKeys,
  pendingDisplayValues,
  currentYear,
  currentMonth,
  memos,
  imeOpenRef,
  cellKey,
  colCount,
  deleteCells,
  buildRangeKeys,
  selectSingleCell,
  getAdjacentCell,
  beginEditingCell,
  handleCopySelection,
  handleCutSelection,
  handleToggleTreatmentComplete,
  handleToggleTreatmentCancel,
  handleToggleHolidayBackground,
  tryMergeSelection,
  doUndo,
  isEditableTarget,
  isContextMenuTarget,
  handleOpenPatientHistoryModal,
  buildMemoSnapshotForKeys,
  onSaveMemo,
  recordUndo,
  addToast,
  setEditingCell,
  setRangeEnd,
  setSelectedKeys,
}) {
  return useCallback((e) => {
    if (e.defaultPrevented) return;
    if (isContextMenuTarget(e.target)) return;
    if (isUndoShortcutEvent(e)) {
      if (e.__shockwaveUndoHandled) return;
      e.__shockwaveUndoHandled = true;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation?.();
      doUndo();
      return;
    }
    const isMeta = e.metaKey || e.ctrlKey;

    if (isMeta && (e.code === 'KeyF' || e.key.toLowerCase() === 'f')) {
      e.preventDefault();
      e.stopPropagation();
      handleOpenPatientHistoryModal();
      return;
    }

    if (isEditableTarget(e.target)) return;
    if (contextMenu) {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    if (!selectedCell) return;
    const { w, d, r, c } = selectedCell;

    if (editingCell) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setEditingCell(null);
      }
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      const key = cellKey(w, d, r, c);
      beginEditingCell(key, memos[key]?.content || '', true);
      return;
    }

    if (e.key === 'F2') {
      e.preventDefault();
      const key = cellKey(w, d, r, c);
      beginEditingCell(key, memos[key]?.content || '', true);
      return;
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      deleteCells(selectedKeys);
      return;
    }

    if (isMeta && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.key === 'ArrowUp' ? 1 : -1;
      const keys = Array.from(selectedKeys || []);
      const oldMemos = buildMemoSnapshotForKeys(keys);
      let anyChanged = false;

      (async () => {
        for (const key of keys) {
          const [kw, kd, kr, kc] = key.split('-').map(Number);
          const memo = memos[key] || {};
          const stableContent = (typeof memo.content === 'string' ? memo.content : pendingDisplayValues[key]) || '';
          if (!stableContent) continue;

          const visitSuffix = getExplicitVisitSuffix(stableContent);
          const currentVisit = visitSuffix.replace(/[()]/g, '') || '';
          const nextVisit = stepVisitInputValue(currentVisit, delta);
          const updatedContent = applyVisitCountToSchedulerContent(stableContent, nextVisit);
          if (updatedContent === stableContent) continue;

          const success = await onSaveMemo(
            currentYear,
            currentMonth,
            kw,
            kd,
            kr,
            kc,
            updatedContent,
            memo.bg_color,
            memo.merge_span,
            memo.prescription,
            memo.body_part
          );
          if (success) anyChanged = true;
        }
        if (anyChanged) {
          recordUndo({ type: 'bulk-edit', oldMemos });
          addToast(`회차가 ${delta > 0 ? '증가' : '감소'}했습니다.`, 'success');
        }
      })();
      return;
    }

    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      const nextCell = getAdjacentCell({ w, d, r, c }, e.key);

      if (e.shiftKey) {
        setRangeEnd(nextCell);
        setSelectedKeys(buildRangeKeys(selectedCell, nextCell));
      } else {
        selectSingleCell(nextCell);
      }
      return;
    }

    if (isMeta && (e.code === 'Minus' || e.key === '-')) {
      e.preventDefault();
      e.stopPropagation();
      handleToggleTreatmentCancel();
      return;
    }

    if (isMeta && e.code === 'KeyG') {
      e.preventDefault();
      e.stopPropagation();
      handleToggleTreatmentComplete();
      return;
    }

    if (isMeta && e.code === 'KeyB') {
      e.preventDefault();
      e.stopPropagation();
      handleToggleHolidayBackground();
      return;
    }

    if (isMeta && e.code === 'KeyE') {
      e.preventDefault();
      tryMergeSelection();
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      const nextCol = e.shiftKey ? Math.max(0, c - 1) : Math.min(colCount - 1, c + 1);
      selectSingleCell({ w, d, r, c: nextCol });
      return;
    }

    if (isMeta && e.code === 'KeyC') {
      e.preventDefault();
      handleCopySelection();
      return;
    }

    if (isMeta && e.code === 'KeyX') {
      e.preventDefault();
      handleCutSelection();
      return;
    }

    if ((e.key.length === 1 || e.key === 'Process' || e.keyCode === 229) && !isMeta && !e.altKey) {
      const key = cellKey(w, d, r, c);
      const isImeCompositionKey =
        e.key === 'Process' ||
        e.keyCode === 229 ||
        e.nativeEvent?.isComposing ||
        (e.key.length === 1 && e.key.charCodeAt(0) > 127);
      if (isImeCompositionKey) {
        imeOpenRef.current = true;
      } else {
        e.preventDefault();
        beginEditingCell(key, e.key, false);
      }
    }
  }, [
    contextMenu,
    selectedCell,
    editingCell,
    selectedKeys,
    pendingDisplayValues,
    currentYear,
    currentMonth,
    memos,
    imeOpenRef,
    cellKey,
    colCount,
    deleteCells,
    buildRangeKeys,
    selectSingleCell,
    getAdjacentCell,
    beginEditingCell,
    handleCopySelection,
    handleCutSelection,
    handleToggleTreatmentComplete,
    handleToggleTreatmentCancel,
    handleToggleHolidayBackground,
    tryMergeSelection,
    doUndo,
    isEditableTarget,
    isContextMenuTarget,
    handleOpenPatientHistoryModal,
    buildMemoSnapshotForKeys,
    onSaveMemo,
    recordUndo,
    addToast,
    setEditingCell,
    setRangeEnd,
    setSelectedKeys,
  ]);
}
