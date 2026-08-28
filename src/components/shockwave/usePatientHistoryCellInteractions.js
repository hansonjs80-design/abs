import { useCallback, useEffect, useRef, useState } from 'react';
import {
  applyPatientHistoryBodyPartAction,
  applyPatientHistoryMemoAction,
  buildPatientHistoryUndoAction,
  getPatientHistoryEscapeAction,
  getPatientHistoryEditorPlacement,
  getPatientHistoryCellClipboardMode,
  getPatientHistoryCellClipboardText,
  getPatientHistoryUndoRestoreChanges,
  isPatientHistoryEditorAction,
  isPatientHistoryCellClearShortcut,
  isPatientHistoryCellEditorShortcut,
  normalizePatientHistoryCellValue,
} from '../../lib/patientHistoryCellInteractionUtils';
import {
  parsePatientHistoryBodyPartText,
  parsePatientHistoryMemoText,
} from '../../lib/patientHistoryModalUtils';
import { buildMergeSpanWithMemoList, isUndoShortcutEvent } from '../../lib/schedulerUtils';

const getHistoryRowKey = (log) => log?._history_row_key || log?.id;

const isEditableElement = (target) => (
  target instanceof HTMLInputElement
  || target instanceof HTMLTextAreaElement
  || target instanceof HTMLSelectElement
  || Boolean(target?.isContentEditable)
);

