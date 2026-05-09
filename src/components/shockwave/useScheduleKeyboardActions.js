import { useCallback } from 'react';
import {
  applyVisitCountToSchedulerContent,
  getExplicitVisitSuffix,
  isUndoShortcutEvent,
  stepVisitInputValue,
} from '../../lib/schedulerUtils';
import { strip4060FromContent } from '../../lib/schedulerContentFormat';

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
  shockwaveSettings,
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

    if (isMeta && ['1', '2', '3', '4', '6'].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();

      const keys = Array.from(selectedKeys || []);
      const oldMemos = buildMemoSnapshotForKeys(keys);
      let anyChanged = false;
      const keyNum = e.key;

      let targetPrescription = '';
      let isManualTherapy = false;

      if (keyNum === '1') targetPrescription = shockwaveSettings?.prescriptions?.[0] || '';
      else if (keyNum === '2') targetPrescription = shockwaveSettings?.prescriptions?.[1] || '';
      else if (keyNum === '3') targetPrescription = shockwaveSettings?.prescriptions?.[2] || '';
      else if (keyNum === '4') {
        targetPrescription = shockwaveSettings?.manual_therapy_prescriptions?.find(p => p.includes('40')) || '';
        isManualTherapy = true;
      }
      else if (keyNum === '6') {
        targetPrescription = shockwaveSettings?.manual_therapy_prescriptions?.find(p => p.includes('60')) || '';
        isManualTherapy = true;
      }

      if (!targetPrescription) return;

      let doseTag = '';
      if (isManualTherapy) {
         const autoTagMatch = targetPrescription.match(/(\d{2,3})/);
         doseTag = shockwaveSettings?.manual_therapy_dose_tags?.[targetPrescription] || (autoTagMatch ? autoTagMatch[1] : '');
      }

      (async () => {
        for (const key of keys) {
          const [kw, kd, kr, kc] = key.split('-').map(Number);
          const memo = memos[key] || {};
          const stableContent = (typeof memo.content === 'string' ? memo.content : pendingDisplayValues[key]) || '';
          if (!stableContent) continue;
          
          let updatedContent = stableContent;
          
          // 기존 도수 태그 제거
          updatedContent = strip4060FromContent(updatedContent);

          if (isManualTherapy && doseTag) {
             const match = updatedContent.match(/^([^/]+)\/(.+?)((\(-?\d*\))|\*+)?$/);
             if (match) {
               const chartNumber = match[1];
               const namePart = match[2].trim();
               const suffixToken = match[3] || '';
               updatedContent = `${chartNumber}/${namePart}${doseTag}${suffixToken}`;
             }
          }
          
          // 이미 같은 처방 & 같은 내용이면 스킵
          if (memo.prescription === targetPrescription && stableContent === updatedContent) continue;

          // 도수치료 자동 지정될 때 바디 파트도 첫번째 항목으로 하려면 설정할 수 있지만, 
          // 요구사항에 '부위 목록을 자동으로 입력되게 할건데' 라고 쓰여있습니다.
          // 여기서 기존 body_part 를 유지할지, 아니면 초기화할지?
          // 현재 요구사항: '1번은 충격파 첫번째 목록 (지금은 F/R로 설정되어있음) 이 입력되면 되고... 4번은 도수치료의 40분...'
          // 요구사항 원문: "스케줄 셀에 내용이 있는 셀에 단축키를 컨틀롤/커맨드 1,2,3,4,6 을 누르면 자동으로 처방 목록이 입력되게 설정할건데 부위 목록을 자동으로 입력되게 할건데 1번은 충격파 첫번째 목록..." 
          // 말이 조금 꼬인 것 같으나 처방(부위 목록)을 자동으로 지정하라는 의미로 보입니다.

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
            targetPrescription,
            memo.body_part
          );
          if (success) anyChanged = true;
        }
        if (anyChanged) {
          recordUndo({ type: 'bulk-edit', oldMemos });
          addToast(`${targetPrescription} 처방이 적용되었습니다.`, 'success');
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
