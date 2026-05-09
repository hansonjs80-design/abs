import { useCallback } from 'react';
import {
  applyVisitCountToSchedulerContent,
  getExplicitVisitSuffix,
  isUndoShortcutEvent,
  stepVisitInputValue,
  stepReservationTimeWithinCellBase,
  getReservationTimeFromMergeSpan,
  buildMergeSpanWithReservationTime,
} from '../../lib/schedulerUtils';
import { strip4060FromContent } from '../../lib/schedulerContentFormat';
import { getEffectiveSettlementSettings } from '../../lib/settlementSettings';

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
  getDefaultReservationTime,
  handleOpenBodyPartMenu,
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

    if (isMeta && e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (handleOpenBodyPartMenu) {
        handleOpenBodyPartMenu();
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

    // 맥 등에서 한글 입력 상태일 때 e.key가 다를 수 있으므로 e.code(Digit1~Digit9)도 함께 체크
    const isDigitCode = /^Digit([1-9])$/.test(e.code);
    const isDigitKey = /^[1-9]$/.test(e.key);

    // PWA(설치된 앱) 환경에서는 Cmd/Ctrl + 1~9가 탭/창 전환 단축키로 브라우저 레벨에서 먹히는 경우가 많습니다.
    // 이를 우회하기 위해 Alt(Option) 키나 Shift 키 조합도 허용합니다.
    const isMetaOrAltOrShift = isMeta || e.altKey || (e.shiftKey && isMeta);

    if (isMetaOrAltOrShift && (isDigitKey || isDigitCode)) {
      e.preventDefault();
      e.stopPropagation();

      const keys = Array.from(selectedKeys || []);
      const oldMemos = buildMemoSnapshotForKeys(keys);
      let anyChanged = false;

      const keyMatch = e.code.match(/^Digit([1-9])$/);
      const keyNum = keyMatch ? keyMatch[1] : e.key;
      let targetPrescription = '';
      let isManualTherapy = false;

      const effectiveManualSettings = getEffectiveSettlementSettings(shockwaveSettings, currentYear, currentMonth, 'manual_therapy');
      const effectiveShockwaveSettings = getEffectiveSettlementSettings(shockwaveSettings, currentYear, currentMonth, 'shockwave');

      // 1. 도수치료 단축키 검색
      const manualShortcuts = effectiveManualSettings?.shortcuts || {};
      const manualPrescription = Object.keys(manualShortcuts).find(p => manualShortcuts[p] === keyNum);
      if (manualPrescription) {
        targetPrescription = manualPrescription;
        isManualTherapy = true;
      } else {
        // 2. 충격파 단축키 검색
        const shockwaveShortcuts = effectiveShockwaveSettings?.shortcuts || {};
        const swPrescription = Object.keys(shockwaveShortcuts).find(p => shockwaveShortcuts[p] === keyNum);
        if (swPrescription) {
          targetPrescription = swPrescription;
        }
      }

      if (!targetPrescription) return;

      let doseTag = '';
      if (isManualTherapy) {
         const autoTagMatch = targetPrescription.match(/(\d{2,3})/);
         doseTag = effectiveManualSettings?.dose_tags?.[targetPrescription] || shockwaveSettings?.manual_therapy_dose_tags?.[targetPrescription] || (autoTagMatch ? autoTagMatch[1] : '');
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

    if (isMeta && (e.code === 'KeyD' || e.key.toLowerCase() === 'd')) {
      e.preventDefault();
      e.stopPropagation();
      handleToggleTreatmentCancel();
      return;
    }

    if (isMeta && (e.code === 'Minus' || e.key === '-' || e.code === 'Equal' || e.key === '=' || e.key === '+')) {
      e.preventDefault();
      e.stopPropagation();
      
      const delta = (e.code === 'Minus' || e.key === '-') ? -1 : 1;
      const deltaMinutes = delta * 10; // 항상 10분 단위로 증감
      
      const keys = Array.from(selectedKeys || []);
      const oldMemos = buildMemoSnapshotForKeys(keys);
      let anyChanged = false;

      (async () => {
        for (const key of keys) {
          const [kw, kd, kr, kc] = key.split('-').map(Number);
          const memo = memos[key] || {};
          const stableContent = (typeof memo.content === 'string' ? memo.content : pendingDisplayValues[key]) || '';
          if (!stableContent || stableContent.trim() === '\u200B') continue;

          const currentMergeSpan = memo.merge_span || '';
          const currentTime = getReservationTimeFromMergeSpan(currentMergeSpan);
          const defaultTime = getDefaultReservationTime ? getDefaultReservationTime(kw, kd, kr) : '';

          const nextTime = stepReservationTimeWithinCellBase(currentTime, defaultTime, deltaMinutes);
          const nextMergeSpan = buildMergeSpanWithReservationTime(currentMergeSpan, nextTime);
          
          if (currentMergeSpan === nextMergeSpan) continue;

          const success = await onSaveMemo(
            currentYear,
            currentMonth,
            kw,
            kd,
            kr,
            kc,
            stableContent,
            memo.bg_color,
            nextMergeSpan,
            memo.prescription,
            memo.body_part
          );
          if (success) anyChanged = true;
        }
        if (anyChanged) {
          recordUndo({ type: 'bulk-edit', oldMemos });
          addToast('예약 시간이 변경되었습니다.', 'success');
        }
      })();
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
