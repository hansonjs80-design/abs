import { useCallback, useEffect, useRef, useState } from 'react';
import {
  buildPatientHistoryCellFillValues,
  getPatientHistoryCellFromElement,
  normalizePatientHistoryCellValue,
} from '../../lib/patientHistoryCellInteractionUtils';

const SELECTABLE_CELL_SELECTOR = '.patient-history-data-cell--selectable[data-patient-history-cell-id]';

export default function usePatientHistoryDragInteractions({
  modalOpen,
  inlineEditorRef,
  findLog,
  persistCellValue,
  recordHistoryUndo,
  addToast,
  clearClipboardCell,
  setCellSelection,
  commitInlineCellEdit,
  closeContextMenu,
}) {
  const [fillPreviewCellIds, setFillPreviewCellIds] = useState([]);
  const fillDragRef = useRef(null);
  const rangeSelectionDragRef = useRef(null);
  const suppressNextClickRef = useRef(false);
  const suppressClickTimerRef = useRef(null);

  const updateRangeSelectionTarget = useCallback((clientX, clientY) => {
    const drag = rangeSelectionDragRef.current;
    if (!drag) return;
    const targetElement = document.elementFromPoint(clientX, clientY)?.closest?.(
      SELECTABLE_CELL_SELECTOR,
    );
    if (!targetElement || targetElement.closest('tbody') !== drag.tableBody) return;

    const targetRow = targetElement.closest('tr');
    const targetRowIndex = drag.rows.indexOf(targetRow);
    const targetColumnIndex = Array.from(targetRow?.querySelectorAll(SELECTABLE_CELL_SELECTOR) || [])
      .indexOf(targetElement);
    if (targetRowIndex < 0 || targetColumnIndex < 0) return;

    const rowStart = Math.min(drag.sourceRowIndex, targetRowIndex);
    const rowEnd = Math.max(drag.sourceRowIndex, targetRowIndex);
    const columnStart = Math.min(drag.sourceColumnIndex, targetColumnIndex);
    const columnEnd = Math.max(drag.sourceColumnIndex, targetColumnIndex);
    const cells = [];
    for (let rowIndex = rowStart; rowIndex <= rowEnd; rowIndex += 1) {
      const rowCells = Array.from(drag.rows[rowIndex]?.querySelectorAll(SELECTABLE_CELL_SELECTOR) || []);
      for (let columnIndex = columnStart; columnIndex <= columnEnd; columnIndex += 1) {
        const cell = getPatientHistoryCellFromElement(rowCells[columnIndex]);
        if (cell) cells.push(cell);
      }
    }
    if (cells.length === 0) return;
    drag.hasMoved = drag.hasMoved || cells.length > 1;
    setCellSelection(cells, drag.sourceCell);
  }, [setCellSelection]);

  const finishRangeSelection = useCallback(() => {
    const drag = rangeSelectionDragRef.current;
    rangeSelectionDragRef.current = null;
    if (!drag?.hasMoved) return;
    suppressNextClickRef.current = true;
    window.clearTimeout(suppressClickTimerRef.current);
    suppressClickTimerRef.current = window.setTimeout(() => {
      suppressNextClickRef.current = false;
      suppressClickTimerRef.current = null;
    }, 0);
  }, []);

  const cancelRangeSelection = useCallback(() => {
    if (!rangeSelectionDragRef.current) return false;
    rangeSelectionDragRef.current = null;
    return true;
  }, []);

  const consumeSuppressedSelectionClick = useCallback(() => {
    if (!suppressNextClickRef.current) return false;
    suppressNextClickRef.current = false;
    window.clearTimeout(suppressClickTimerRef.current);
    suppressClickTimerRef.current = null;
    return true;
  }, []);

  const startRangeSelection = useCallback((event, cell) => {
    if (event.button !== 0 || event.target?.closest?.('.patient-history-fill-handle')) return;
    if (event.target?.closest?.('.patient-history-edit-field--inline-editing')) return;
    event.preventDefault();
    event.stopPropagation();
    const currentEditor = inlineEditorRef.current;
    if (currentEditor && currentEditor.cell?.id !== cell.id) {
      commitInlineCellEdit(currentEditor.cell, currentEditor.value);
    }
    const sourceElement = event.currentTarget;
    const tableBody = sourceElement?.closest?.('tbody');
    const sourceRow = sourceElement?.closest?.('tr');
    const rows = Array.from(tableBody?.querySelectorAll(':scope > tr') || []);
    const rowCells = Array.from(sourceRow?.querySelectorAll(SELECTABLE_CELL_SELECTOR) || []);
    const sourceRowIndex = rows.indexOf(sourceRow);
    const sourceColumnIndex = rowCells.indexOf(sourceElement);
    if (!tableBody || sourceRowIndex < 0 || sourceColumnIndex < 0) return;

    suppressNextClickRef.current = false;
    setCellSelection([cell], cell);
    closeContextMenu();
    sourceElement.focus({ preventScroll: true });
    rangeSelectionDragRef.current = {
      sourceCell: { ...cell },
      tableBody,
      rows,
      sourceRowIndex,
      sourceColumnIndex,
      hasMoved: false,
    };
  }, [
    closeContextMenu,
    commitInlineCellEdit,
    inlineEditorRef,
    setCellSelection,
  ]);

  const updateCellFillTarget = useCallback((clientX, clientY) => {
    const drag = fillDragRef.current;
    if (!drag) return;
    const targetElement = document.elementFromPoint(clientX, clientY)?.closest?.(
      drag.fieldSelector,
    );
    if (!targetElement || targetElement.closest('tbody') !== drag.tableBody) return;

    const targetIndex = drag.fieldElements.indexOf(targetElement);
    if (targetIndex < 0 || targetIndex === drag.sourceIndex) {
      drag.targetCells = [];
      setFillPreviewCellIds([]);
      return;
    }

    const step = targetIndex > drag.sourceIndex ? 1 : -1;
    const targetCells = [];
    for (
      let index = drag.sourceIndex + step;
      step > 0 ? index <= targetIndex : index >= targetIndex;
      index += step
    ) {
      const cell = getPatientHistoryCellFromElement(drag.fieldElements[index]);
      if (cell?.canEdit) targetCells.push(cell);
    }
    drag.targetCells = targetCells;
    setFillPreviewCellIds(targetCells.map((cell) => cell.id));
  }, []);

  const finishCellFill = useCallback(async () => {
    const drag = fillDragRef.current;
    fillDragRef.current = null;
    setFillPreviewCellIds([]);
    if (!drag?.targetCells?.length) return;

    const nextValues = buildPatientHistoryCellFillValues(
      drag.field,
      drag.sourceValue,
      drag.targetCells.length,
    );
    const appliedChanges = [];
    for (let index = 0; index < drag.targetCells.length; index += 1) {
      const cell = drag.targetCells[index];
      const log = findLog(cell.rowKey);
      const previousValue = normalizePatientHistoryCellValue(drag.field, log?.[drag.field]);
      const nextValue = nextValues[index];
      if (previousValue === nextValue) continue;
      const success = await persistCellValue(cell, nextValue, { recordUndo: false });
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
            ? '셀 채우기를 저장하지 못해 변경 전 상태로 되돌렸습니다.'
            : '셀 채우기를 일부 되돌리지 못했습니다. 해당 셀을 확인해 주세요.',
          'warning',
        );
        return;
      }
      appliedChanges.push({ cell, previousValue, nextValue });
    }

    if (appliedChanges.length > 0) {
      recordHistoryUndo(appliedChanges);
      const label = drag.field === 'visit_count' ? '회차 연속 입력' : '내용 복사';
      addToast(`${label}을 ${appliedChanges.length}개 셀에 적용했습니다.`, 'success');
    }
  }, [addToast, findLog, persistCellValue, recordHistoryUndo]);

  const cancelCellFill = useCallback(() => {
    if (!fillDragRef.current) return false;
    fillDragRef.current = null;
    setFillPreviewCellIds([]);
    return true;
  }, []);

  const startCellFill = useCallback((event, cell) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const fieldSelector = `${SELECTABLE_CELL_SELECTOR}[data-patient-history-field="${cell?.field}"]`;
    const sourceElement = event.currentTarget?.closest?.(fieldSelector);
    const tableBody = sourceElement?.closest?.('tbody');
    const log = findLog(cell?.rowKey);
    const sourceValue = normalizePatientHistoryCellValue(cell?.field, log?.[cell?.field]);
    if (
      !sourceElement
      || !tableBody
      || buildPatientHistoryCellFillValues(cell?.field, sourceValue, 1).length === 0
    ) {
      addToast('숫자 또는 *가 입력된 회차 셀에서만 연속 입력할 수 있습니다.', 'info');
      return;
    }

    const fieldElements = Array.from(tableBody.querySelectorAll(fieldSelector));
    const sourceIndex = fieldElements.indexOf(sourceElement);
    if (sourceIndex < 0) return;
    setCellSelection([cell], cell);
    clearClipboardCell();
    fillDragRef.current = {
      field: cell.field,
      fieldSelector,
      sourceValue,
      tableBody,
      fieldElements,
      sourceIndex,
      targetCells: [],
    };
    setFillPreviewCellIds([]);
    event.currentTarget?.setPointerCapture?.(event.pointerId);
  }, [addToast, clearClipboardCell, findLog, setCellSelection]);

  useEffect(() => {
    if (!modalOpen) return undefined;

    const handlePointerMove = (event) => {
      if (fillDragRef.current) {
        event.preventDefault();
        updateCellFillTarget(event.clientX, event.clientY);
      } else if (rangeSelectionDragRef.current) {
        event.preventDefault();
        updateRangeSelectionTarget(event.clientX, event.clientY);
      }
    };
    const handlePointerUp = () => {
      if (fillDragRef.current) void finishCellFill();
      else finishRangeSelection();
    };
    const handlePointerCancel = () => {
      cancelCellFill();
      cancelRangeSelection();
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerUp, true);
    window.addEventListener('pointercancel', handlePointerCancel, true);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp, true);
      window.removeEventListener('pointercancel', handlePointerCancel, true);
    };
  }, [
    cancelRangeSelection,
    cancelCellFill,
    finishCellFill,
    finishRangeSelection,
    modalOpen,
    updateCellFillTarget,
    updateRangeSelectionTarget,
  ]);

  useEffect(() => {
    if (modalOpen) return;
    fillDragRef.current = null;
    rangeSelectionDragRef.current = null;
    suppressNextClickRef.current = false;
    window.clearTimeout(suppressClickTimerRef.current);
    suppressClickTimerRef.current = null;
    setFillPreviewCellIds([]);
    return () => {
      window.clearTimeout(suppressClickTimerRef.current);
    };
  }, [modalOpen]);

  return {
    cancelPatientHistoryRangeSelection: cancelRangeSelection,
    cancelPatientHistoryCellFill: cancelCellFill,
    consumePatientHistorySuppressedSelectionClick: consumeSuppressedSelectionClick,
    patientHistoryFillCellIds: fillPreviewCellIds,
    startPatientHistoryCellFill: startCellFill,
    startPatientHistoryCellRangeSelection: startRangeSelection,
  };
}
