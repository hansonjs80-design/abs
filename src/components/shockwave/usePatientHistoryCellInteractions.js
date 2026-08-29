import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  applyPatientHistoryBodyPartAction,
  applyPatientHistoryMemoAction,
  buildPatientHistoryUndoAction,
  getPatientHistoryCellDirectInputText,
  getPatientHistoryCellNavigationDirection,
  getPatientHistoryVisitCountShortcutDelta,
  getPatientHistoryEscapeAction,
  getPatientHistoryEditorPlacement,
  getPatientHistoryInlineEditInitialValue,
  getPatientHistoryCellFromElement,
  getPatientHistoryCellClipboardMode,
  getPatientHistoryCellClipboardText,
  getPatientHistoryUndoRestoreChanges,
  isPatientHistoryEditorAction,
  isPatientHistoryCellClearShortcut,
  isPatientHistoryCellEditorShortcut,
  normalizePatientHistoryCellValue,
  stepPatientHistoryVisitCount,
} from '../../lib/patientHistoryCellInteractionUtils';
import {
  parsePatientHistoryBodyPartText,
  parsePatientHistoryMemoText,
} from '../../lib/patientHistoryModalUtils';
import { buildMergeSpanWithMemoList, isUndoShortcutEvent } from '../../lib/schedulerUtils';
import usePatientHistoryDragInteractions from './usePatientHistoryDragInteractions';

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
  updateHistoryVisitCount,
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
  const [selectedCellIds, setSelectedCellIds] = useState([]);
  const [clipboardCell, setClipboardCell] = useState(null);
  const [inlineEditor, setInlineEditor] = useState(null);
  const logsRef = useRef(logs || []);
  const selectedCellRef = useRef(null);
  const selectedCellsRef = useRef([]);
  const clipboardRef = useRef(null);
  const inlineEditorRef = useRef(null);
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
    selectedCellsRef.current = [];
    setSelectedCell(null);
    setSelectedCellIds([]);
    setClipboardSource(null);
    if (clearClipboard) clearClipboardCell();
  }, [clearClipboardCell, setClipboardSource]);

  const setCellSelection = useCallback((cells, primaryCell = cells?.[0] || null) => {
    const nextCells = (cells || []).filter(Boolean);
    selectedCellsRef.current = nextCells;
    selectedCellRef.current = primaryCell;
    setSelectedCell(primaryCell);
    setSelectedCellIds(nextCells.map((cell) => cell.id));
    setClipboardSource(null);
  }, [setClipboardSource]);

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
    const originalKey = cell.field === 'body_part'
      ? '_original_body_part'
      : cell.field === 'memo'
        ? '_original_memo'
        : '_original_visit_count';
    const currentValue = normalizePatientHistoryCellValue(cell.field, log[cell.field]);
    if (nextValue === currentValue) return true;

    patchLog(cell.rowKey, { [cell.field]: nextValue });
    const success = cell.field === 'body_part'
      ? await updateHistoryField(log, 'body_part', nextValue)
      : cell.field === 'memo'
        ? await updateHistoryMemo(log, nextValue)
        : await updateHistoryVisitCount(log, nextValue);
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
  }, [
    addToast,
    findLog,
    patchLog,
    recordHistoryUndo,
    updateHistoryField,
    updateHistoryMemo,
    updateHistoryVisitCount,
  ]);

  const updateEditorDisplay = useCallback((cell, value) => {
    if (!cell) return;
    const normalizedValue = normalizePatientHistoryCellValue(cell.field, value);
    if (cell.field === 'visit_count') return;
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

  const commitInlineCellEdit = useCallback(async (cell, rawValue) => {
    const activeEditor = inlineEditorRef.current;
    if (!activeEditor || activeEditor.cell?.id !== cell?.id) return true;

    const nextValue = normalizePatientHistoryCellValue(cell.field, rawValue ?? activeEditor.value);
    inlineEditorRef.current = null;
    setInlineEditor(null);
    return persistCellValue(cell, nextValue);
  }, [persistCellValue]);

  const cancelInlineCellEdit = useCallback((cell) => {
    if (inlineEditorRef.current?.cell?.id !== cell?.id) return false;
    inlineEditorRef.current = null;
    setInlineEditor(null);
    return true;
  }, []);

  const updateInlineCellDraft = useCallback((cell, rawValue) => {
    if (inlineEditorRef.current?.cell?.id !== cell?.id) return;
    const nextEditor = {
      ...inlineEditorRef.current,
      value: String(rawValue ?? ''),
    };
    inlineEditorRef.current = nextEditor;
    setInlineEditor(nextEditor);
  }, []);

  const beginInlineCellEdit = useCallback((cell, cellElement, { initialText } = {}) => {
    const log = findLog(cell?.rowKey);
    if (!log || !['memo', 'visit_count'].includes(cell?.field)) return;
    if (!cell.canEdit) {
      addToast('이 내역 셀은 수정할 수 없습니다.', 'warning');
      return;
    }

    const currentEditor = inlineEditorRef.current;
    if (currentEditor && currentEditor.cell?.id !== cell.id) {
      commitInlineCellEdit(currentEditor.cell, currentEditor.value);
    }

    const nextEditor = {
      cell: { ...cell },
      value: getPatientHistoryInlineEditInitialValue(
        cell.field,
        log[cell.field],
        initialText,
      ),
    };
    inlineEditorRef.current = nextEditor;
    flushSync(() => {
      setInlineEditor(nextEditor);
    });
    setCellSelection([cell], cell);
    clearClipboardCell();
    setContextMenu(null);
    setActiveContextSubmenu(null);

    const field = cellElement?.querySelector?.('textarea, input');
    if (!field) return;
    field.focus({ preventScroll: true });
    const caretPosition = field.value.length;
    field.setSelectionRange?.(caretPosition, caretPosition);
  }, [
    addToast,
    clearClipboardCell,
    commitInlineCellEdit,
    findLog,
    setActiveContextSubmenu,
    setContextMenu,
    setCellSelection,
  ]);

  const closePatientHistoryContextMenu = useCallback(() => {
    if (contextMenu?.patientHistoryCell) setContextMenu(null);
  }, [contextMenu?.patientHistoryCell, setContextMenu]);

  const {
    cancelPatientHistoryRangeSelection,
    cancelPatientHistoryCellFill,
    consumePatientHistorySuppressedSelectionClick,
    patientHistoryFillCellIds,
    startPatientHistoryCellFill,
    startPatientHistoryCellRangeSelection,
  } = usePatientHistoryDragInteractions({
    modalOpen,
    inlineEditorRef,
    findLog,
    persistCellValue,
    recordHistoryUndo,
    addToast,
    clearClipboardCell,
    setCellSelection,
    commitInlineCellEdit,
    closeContextMenu: closePatientHistoryContextMenu,
  });

  const selectCell = useCallback((event, cell) => {
    event.preventDefault();
    event.stopPropagation();
    if (consumePatientHistorySuppressedSelectionClick()) return;
    const currentEditor = inlineEditorRef.current;
    if (currentEditor && currentEditor.cell?.id !== cell.id) {
      commitInlineCellEdit(currentEditor.cell, currentEditor.value);
    }
    setCellSelection([cell], cell);
    if (contextMenu?.patientHistoryCell) setContextMenu(null);
    event.currentTarget?.focus?.({ preventScroll: true });
  }, [
    commitInlineCellEdit,
    consumePatientHistorySuppressedSelectionClick,
    contextMenu?.patientHistoryCell,
    setCellSelection,
    setContextMenu,
  ]);

  const moveSelectedCell = useCallback((direction) => {
    const activeCell = selectedCellRef.current;
    if (!activeCell) return false;
    const currentElement = Array.from(document.querySelectorAll(
      '.patient-history-data-cell--selectable[data-patient-history-cell-id]',
    )).find((element) => element.dataset.patientHistoryCellId === activeCell.id);
    if (!currentElement) return false;

    let targetElement = null;
    if (direction === 'ArrowLeft' || direction === 'ArrowRight') {
      const rowCells = Array.from(currentElement.parentElement?.children || [])
        .filter((element) => element.matches?.('.patient-history-data-cell--selectable'));
      const currentIndex = rowCells.indexOf(currentElement);
      const nextIndex = currentIndex + (direction === 'ArrowLeft' ? -1 : 1);
      targetElement = rowCells[nextIndex] || null;
    } else {
      const body = currentElement.closest('tbody');
      const rows = Array.from(body?.children || []);
      const currentRowIndex = rows.indexOf(currentElement.parentElement);
      const rowOffset = direction === 'ArrowUp' ? -1 : 1;
      for (
        let rowIndex = currentRowIndex + rowOffset;
        rowIndex >= 0 && rowIndex < rows.length;
        rowIndex += rowOffset
      ) {
        targetElement = Array.from(rows[rowIndex].children).find(
          (element) => element.dataset?.patientHistoryField === activeCell.field,
        ) || null;
        if (targetElement) break;
      }
    }

    const targetCell = getPatientHistoryCellFromElement(targetElement);
    if (!targetCell) return false;
    setCellSelection([targetCell], targetCell);
    if (contextMenu?.patientHistoryCell) setContextMenu(null);
    targetElement.focus({ preventScroll: true });
    return true;
  }, [contextMenu?.patientHistoryCell, setCellSelection, setContextMenu]);

  const openEditorAtRect = useCallback((cell, rect) => {
    const log = findLog(cell.rowKey);
    if (!log || !rect) return;
    if (cell.field === 'memo' && !cell.canEdit) {
      addToast('스케줄과 연결되지 않은 기존 기록은 메모를 수정할 수 없습니다.', 'warning');
      return;
    }

    setCellSelection([cell], cell);
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
    setCellSelection,
    setContextMenu,
    setContextMenuBodyPartOptions,
    setContextMenuHiddenBodyPartKeys,
    setContextMenuMemoDrafts,
    setContextMenuMemoFocusSignal,
  ]);

  const openEditor = useCallback((event, cell) => {
    event.preventDefault();
    event.stopPropagation();
    if (cell.field !== 'body_part') {
      beginInlineCellEdit(cell, event.currentTarget);
      return;
    }
    openEditorAtRect(cell, event.currentTarget?.getBoundingClientRect?.());
  }, [beginInlineCellEdit, openEditorAtRect]);

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
    const activeCells = selectedCellsRef.current.length > 0
      ? selectedCellsRef.current
      : [selectedCellRef.current].filter(Boolean);
    if (activeCells.length === 0) return;
    if (activeCells.some((cell) => cell.field === 'memo' && !cell.canEdit)) {
      addToast('스케줄과 연결되지 않은 기존 기록은 메모를 삭제할 수 없습니다.', 'warning');
      return;
    }
    const appliedChanges = [];
    for (const cell of activeCells) {
      const log = findLog(cell.rowKey);
      const previousValue = normalizePatientHistoryCellValue(cell.field, log?.[cell.field]);
      if (!previousValue) continue;
      const success = await persistCellValue(cell, '', { recordUndo: false });
      if (!success) {
        let rollbackSucceeded = true;
        for (const change of [...appliedChanges].reverse()) {
          const restored = await persistCellValue(change.cell, change.previousValue, {
            recordUndo: false,
          });
          if (!restored) rollbackSucceeded = false;
        }
        addToast(
          rollbackSucceeded
            ? '선택 범위를 삭제하지 못해 변경 전 상태로 되돌렸습니다.'
            : '선택 범위를 일부 되돌리지 못했습니다. 해당 셀을 확인해 주세요.',
          'warning',
        );
        return;
      }
      appliedChanges.push({ cell, previousValue, nextValue: '' });
    }
    if (appliedChanges.length > 0) recordHistoryUndo(appliedChanges);
  }, [addToast, findLog, persistCellValue, recordHistoryUndo]);

  const stepSelectedVisitCount = useCallback(async (cell, delta) => {
    const log = findLog(cell?.rowKey);
    if (!log || cell?.field !== 'visit_count') return false;
    const currentValue = normalizePatientHistoryCellValue('visit_count', log.visit_count);
    if (!currentValue) return true;
    const nextValue = stepPatientHistoryVisitCount(currentValue, delta);
    if (nextValue === currentValue) return true;
    return persistCellValue(cell, nextValue);
  }, [findLog, persistCellValue]);

  const dismissCellInteraction = useCallback(() => {
    if (cancelPatientHistoryCellFill() || cancelPatientHistoryRangeSelection()) return true;
    const activeInlineEditor = inlineEditorRef.current;
    if (activeInlineEditor?.cell) {
      cancelInlineCellEdit(activeInlineEditor.cell);
      return true;
    }
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
    cancelPatientHistoryRangeSelection,
    cancelInlineCellEdit,
    cancelPatientHistoryCellFill,
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
        && event.target?.closest?.(
          '.patient-history-search-input, .patient-history-edit-field--prescription, .patient-history-edit-field--inline-editing',
        )
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
      const visitCountDelta = getPatientHistoryVisitCountShortcutDelta(
        event,
        activeCell.field,
      );
      if (visitCountDelta) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        void stepSelectedVisitCount(activeCell, visitCountDelta);
        return;
      }
      const navigationDirection = getPatientHistoryCellNavigationDirection(event);
      if (navigationDirection && moveSelectedCell(navigationDirection)) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        return;
      }
      if (isPatientHistoryCellEditorShortcut(event)) {
        const cellElement = event.target?.closest?.('.patient-history-data-cell--selectable')
          || document.activeElement?.closest?.('.patient-history-data-cell--selectable');
        if (!cellElement) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        if (activeCell.field !== 'body_part') {
          beginInlineCellEdit(activeCell, cellElement);
        } else {
          openEditorAtRect(activeCell, cellElement.getBoundingClientRect());
        }
        return;
      }
      if (isPatientHistoryCellClearShortcut(event)) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        clearSelectedCell();
        return;
      }
      const directInputText = getPatientHistoryCellDirectInputText(event);
      if (
        directInputText !== null
        && ['memo', 'visit_count'].includes(activeCell.field)
      ) {
        const cellElement = event.target?.closest?.('.patient-history-data-cell--selectable')
          || document.activeElement?.closest?.('.patient-history-data-cell--selectable');
        if (!cellElement) return;
        if (directInputText !== '') event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        beginInlineCellEdit(activeCell, cellElement, { initialText: directInputText });
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
        && event.target?.closest?.(
          '.patient-history-search-input, .patient-history-edit-field--prescription, .patient-history-edit-field--inline-editing',
        )
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
        && event.target?.closest?.(
          '.patient-history-search-input, .patient-history-edit-field--prescription, .patient-history-edit-field--inline-editing',
        )
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
    beginInlineCellEdit,
    clearCellSelection,
    clearClipboardCell,
    clearSelectedCell,
    copyOrCut,
    findLog,
    modalOpen,
    moveSelectedCell,
    openEditorAtRect,
    persistCellValue,
    recordHistoryUndo,
    stepSelectedVisitCount,
    undoLastHistoryChange,
  ]);

  useEffect(() => {
    if (modalOpen) return;
    selectedCellRef.current = null;
    selectedCellsRef.current = [];
    setSelectedCell(null);
    setSelectedCellIds([]);
    setClipboardCell(null);
    clipboardRef.current = null;
    inlineEditorRef.current = null;
    setInlineEditor(null);
    undoStackRef.current = [];
    setContextMenu((prev) => (prev?.patientHistoryCell ? null : prev));
  }, [modalOpen, setContextMenu]);

  return {
    dismissPatientHistoryCellInteraction: dismissCellInteraction,
    cancelPatientHistoryInlineCellEdit: cancelInlineCellEdit,
    commitPatientHistoryInlineCellEdit: commitInlineCellEdit,
    handlePatientHistoryContextAction: handleContextAction,
    openPatientHistoryCellEditor: openEditor,
    patientHistoryClipboardCell: clipboardCell,
    patientHistoryInlineEditor: inlineEditor,
    patientHistorySelectedCellIds: selectedCellIds,
    patientHistoryFillCellIds,
    selectPatientHistoryCell: selectCell,
    selectedPatientHistoryCell: selectedCell,
    startPatientHistoryCellFill,
    startPatientHistoryCellRangeSelection,
    updatePatientHistoryInlineCellDraft: updateInlineCellDraft,
  };
}
