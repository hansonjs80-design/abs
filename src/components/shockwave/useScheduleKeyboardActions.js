import { useCallback, useEffect, useRef } from 'react';
import {
  isUndoShortcutEvent,
  stepReservationTimeWithinCellBase,
  getReservationTimeFromMergeSpan,
  buildMergeSpanWithReservationTime,
  applyVisitCountToSchedulerContent,
  getSchedulerVisitInputValue,
  stepVisitShortcutInputValue,
} from '../../lib/schedulerUtils';
import { strip4060FromContent } from '../../lib/schedulerContentFormat';
import { getEffectiveSettlementSettings } from '../../lib/settlementSettings';
import {
  getEditingCellKeyAction,
  isBodyPartMenuShortcut,
  isGridNavigationKey,
  isHolidayBackgroundShortcut,
  isMergeShortcut,
  isPatientHistoryShortcut,
  isTreatmentCancelShortcut,
  isTreatmentCompleteShortcut,
} from '../../lib/scheduleKeyboardUtils';
import { buildMoveScheduleSelectionPayload } from '../../lib/scheduleMoveUtils';

export default function useScheduleKeyboardActions({
  contextMenu,
  selectedCell,
  editingCell,
  selectedKeys,
  pendingDisplayValues,
  pendingMergeSpans,
  applyImmediateCellDisplay,
  applyImmediateMergeSpan,
  currentYear,
  currentMonth,
  memos,
  imeOpenRef,
  cellKey,
  colCount,
  rowCount,
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
  saveShockwaveMemosBulk,
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
  const selectedKeysRef = useRef(selectedKeys);
  const pendingRef = useRef(pendingDisplayValues);
  const pendingMergeSpansRef = useRef(pendingMergeSpans);
  const onSaveMemoRef = useRef(onSaveMemo);
  const saveBulkRef = useRef(saveShockwaveMemosBulk);
  const buildSnapshotRef = useRef(buildMemoSnapshotForKeys);
  const recordUndoRef = useRef(recordUndo);
  const getDefaultTimeRef = useRef(getDefaultReservationTime);
  const applyCellDisplayRef = useRef(applyImmediateCellDisplay);
  const applyMergeSpanRef = useRef(applyImmediateMergeSpan);
  const timeDebounceRef = useRef({ timer: null, pending: new Map() });
  const visitDebounceRef = useRef({ timer: null, pending: new Map() });
  const moveSaveQueueRef = useRef(Promise.resolve());
  const moveRequestIdRef = useRef(0);
  const moveOptimisticMemosRef = useRef({});

  useEffect(() => {
    memosRef.current = {
      ...(memos || {}),
      ...(moveOptimisticMemosRef.current || {}),
    };
  }, [memos]);
  useEffect(() => { selectedKeysRef.current = selectedKeys; }, [selectedKeys]);
  useEffect(() => { pendingRef.current = pendingDisplayValues; }, [pendingDisplayValues]);
  useEffect(() => { pendingMergeSpansRef.current = pendingMergeSpans; }, [pendingMergeSpans]);
  useEffect(() => { onSaveMemoRef.current = onSaveMemo; }, [onSaveMemo]);
  useEffect(() => { saveBulkRef.current = saveShockwaveMemosBulk; }, [saveShockwaveMemosBulk]);
  useEffect(() => { buildSnapshotRef.current = buildMemoSnapshotForKeys; }, [buildMemoSnapshotForKeys]);
  useEffect(() => { recordUndoRef.current = recordUndo; }, [recordUndo]);
  useEffect(() => { getDefaultTimeRef.current = getDefaultReservationTime; }, [getDefaultReservationTime]);
  useEffect(() => { applyCellDisplayRef.current = applyImmediateCellDisplay; }, [applyImmediateCellDisplay]);
  useEffect(() => { applyMergeSpanRef.current = applyImmediateMergeSpan; }, [applyImmediateMergeSpan]);

  // 디바운스 cleanup
  useEffect(() => {
    const timeDebounce = timeDebounceRef.current;
    const visitDebounce = visitDebounceRef.current;
    return () => {
      if (timeDebounce?.timer) clearTimeout(timeDebounce.timer);
      if (visitDebounce?.timer) clearTimeout(visitDebounce.timer);
    };
  }, []);

  const applyReservationTimeDelta = useCallback((deltaMinutes) => {
    const keys = Array.from(selectedKeys || []);

    const latestMemos = memosRef.current;
    const latestPending = pendingRef.current;
    const latestPendingMergeSpans = pendingMergeSpansRef.current;
    const saveMemo = onSaveMemoRef.current;
    const getDefTime = getDefaultTimeRef.current;

    const mergeSpanUpdates = keys.map(key => {
      const [kw, kd, kr, kc] = key.split('-').map(Number);
      const memo = latestMemos[key] || {};
      const stableContent = latestPending[key] !== undefined ? String(latestPending[key]) : (memo.content || '');
      if (!stableContent || stableContent.trim() === '\u200B') return null;

      const pendingState = timeDebounceRef.current.pending.get(key);
      const currentMergeSpan = pendingState
        ? pendingState.nextMergeSpan
        : (latestPendingMergeSpans?.[key] || memo.merge_span || '');
      const currentTime = getReservationTimeFromMergeSpan(currentMergeSpan);
      const defaultTime = getDefTime ? getDefTime(kw, kd, kr) : '';

      const nextTime = stepReservationTimeWithinCellBase(currentTime, defaultTime, deltaMinutes);
      const nextMergeSpan = buildMergeSpanWithReservationTime(currentMergeSpan, nextTime);

      timeDebounceRef.current.pending.set(key, {
        kw, kd, kr, kc, memo, nextMergeSpan, stableContent
      });

      return { key, mergeSpan: nextMergeSpan };
    }).filter(Boolean);

    if (mergeSpanUpdates.length > 0) {
      applyMergeSpanRef.current?.(mergeSpanUpdates);
    }

    if (timeDebounceRef.current.timer) clearTimeout(timeDebounceRef.current.timer);
    timeDebounceRef.current.timer = setTimeout(() => {
      const snapshot = timeDebounceRef.current;
      const pendingSaves = Array.from(snapshot.pending.values());
      const undoMemos = pendingSaves.length > 0
        ? buildSnapshotRef.current(pendingSaves.map(({ kw, kd, kr, kc }) => `${kw}-${kd}-${kr}-${kc}`))
        : null;

      snapshot.pending.clear();
      snapshot.timer = null;

      Promise.all(
        pendingSaves.map(({ kw, kd, kr, kc, memo, stableContent, nextMergeSpan }) =>
          saveMemo(
            currentYear,
            currentMonth,
            kw,
            kd,
            kr,
            kc,
            pendingRef.current?.[`${kw}-${kd}-${kr}-${kc}`] !== undefined
              ? String(pendingRef.current[`${kw}-${kd}-${kr}-${kc}`])
              : stableContent,
            memo.bg_color,
            nextMergeSpan,
            memo.prescription,
            memo.body_part
          )
        )
      ).then(saveResults => {
        if (saveResults.some(Boolean) && undoMemos) {
          recordUndoRef.current({ type: 'bulk-edit', oldMemos: undoMemos });
        }
      });
    }, 500);
  }, [currentMonth, currentYear, selectedKeys]);

  const isReservationTimeShortcutEvent = useCallback((event) => {
    if (!event || !(event.metaKey || event.ctrlKey)) return false;
    return (
      event.key === 'ArrowLeft' ||
      event.key === 'ArrowRight'
    );
  }, []);

  const handleReservationTimeShortcut = useCallback((event) => {
    if (event.__shockwaveReservationTimeHandled) return true;
    if (!isReservationTimeShortcutEvent(event)) return false;
    event.__shockwaveReservationTimeHandled = true;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();

    const isDecrease = event.key === 'ArrowLeft';
    applyReservationTimeDelta(isDecrease ? -10 : 10);
    return true;
  }, [isReservationTimeShortcutEvent, applyReservationTimeDelta]);

  const moveSelectedCellsByRow = useCallback((rowDelta) => {
    const result = buildMoveScheduleSelectionPayload({
      selectedKeys: selectedKeysRef.current,
      memos: memosRef.current,
      pendingDisplayValues: pendingRef.current,
      pendingMergeSpans: pendingMergeSpansRef.current,
      rowDelta,
      rowCount,
      currentYear,
      currentMonth,
    });

    if (!result.ok) {
      if (result.reason === 'occupied') {
        addToast('이동할 위치에 예약 내용이 있어 이동할 수 없습니다.', 'error');
      }
      return;
    }

    applyCellDisplayRef.current?.(result.payload);
    applyMergeSpanRef.current?.(result.payload);
    recordUndoRef.current?.({ type: 'bulk-edit', oldMemos: result.oldMemos });

    const applyPayloadToLatestRefs = (payload) => {
      const nextMemos = { ...(memosRef.current || {}) };
      const nextPendingDisplay = { ...(pendingRef.current || {}) };
      const nextPendingMergeSpans = { ...(pendingMergeSpansRef.current || {}) };

      payload.forEach((item) => {
        const key = cellKey(item.week_index, item.day_index, item.row_index, item.col_index);
        const nextMemo = {
          ...(nextMemos[key] || {}),
          content: item.content || '',
          bg_color: item.bg_color || null,
          merge_span: item.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null },
          prescription: item.prescription || null,
          body_part: item.body_part || null,
        };
        nextMemos[key] = nextMemo;
        moveOptimisticMemosRef.current[key] = nextMemo;
        nextPendingDisplay[key] = item.content || '';
        nextPendingMergeSpans[key] = item.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null };
      });

      memosRef.current = nextMemos;
      pendingRef.current = nextPendingDisplay;
      pendingMergeSpansRef.current = nextPendingMergeSpans;
    };

    applyPayloadToLatestRefs(result.payload);
    const moveRequestId = moveRequestIdRef.current + 1;
    moveRequestIdRef.current = moveRequestId;

    const firstMovedCell = result.movedKeys[0]
      ? result.movedKeys[0].split('-').map(Number)
      : null;
    if (firstMovedCell) {
      const [w, d, r, c] = firstMovedCell;
      selectSingleCell({ w, d, r, c });
      setRangeEnd(null);
      const movedKeySet = new Set(result.movedKeys);
      selectedKeysRef.current = movedKeySet;
      setSelectedKeys(movedKeySet);
    }

    moveSaveQueueRef.current = moveSaveQueueRef.current
      .catch(() => false)
      .then(() => saveBulkRef.current?.(result.payload));

    moveSaveQueueRef.current.then((success) => {
      if (!success) {
        if (moveRequestIdRef.current !== moveRequestId) return;
        applyCellDisplayRef.current?.(result.oldMemos);
        applyMergeSpanRef.current?.(result.oldMemos);
        applyPayloadToLatestRefs(result.oldMemos);
        addToast('셀 이동 실패', 'error');
      }
    });
  }, [
    addToast,
    cellKey,
    currentMonth,
    currentYear,
    rowCount,
    selectSingleCell,
    setRangeEnd,
    setSelectedKeys,
  ]);

  useEffect(() => {
    const handleEarlyReservationShortcut = (event) => {
      if (!selectedCell || editingCell || contextMenu) return;
      if (!isReservationTimeShortcutEvent(event)) return;
      if (isContextMenuTarget(event.target)) return;
      if (isEditableTarget(event.target)) return;
      handleReservationTimeShortcut(event);
    };

    window.addEventListener('keydown', handleEarlyReservationShortcut, { capture: true, passive: false });
    document.addEventListener('keydown', handleEarlyReservationShortcut, { capture: true, passive: false });
    return () => {
      window.removeEventListener('keydown', handleEarlyReservationShortcut, { capture: true });
      document.removeEventListener('keydown', handleEarlyReservationShortcut, { capture: true });
    };
  }, [
    contextMenu,
    editingCell,
    handleReservationTimeShortcut,
    isContextMenuTarget,
    isEditableTarget,
    isReservationTimeShortcutEvent,
    selectedCell,
  ]);

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

    if (isPatientHistoryShortcut(e)) {
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
      if (getEditingCellKeyAction(e) === 'close-edit') {
        e.preventDefault();
        setEditingCell(null);
      }
      return;
    }

    if (isBodyPartMenuShortcut(e)) {
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

    const applyVisitCountDelta = (delta) => {
      const keys = Array.from(selectedKeys || []);
      const latestMemos = memosRef.current;
      const latestPending = pendingRef.current;
      const saveMemo = onSaveMemoRef.current;

      const displayUpdates = keys.map(key => {
        const [kw, kd, kr, kc] = key.split('-').map(Number);
        const memo = latestMemos[key] || {};
        const stableContent = visitDebounceRef.current.pending.get(key)?.nextContent
          ?? (latestPending[key] !== undefined ? String(latestPending[key]) : (memo.content || ''));
        if (!stableContent || stableContent.trim() === '\u200B') return null;

        const currentVisit = getSchedulerVisitInputValue(stableContent);
        const nextVisit = stepVisitShortcutInputValue(currentVisit, delta);
        const nextContent = applyVisitCountToSchedulerContent(stableContent, nextVisit);
        if (nextContent === stableContent) return null;

        visitDebounceRef.current.pending.set(key, {
          kw,
          kd,
          kr,
          kc,
          memo,
          nextContent,
        });

        return { key, content: nextContent };
      }).filter(Boolean);

      if (displayUpdates.length > 0) {
        applyCellDisplayRef.current?.(displayUpdates);
      }

      if (visitDebounceRef.current.timer) clearTimeout(visitDebounceRef.current.timer);
      visitDebounceRef.current.timer = setTimeout(() => {
        const snapshot = visitDebounceRef.current;
        const pendingSaves = Array.from(snapshot.pending.values());
        const undoMemos = pendingSaves.length > 0
          ? buildSnapshotRef.current(pendingSaves.map(({ kw, kd, kr, kc }) => `${kw}-${kd}-${kr}-${kc}`))
          : null;

        snapshot.pending.clear();
        snapshot.timer = null;

        Promise.all(
          pendingSaves.map(({ kw, kd, kr, kc, memo, nextContent }) => {
            const key = `${kw}-${kd}-${kr}-${kc}`;
            const nextMergeSpan = pendingMergeSpansRef.current?.[key] || memo.merge_span;
            return saveMemo(
              currentYear,
              currentMonth,
              kw,
              kd,
              kr,
              kc,
              nextContent,
              memo.bg_color,
              nextMergeSpan,
              memo.prescription,
              memo.body_part
            );
          })
        ).then(saveResults => {
          if (saveResults.some(Boolean) && undoMemos) {
            recordUndoRef.current({ type: 'bulk-edit', oldMemos: undoMemos });
          }
        });
      }, 300);
    };

    if (isMeta && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      e.stopPropagation();
      applyVisitCountDelta(e.key === 'ArrowUp' ? 1 : -1);
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
          const stableContent = latestPending[key] !== undefined ? String(latestPending[key]) : (memo.content || '');
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

    if (isGridNavigationKey(e)) {
      e.preventDefault();

      if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.stopPropagation();
        moveSelectedCellsByRow(e.key === 'ArrowUp' ? -1 : 1);
        return;
      }

      const nextCell = getAdjacentCell({ w, d, r, c }, e.key);

      if (e.shiftKey) {
        setRangeEnd(nextCell);
        setSelectedKeys(buildRangeKeys(selectedCell, nextCell));
      } else {
        selectSingleCell(nextCell);
      }
      return;
    }

    if (isTreatmentCancelShortcut(e)) {
      e.preventDefault();
      e.stopPropagation();
      handleToggleTreatmentCancel();
      return;
    }

    if (handleReservationTimeShortcut(e)) {
      return;
    }

    if (isTreatmentCompleteShortcut(e)) {
      e.preventDefault();
      e.stopPropagation();
      handleToggleTreatmentComplete();
      return;
    }

    if (isHolidayBackgroundShortcut(e)) {
      e.preventDefault();
      e.stopPropagation();
      handleToggleHolidayBackground();
      return;
    }

    if (isMergeShortcut(e)) {
      e.preventDefault();
      e.stopPropagation();
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
    handleReservationTimeShortcut,
    moveSelectedCellsByRow,
    memos,
  ]);
}
