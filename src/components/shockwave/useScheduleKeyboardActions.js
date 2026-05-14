import { useCallback, useEffect, useRef } from 'react';
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
  applyImmediateCellDisplay,
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
  // ── refs로 최신 값 추적 (연속 키 입력 시 stale closure 방지) ──
  const memosRef = useRef(memos);
  const pendingRef = useRef(pendingDisplayValues);
  const onSaveMemoRef = useRef(onSaveMemo);
  const buildSnapshotRef = useRef(buildMemoSnapshotForKeys);
  const recordUndoRef = useRef(recordUndo);
  const getDefaultTimeRef = useRef(getDefaultReservationTime);
  const applyDisplayRef = useRef(applyImmediateCellDisplay);
  const visitDebounceRef = useRef({ timer: null, undoSnapshot: null, pending: new Map() });
  const timeDebounceRef = useRef({ timer: null, undoSnapshot: null, pending: new Map() });

  useEffect(() => { memosRef.current = memos; }, [memos]);
  useEffect(() => { pendingRef.current = pendingDisplayValues; }, [pendingDisplayValues]);
  useEffect(() => { onSaveMemoRef.current = onSaveMemo; }, [onSaveMemo]);
  useEffect(() => { buildSnapshotRef.current = buildMemoSnapshotForKeys; }, [buildMemoSnapshotForKeys]);
  useEffect(() => { recordUndoRef.current = recordUndo; }, [recordUndo]);
  useEffect(() => { getDefaultTimeRef.current = getDefaultReservationTime; }, [getDefaultReservationTime]);
  useEffect(() => { applyDisplayRef.current = applyImmediateCellDisplay; }, [applyImmediateCellDisplay]);

  // 디바운스 cleanup
  useEffect(() => {
    return () => {
      if (visitDebounceRef.current?.timer) clearTimeout(visitDebounceRef.current.timer);
      if (timeDebounceRef.current?.timer) clearTimeout(timeDebounceRef.current.timer);
    };
  }, []);

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

      // 첫 입력 시에만 undo 스냅샷 저장, 연속 입력 시 재사용
      if (!visitDebounceRef.current.undoSnapshot) {
        visitDebounceRef.current.undoSnapshot = buildSnapshotRef.current(keys);
      }

      // 최신 refs를 사용하여 즉시 낙관적 UI 적용
      const latestMemos = memosRef.current;
      const latestPending = pendingRef.current;
      const saveMemo = onSaveMemoRef.current;
      const displayUpdates = [];

      keys.forEach(key => {
        const [kw, kd, kr, kc] = key.split('-').map(Number);
        const memo = latestMemos[key] || {};
        
        // 디바운스 대기열에 이미 변경된 내용이 있으면 그것을 우선 기준으로 삼음
        const pendingState = visitDebounceRef.current.pending.get(key);
        const stableContent = pendingState ? pendingState.updatedContent : ((typeof memo.content === 'string' ? memo.content : latestPending[key]) || '');
        if (!stableContent) return;

        const visitSuffix = getExplicitVisitSuffix(stableContent);
        const currentVisit = visitSuffix.replace(/[()]/g, '') || '';
        const nextVisit = stepVisitInputValue(currentVisit, delta);
        const updatedContent = applyVisitCountToSchedulerContent(stableContent, nextVisit);
        if (updatedContent === stableContent) return;

        // UI 즉각 반영을 위한 값 수집
        displayUpdates.push({ key, content: updatedContent });
        
        // DB 저장 대기열에 추가
        visitDebounceRef.current.pending.set(key, {
          kw, kd, kr, kc, memo, updatedContent
        });
      });

      if (displayUpdates.length > 0) {
        applyDisplayRef.current?.(displayUpdates);
      }

      // 디바운스된 DB 저장 및 undo 기록 (연속 입력이 멈춘 후 500ms 뒤 기록)
      if (visitDebounceRef.current.timer) clearTimeout(visitDebounceRef.current.timer);
      visitDebounceRef.current.timer = setTimeout(() => {
        const snapshot = visitDebounceRef.current;
        const pendingSaves = Array.from(snapshot.pending.values());
        const undoMemos = snapshot.undoSnapshot;

        snapshot.pending.clear();
        snapshot.undoSnapshot = null;
        snapshot.timer = null;

        Promise.all(
          pendingSaves.map(({ kw, kd, kr, kc, memo, updatedContent }) =>
            saveMemo(currentYear, currentMonth, kw, kd, kr, kc, updatedContent, memo.bg_color, memo.merge_span, memo.prescription, memo.body_part)
          )
        ).then(saveResults => {
          if (saveResults.some(Boolean) && undoMemos) {
            recordUndoRef.current({ type: 'bulk-edit', oldMemos: undoMemos });
          }
        });
      }, 500);
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
      const oldMemos = buildSnapshotRef.current(keys);

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

      const latestMemos = memosRef.current;
      const latestPending = pendingRef.current;
      const saveMemo = onSaveMemoRef.current;

      (async () => {
        let anyChanged = false;
        for (const key of keys) {
          const [kw, kd, kr, kc] = key.split('-').map(Number);
          const memo = latestMemos[key] || {};
          const stableContent = (typeof memo.content === 'string' ? memo.content : latestPending[key]) || '';
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

          const success = await saveMemo(
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
          recordUndoRef.current({ type: 'bulk-edit', oldMemos });
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

      // 첫 입력 시에만 undo 스냅샷 저장, 연속 입력 시 재사용
      if (!timeDebounceRef.current.undoSnapshot) {
        timeDebounceRef.current.undoSnapshot = buildSnapshotRef.current(keys);
      }

      // 최신 refs를 사용
      const latestMemos = memosRef.current;
      const latestPending = pendingRef.current;
      const saveMemo = onSaveMemoRef.current;
      const getDefTime = getDefaultTimeRef.current;

      keys.forEach(key => {
        const [kw, kd, kr, kc] = key.split('-').map(Number);
        const memo = latestMemos[key] || {};
        const stableContent = (typeof memo.content === 'string' ? memo.content : latestPending[key]) || '';
        if (!stableContent || stableContent.trim() === '\u200B') return;

        // 예약 시간 증감: 디바운스 대기열에 변경된 merge_span이 있으면 기준값으로 우선 적용
        const pendingState = timeDebounceRef.current.pending.get(key);
        const currentMergeSpan = pendingState ? pendingState.nextMergeSpan : (memo.merge_span || '');
        const currentTime = getReservationTimeFromMergeSpan(currentMergeSpan);
        const defaultTime = getDefTime ? getDefTime(kw, kd, kr) : '';

        const nextTime = stepReservationTimeWithinCellBase(currentTime, defaultTime, deltaMinutes);
        const nextMergeSpan = buildMergeSpanWithReservationTime(currentMergeSpan, nextTime);
        
        if (currentMergeSpan === nextMergeSpan) return;

        timeDebounceRef.current.pending.set(key, {
          kw, kd, kr, kc, memo, nextMergeSpan, stableContent
        });
      });

      // 예약 시간 변경은 화면상 텍스트(`pendingDisplayValues`)가 아니라 Tooltip/MergeSpan으로 보이므로
      // pendingDisplayValues를 갱신할 필요는 없지만(content가 안바뀜),
      // merge_span이 바뀌는 것이므로 즉시 UI를 반영하려면 memos를 로컬에서 즉시 업데이트하거나
      // DB 저장이 빠른 게 좋으나 debounce를 위해 모아서 처리합니다. 
      // (기존에도 merge_span은 낙관적 업데이트 대상이 아니었음)

      // 디바운스된 DB 저장 및 undo 기록 (연속 입력이 멈춘 후 500ms 뒤 기록)
      if (timeDebounceRef.current.timer) clearTimeout(timeDebounceRef.current.timer);
      timeDebounceRef.current.timer = setTimeout(() => {
        const snapshot = timeDebounceRef.current;
        const pendingSaves = Array.from(snapshot.pending.values());
        const undoMemos = snapshot.undoSnapshot;

        snapshot.pending.clear();
        snapshot.undoSnapshot = null;
        snapshot.timer = null;

        Promise.all(
          pendingSaves.map(({ kw, kd, kr, kc, memo, stableContent, nextMergeSpan }) =>
            saveMemo(currentYear, currentMonth, kw, kd, kr, kc, stableContent, memo.bg_color, nextMergeSpan, memo.prescription, memo.body_part)
          )
        ).then(saveResults => {
          if (saveResults.some(Boolean) && undoMemos) {
            recordUndoRef.current({ type: 'bulk-edit', oldMemos: undoMemos });
          }
        });
      }, 500);
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
    currentYear,
    currentMonth,
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
    handleOpenBodyPartMenu,
    addToast,
    setEditingCell,
    setRangeEnd,
    setSelectedKeys,
    shockwaveSettings,
  ]);
}