export default function usePatientHistoryCellInteractions({
  modalOpen,
  logs,
  contextMenu,
  updateModalLog,
  updateHistoryField,
  updateHistoryMemo,
  addToast,
  setClipboardSource,
  setContextMenu,
  setActiveContextSubmenu,
  setContextMenuBodyPartOptions,
  setContextMenuHiddenBodyPartKeys,
  setContextMenuMemoDrafts,
  setContextMenuMemoFocusSignal,
}) {
  const [selectedCell, setSelectedCell] = useState(null);
  const [clipboardCell, setClipboardCell] = useState(null);
  const logsRef = useRef(logs || []);
  const selectedCellRef = useRef(null);
  const clipboardRef = useRef(null);
  const undoStackRef = useRef([]);
  const undoInProgressRef = useRef(false);

  useEffect(() => {
    logsRef.current = logs || [];
  }, [logs]);

  const findLog = useCallback((rowKey) => (
    logsRef.current.find((item) => getHistoryRowKey(item) === rowKey) || null
  ), []);

  const patchLog = useCallback((rowKey, updater) => {
    const currentLog = findLog(rowKey);
    if (!currentLog) return null;
    const nextLog = typeof updater === 'function'
      ? updater(currentLog)
      : { ...currentLog, ...updater };
    logsRef.current = logsRef.current.map((item) => (
      getHistoryRowKey(item) === rowKey ? nextLog : item
    ));
    updateModalLog(rowKey, nextLog);
    return nextLog;
  }, [findLog, updateModalLog]);

  const clearClipboardCell = useCallback(() => {
    clipboardRef.current = null;
    setClipboardCell(null);
  }, []);

  const clearCellSelection = useCallback(({ clearClipboard = false } = {}) => {
    selectedCellRef.current = null;
    setSelectedCell(null);
    setClipboardSource(null);
    if (clearClipboard) clearClipboardCell();
  }, [clearClipboardCell, setClipboardSource]);

  const recordHistoryUndo = useCallback((changes) => {
    const action = buildPatientHistoryUndoAction(changes);
    if (!action) return;
    undoStackRef.current = [
      action,
      ...undoStackRef.current,
    ].slice(0, 50);
  }, []);

  const persistCellValue = useCallback(async (cell, rawValue, { recordUndo = true } = {}) => {
    const log = findLog(cell?.rowKey);
    if (!log || !cell?.field) return false;
    if (cell.field === 'memo' && !cell.canEdit) {
      addToast('스케줄과 연결되지 않은 기존 기록은 메모를 수정할 수 없습니다.', 'warning');
      return false;
    }

    const nextValue = normalizePatientHistoryCellValue(cell.field, rawValue);
    const originalKey = cell.field === 'body_part' ? '_original_body_part' : '_original_memo';
    const currentValue = normalizePatientHistoryCellValue(cell.field, log[cell.field]);
    if (nextValue === currentValue) return true;

    patchLog(cell.rowKey, { [cell.field]: nextValue });
    const success = cell.field === 'body_part'
      ? await updateHistoryField(log, 'body_part', nextValue)
      : await updateHistoryMemo(log, nextValue);
    patchLog(cell.rowKey, (latest) => (
      success
        ? { ...latest, [cell.field]: nextValue, [originalKey]: nextValue }
        : { ...latest, [cell.field]: currentValue }
    ));
    if (success && recordUndo) {
      recordHistoryUndo([{
        cell,
        previousValue: currentValue,
        nextValue,
      }]);
    }
    return Boolean(success);
  }, [addToast, findLog, patchLog, recordHistoryUndo, updateHistoryField, updateHistoryMemo]);

  const updateEditorDisplay = useCallback((cell, value) => {
    if (!cell) return;
    const normalizedValue = normalizePatientHistoryCellValue(cell.field, value);
    const memoItems = cell.field === 'memo'
      ? parsePatientHistoryMemoText(normalizedValue)
      : null;
    if (cell.field === 'body_part') {
      setContextMenuBodyPartOptions(parsePatientHistoryBodyPartText(normalizedValue));
    } else {
      setContextMenuMemoDrafts(memoItems);
    }
    setContextMenu((prev) => {
      if (!prev?.patientHistoryCell || prev.patientHistoryCell.id !== cell.id) return prev;
      const previousSnapshot = prev.memoSnapshot || {};
      return {
        ...prev,
        memoSnapshot: cell.field === 'body_part'
          ? { ...previousSnapshot, body_part: normalizedValue }
          : {
              ...previousSnapshot,
              merge_span: buildMergeSpanWithMemoList(previousSnapshot.merge_span, memoItems),
            },
      };
    });
  }, [setContextMenu, setContextMenuBodyPartOptions, setContextMenuMemoDrafts]);

  const undoLastHistoryChange = useCallback(async () => {
    if (undoInProgressRef.current) return true;
    const [action, ...remainingActions] = undoStackRef.current;
    if (!action) {
      addToast('되돌릴 내역 셀 변경이 없습니다.', 'info');
      return true;
    }

    undoStackRef.current = remainingActions;
    undoInProgressRef.current = true;
    let success = true;
    try {
      const restoreChanges = getPatientHistoryUndoRestoreChanges(action);
      for (const change of restoreChanges) {
        const restored = await persistCellValue(change.cell, change.value, {
          recordUndo: false,
        });
        if (!restored) {
          success = false;
          break;
        }
        updateEditorDisplay(change.cell, change.value);
      }
    } finally {
      undoInProgressRef.current = false;
    }

    if (!success) {
      undoStackRef.current = [action, ...undoStackRef.current].slice(0, 50);
      addToast('내역 셀 변경을 되돌리지 못했습니다.', 'warning');
      return true;
    }

    clearClipboardCell();
    addToast('내역 셀 변경을 되돌렸습니다.', 'success');
    return true;
  }, [addToast, clearClipboardCell, persistCellValue, updateEditorDisplay]);

  const selectCell = useCallback((event, cell) => {
    event.preventDefault();
    event.stopPropagation();
    selectedCellRef.current = cell;
    setSelectedCell(cell);
    setClipboardSource(null);
    if (contextMenu?.patientHistoryCell) setContextMenu(null);
    event.currentTarget?.focus?.({ preventScroll: true });
  }, [contextMenu?.patientHistoryCell, setClipboardSource, setContextMenu]);

  const openEditorAtRect = useCallback((cell, rect) => {
    const log = findLog(cell.rowKey);
    if (!log || !rect) return;
    if (cell.field === 'memo' && !cell.canEdit) {
      addToast('스케줄과 연결되지 않은 기존 기록은 메모를 수정할 수 없습니다.', 'warning');
      return;
    }

    selectedCellRef.current = cell;
    setSelectedCell(cell);
    setClipboardSource(null);
    const viewportGap = 10;
    const editorPlacement = getPatientHistoryEditorPlacement({
      rect,
      field: cell.field,
      viewportWidth: window.innerWidth,
      viewportGap,
    });
    const y = Math.min(
      Math.max(viewportGap, rect.top),
      Math.max(viewportGap, window.innerHeight - 360),
    );
    const bodyParts = parsePatientHistoryBodyPartText(log.body_part);
    const memoItems = parsePatientHistoryMemoText(log.memo);
    setContextMenuBodyPartOptions(bodyParts);
    setContextMenuHiddenBodyPartKeys(new Set());
    setContextMenuMemoDrafts(memoItems);
    setActiveContextSubmenu(cell.field === 'body_part' ? 'body' : 'memo');
    setContextMenu({
      x: editorPlacement.x,
      y,
      weekIdx: Number(log.week_index) || 0,
      dayIdx: Number(log.day_index) || 0,
      rowIdx: Number(log.row_index) || 0,
      colIdx: Number(log.col_index) || 0,
      currentPrescription: log.prescription || '',
      isNearRightEdge: false,
      isStandaloneSubmenu: true,
      patientHistoryEditorWidth: editorPlacement.width,
      openedAt: Date.now(),
      patientHistoryCell: cell,
      memoSnapshot: {
        content: [log.chart_number, log.patient_name].filter(Boolean).join('/'),
        prescription: log.prescription || '',
        body_part: normalizePatientHistoryCellValue('body_part', log.body_part),
        merge_span: buildMergeSpanWithMemoList(log.merge_span, memoItems),
      },
    });
    if (cell.field === 'memo') {
      setContextMenuMemoFocusSignal((signal) => signal + 1);
    }
  }, [
    addToast,
    findLog,
    setActiveContextSubmenu,
    setClipboardSource,
    setContextMenu,
    setContextMenuBodyPartOptions,
    setContextMenuHiddenBodyPartKeys,
    setContextMenuMemoDrafts,
    setContextMenuMemoFocusSignal,
  ]);

  const openEditor = useCallback((event, cell) => {
    event.preventDefault();
    event.stopPropagation();
    openEditorAtRect(cell, event.currentTarget?.getBoundingClientRect?.());
  }, [openEditorAtRect]);

  const handleContextAction = useCallback(async (action) => {
    const cell = contextMenu?.patientHistoryCell;
    if (!cell || !isPatientHistoryEditorAction(cell.field, action)) return false;
    const log = findLog(cell.rowKey);
    if (!log) return true;
    const currentValue = normalizePatientHistoryCellValue(cell.field, log[cell.field]);
    const nextValue = cell.field === 'body_part'
      ? applyPatientHistoryBodyPartAction(currentValue, action)
      : applyPatientHistoryMemoAction(currentValue, action);
    if (nextValue === currentValue) return true;

    updateEditorDisplay(cell, nextValue);
    const success = await persistCellValue(cell, nextValue);
    if (!success) updateEditorDisplay(cell, currentValue);
    return true;
  }, [contextMenu?.patientHistoryCell, findLog, persistCellValue, updateEditorDisplay]);

  const copyOrCut = useCallback((mode) => {
    const activeCell = selectedCellRef.current;
    if (!activeCell) return;
    if (mode === 'cut' && activeCell.field === 'memo' && !activeCell.canEdit) {
      addToast('스케줄과 연결되지 않은 기존 기록은 메모를 잘라낼 수 없습니다.', 'warning');
      return;
    }
    const log = findLog(activeCell.rowKey);
    if (!log) return;
    const plainText = getPatientHistoryCellClipboardText(activeCell.field, log[activeCell.field]);
    clipboardRef.current = {
      mode,
      sourceCell: { ...activeCell },
      plainText,
    };
    setClipboardCell({ id: activeCell.id, mode });
    setClipboardSource(null);
    navigator.clipboard?.writeText(plainText).catch(() => {
      console.debug('Patient history clipboard sync failed.');
    });
    addToast(mode === 'cut' ? '잘라내기됨 (붙여넣기 시 원본 삭제)' : '복사됨', 'info');
  }, [addToast, findLog, setClipboardSource]);

  const clearSelectedCell = useCallback(async () => {
    const activeCell = selectedCellRef.current;
    if (!activeCell) return;
    if (activeCell.field === 'memo' && !activeCell.canEdit) {
      addToast('스케줄과 연결되지 않은 기존 기록은 메모를 삭제할 수 없습니다.', 'warning');
      return;
    }
    await persistCellValue(activeCell, '');
  }, [addToast, persistCellValue]);

  const dismissCellInteraction = useCallback(() => {
    const action = getPatientHistoryEscapeAction({
      hasClipboardCell: Boolean(clipboardCell),
      hasContextMenu: Boolean(contextMenu?.patientHistoryCell),
      hasSelectedCell: Boolean(selectedCell),
    });

    if (action === 'clear-clipboard') {
      clearClipboardCell();
      return true;
    }
    if (action === 'close-editor') {
      setContextMenu(null);
      setActiveContextSubmenu(null);
      return true;
    }
    if (action === 'clear-selection') {
      clearCellSelection();
      return true;
    }
    return false;
  }, [
    clipboardCell,
    clearCellSelection,
    clearClipboardCell,
    contextMenu?.patientHistoryCell,
    selectedCell,
    setActiveContextSubmenu,
    setContextMenu,
  ]);

  useEffect(() => {
    if (!modalOpen) return undefined;

    const handleKeyDown = (event) => {
      if (event.target?.closest?.('.patient-history-context-menu')) return;
      if (
        isEditableElement(event.target)
        && event.target?.closest?.('.patient-history-search-input, .patient-history-edit-field--prescription')
      ) return;
      if (isUndoShortcutEvent(event)) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        undoLastHistoryChange();
        return;
      }
      const activeCell = selectedCellRef.current;
      if (!activeCell) return;
      if (isPatientHistoryCellEditorShortcut(event)) {
        const cellElement = event.target?.closest?.('.patient-history-data-cell--selectable')
          || document.activeElement?.closest?.('.patient-history-data-cell--selectable');
        if (!cellElement) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        openEditorAtRect(activeCell, cellElement.getBoundingClientRect());
        return;
      }
      if (isPatientHistoryCellClearShortcut(event)) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        clearSelectedCell();
        return;
      }
      const clipboardMode = getPatientHistoryCellClipboardMode(event);
      if (!clipboardMode) return;
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      copyOrCut(clipboardMode);
    };

    const handleClipboardWrite = (event) => {
      if (event.target?.closest?.('.patient-history-context-menu')) return;
      if (
        isEditableElement(event.target)
        && event.target?.closest?.('.patient-history-search-input, .patient-history-edit-field--prescription')
      ) return;
      const activeCell = selectedCellRef.current;
      if (!activeCell) return;

      const mode = event.type === 'cut' ? 'cut' : 'copy';
      const currentClipboard = clipboardRef.current;
      if (
        !currentClipboard
        || currentClipboard.mode !== mode
        || currentClipboard.sourceCell?.id !== activeCell.id
      ) {
        copyOrCut(mode);
      }

      const nextClipboard = clipboardRef.current;
      if (
        !nextClipboard
        || nextClipboard.mode !== mode
        || nextClipboard.sourceCell?.id !== activeCell.id
      ) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      event.clipboardData?.setData('text/plain', nextClipboard.plainText);
    };

    const handlePaste = async (event) => {
      if (event.target?.closest?.('.patient-history-context-menu')) return;
      if (
        isEditableElement(event.target)
        && event.target?.closest?.('.patient-history-search-input, .patient-history-edit-field--prescription')
      ) return;
      const activeCell = selectedCellRef.current;
      if (!activeCell) return;
      const pastedText = event.clipboardData?.getData('text/plain');
      const internalClipboard = clipboardRef.current;
      if (typeof pastedText !== 'string') return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();

      const normalizedPastedText = pastedText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const isInternalClipboard = internalClipboard
        && normalizedPastedText === String(internalClipboard.plainText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const activeLog = findLog(activeCell.rowKey);
      const targetPreviousValue = normalizePatientHistoryCellValue(
        activeCell.field,
        activeLog?.[activeCell.field],
      );
      const success = await persistCellValue(activeCell, normalizedPastedText, { recordUndo: false });
      if (!success) return;
      if (!isInternalClipboard) {
        recordHistoryUndo([{
          cell: activeCell,
          previousValue: targetPreviousValue,
          nextValue: normalizedPastedText,
        }]);
        clearClipboardCell();
        return;
      }
      if (internalClipboard.mode !== 'cut') {
        recordHistoryUndo([{
          cell: activeCell,
          previousValue: targetPreviousValue,
          nextValue: normalizedPastedText,
        }]);
        clearClipboardCell();
        return;
      }

      const sourceCell = internalClipboard.sourceCell;
      if (!sourceCell || sourceCell.id === activeCell.id) {
        recordHistoryUndo([{
          cell: activeCell,
          previousValue: targetPreviousValue,
          nextValue: normalizedPastedText,
        }]);
        clearClipboardCell();
        return;
      }
      const sourceLog = findLog(sourceCell.rowKey);
      const sourcePreviousValue = normalizePatientHistoryCellValue(
        sourceCell.field,
        sourceLog?.[sourceCell.field],
      );
      const cleared = await persistCellValue(sourceCell, '', { recordUndo: false });
      if (cleared) {
        recordHistoryUndo([
          {
            cell: activeCell,
            previousValue: targetPreviousValue,
            nextValue: normalizedPastedText,
          },
          {
            cell: sourceCell,
            previousValue: sourcePreviousValue,
            nextValue: '',
          },
        ]);
        clearClipboardCell();
        addToast('잘라낸 셀을 이동했습니다.', 'success');
      } else {
        recordHistoryUndo([{
          cell: activeCell,
          previousValue: targetPreviousValue,
          nextValue: normalizedPastedText,
        }]);
        clearClipboardCell();
        addToast('붙여넣기는 완료됐지만 원본 셀을 비우지 못했습니다.', 'warning');
      }
    };

    const handleOutsideMouseDown = (event) => {
      if (event.target?.closest?.(
        '.patient-history-data-cell--selectable, .patient-history-context-menu',
      )) return;
      if (!selectedCellRef.current && !clipboardRef.current) return;
      clearCellSelection({ clearClipboard: true });
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('copy', handleClipboardWrite, true);
    window.addEventListener('cut', handleClipboardWrite, true);
    window.addEventListener('paste', handlePaste, true);
    window.addEventListener('mousedown', handleOutsideMouseDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('copy', handleClipboardWrite, true);
      window.removeEventListener('cut', handleClipboardWrite, true);
      window.removeEventListener('paste', handlePaste, true);
      window.removeEventListener('mousedown', handleOutsideMouseDown, true);
    };
  }, [
    addToast,
    clearCellSelection,
    clearClipboardCell,
    clearSelectedCell,
    copyOrCut,
    findLog,
    modalOpen,
    openEditorAtRect,
    persistCellValue,
    recordHistoryUndo,
    undoLastHistoryChange,
  ]);

  useEffect(() => {
    if (modalOpen) return;
    selectedCellRef.current = null;
    setSelectedCell(null);
    setClipboardCell(null);
    clipboardRef.current = null;
    undoStackRef.current = [];
    setContextMenu((prev) => (prev?.patientHistoryCell ? null : prev));
  }, [modalOpen, setContextMenu]);

  return {
    dismissPatientHistoryCellInteraction: dismissCellInteraction,
    handlePatientHistoryContextAction: handleContextAction,
    openPatientHistoryCellEditor: openEditor,
    patientHistoryClipboardCell: clipboardCell,
    selectPatientHistoryCell: selectCell,
    selectedPatientHistoryCell: selectedCell,
  };
}
