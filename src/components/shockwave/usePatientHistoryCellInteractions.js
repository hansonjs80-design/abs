import { useCallback, useEffect, useRef, useState } from 'react';
import {
  applyPatientHistoryBodyPartAction,
  applyPatientHistoryMemoAction,
  getPatientHistoryEscapeAction,
  getPatientHistoryCellClipboardMode,
  getPatientHistoryCellClipboardText,
  isPatientHistoryEditorAction,
  isPatientHistoryCellClearShortcut,
  normalizePatientHistoryCellValue,
} from '../../lib/patientHistoryCellInteractionUtils';
import {
  parsePatientHistoryBodyPartText,
  parsePatientHistoryMemoText,
} from '../../lib/patientHistoryModalUtils';
import { buildMergeSpanWithMemoList } from '../../lib/schedulerUtils';

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

  const persistCellValue = useCallback(async (cell, rawValue) => {
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
    return Boolean(success);
  }, [addToast, findLog, patchLog, updateHistoryField, updateHistoryMemo]);

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

  const selectCell = useCallback((event, cell) => {
    event.preventDefault();
    event.stopPropagation();
    selectedCellRef.current = cell;
    setSelectedCell(cell);
    setClipboardSource(null);
    if (contextMenu?.patientHistoryCell) setContextMenu(null);
    event.currentTarget?.focus?.({ preventScroll: true });
  }, [contextMenu?.patientHistoryCell, setClipboardSource, setContextMenu]);

  const openEditor = useCallback((event, cell) => {
    event.preventDefault();
    event.stopPropagation();
    const log = findLog(cell.rowKey);
    if (!log) return;
    if (cell.field === 'memo' && !cell.canEdit) {
      addToast('스케줄과 연결되지 않은 기존 기록은 메모를 수정할 수 없습니다.', 'warning');
      return;
    }

    selectedCellRef.current = cell;
    setSelectedCell(cell);
    setClipboardSource(null);
    const rect = event.currentTarget.getBoundingClientRect();
    const panelWidth = cell.field === 'memo' ? 340 : 320;
    const viewportGap = 10;
    let x = rect.right + 8;
    if (x + panelWidth > window.innerWidth - viewportGap) {
      x = Math.max(viewportGap, rect.left - panelWidth - 8);
    }
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
      x,
      y,
      weekIdx: Number(log.week_index) || 0,
      dayIdx: Number(log.day_index) || 0,
      rowIdx: Number(log.row_index) || 0,
      colIdx: Number(log.col_index) || 0,
      currentPrescription: log.prescription || '',
      isNearRightEdge: false,
      isStandaloneSubmenu: true,
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
      clipboardRef.current = null;
      setClipboardCell(null);
      return true;
    }
    if (action === 'close-editor') {
      setContextMenu(null);
      setActiveContextSubmenu(null);
      return true;
    }
    if (action === 'clear-selection') {
      selectedCellRef.current = null;
      setSelectedCell(null);
      setClipboardSource(null);
      return true;
    }
    return false;
  }, [
    clipboardCell,
    contextMenu?.patientHistoryCell,
    selectedCell,
    setActiveContextSubmenu,
    setClipboardSource,
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
      if (!selectedCellRef.current) return;
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
      const success = await persistCellValue(activeCell, normalizedPastedText);
      if (!success) return;
      if (!isInternalClipboard) {
        setClipboardCell({ id: activeCell.id, mode: 'paste' });
        return;
      }
      if (internalClipboard.mode !== 'cut') return;

      const sourceCell = internalClipboard.sourceCell;
      if (!sourceCell || sourceCell.id === activeCell.id) {
        clipboardRef.current = { ...internalClipboard, mode: 'copy' };
        setClipboardCell({ id: activeCell.id, mode: 'copy' });
        return;
      }
      const cleared = await persistCellValue(sourceCell, '');
      if (cleared) {
        clipboardRef.current = null;
        setClipboardCell({ id: activeCell.id, mode: 'paste' });
        addToast('잘라낸 셀을 이동했습니다.', 'success');
      } else {
        addToast('붙여넣기는 완료됐지만 원본 셀을 비우지 못했습니다.', 'warning');
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('copy', handleClipboardWrite, true);
    window.addEventListener('cut', handleClipboardWrite, true);
    window.addEventListener('paste', handlePaste, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('copy', handleClipboardWrite, true);
      window.removeEventListener('cut', handleClipboardWrite, true);
      window.removeEventListener('paste', handlePaste, true);
    };
  }, [clearSelectedCell, copyOrCut, modalOpen, persistCellValue, addToast]);

  useEffect(() => {
    if (modalOpen) return;
    selectedCellRef.current = null;
    setSelectedCell(null);
    setClipboardCell(null);
    clipboardRef.current = null;
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
