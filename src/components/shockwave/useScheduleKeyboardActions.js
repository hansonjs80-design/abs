import { useCallback, useEffect, useRef } from 'react';
import {
  SCHEDULER_HOLIDAY_BG,
  isUndoShortcutEvent,
  stepReservationTimeWithinCellBase,
  getReservationTimeFromMergeSpan,
  buildMergeSpanWithReservationTime,
  applyVisitCountToSchedulerContent,
  getSchedulerVisitInputValue,
  stepVisitShortcutInputValue,
} from '../../lib/schedulerUtils';
import {
  getActionDoseTagFromPrescription,
  updateDoseTagForPrescriptionContent,
} from '../../lib/schedulerContentFormat';
import { getEffectiveSettlementSettings } from '../../lib/settlementSettings';
import { getPrescriptionScheduleSettings } from '../../lib/prescriptionScheduleSettings';
import { buildManualTherapyUnmergePayload } from '../../lib/manualTherapyMergeUtils';
import { mergeSchedulePayloadIntoPendingShortcutSaves } from '../../lib/schedulePrescriptionChangeUtils';
import { buildManualTherapyAutoMergePayload } from '../../lib/scheduleManualTherapyAutoMergeUtils';
import {
  buildClearReservationGroupPayload,
  buildMergeSpanWithReservationGroup,
  buildReservationGroupPayload,
  getReservationGroupFromMergeSpan,
  RESERVATION_GROUP_SAME,
  selectionHasReservationGroup,
} from '../../lib/scheduleReservationGroupUtils';
import {
  getScheduleShortcutKey,
  getEditingCellKeyAction,
  isBodyPartMenuShortcut,
  isGridNavigationKey,
  isHolidayBackgroundShortcut,
  isMergeShortcut,
  isMemoMenuShortcut,
  isPatientHistoryShortcut,
  isSameReservationGroupShortcut,
  isTreatmentCancelShortcut,
  isTreatmentCompleteShortcut,
  normalizeScheduleShortcutValue,
} from '../../lib/scheduleKeyboardUtils';
import { buildMoveScheduleSelectionPayload } from '../../lib/scheduleMoveUtils';
import useScheduleMovePersistence from './useScheduleMovePersistence';

export default function useScheduleKeyboardActions({
  contextMenu,
  clipboardSource,
  setClipboardSource,
  selectedCell,
  selectedCellRef,
  editingCell,
  selectedKeys,
  pendingMemoOverrides,
  pendingMergeSpans,
  pendingDisplayValuesRef,
  pendingMemoOverridesRef,
  pendingCellBgColors,
  applyImmediateCellBg,
  applyImmediateCellDisplay,
  applyImmediateMergeSpan,
  clearImmediateCellDisplay,
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
  setContextMenu,
  shockwaveSettings,
  getDefaultReservationTime,
  handleOpenBodyPartMenu,
  handleOpenMemoMenu,
  onSelectionMoved,
}) {
  // ── refs로 최신 값 추적 (연속 키 입력 시 stale closure 방지) ──
  const getLatestSelectedCell = useCallback(() => selectedCellRef?.current || selectedCell, [selectedCellRef, selectedCell]);
  const baseMemosRef = useRef(memos);
  const memosRef = useRef(memos);
  const selectedKeysRef = useRef(selectedKeys);
  const pendingRef = pendingDisplayValuesRef; // 외부 동기 ref 사용
  const pendingBgRef = useRef(pendingCellBgColors);
  const pendingMergeSpansRef = useRef(pendingMergeSpans);
  const onSaveMemoRef = useRef(onSaveMemo);
  const saveBulkRef = useRef(saveShockwaveMemosBulk);
  const buildSnapshotRef = useRef(buildMemoSnapshotForKeys);
  const recordUndoRef = useRef(recordUndo);
  const getDefaultTimeRef = useRef(getDefaultReservationTime);
  const applyCellDisplayRef = useRef(applyImmediateCellDisplay);
  const applyMergeSpanRef = useRef(applyImmediateMergeSpan);
  const clearCellDisplayRef = useRef(clearImmediateCellDisplay);
  const timeDebounceRef = useRef({ timer: null, pending: new Map() });
  const visitDebounceRef = useRef({ timer: null, pending: new Map() });

  useEffect(() => {
    baseMemosRef.current = memos;
    memosRef.current = { ...(memos || {}), ...(pendingMemoOverridesRef.current || {}) };
  }, [memos, pendingMemoOverridesRef]);
  useEffect(() => { selectedKeysRef.current = selectedKeys; }, [selectedKeys]);
  useEffect(() => { pendingBgRef.current = pendingCellBgColors; }, [pendingCellBgColors]);
  useEffect(() => {
    memosRef.current = { ...(baseMemosRef.current || {}), ...(pendingMemoOverridesRef.current || {}) };
  }, [pendingMemoOverrides, pendingMemoOverridesRef]);
  useEffect(() => { pendingMergeSpansRef.current = pendingMergeSpans; }, [pendingMergeSpans]);
  useEffect(() => { onSaveMemoRef.current = onSaveMemo; }, [onSaveMemo]);
  useEffect(() => { saveBulkRef.current = saveShockwaveMemosBulk; }, [saveShockwaveMemosBulk]);
  useEffect(() => { buildSnapshotRef.current = buildMemoSnapshotForKeys; }, [buildMemoSnapshotForKeys]);
  useEffect(() => { recordUndoRef.current = recordUndo; }, [recordUndo]);
  useEffect(() => { getDefaultTimeRef.current = getDefaultReservationTime; }, [getDefaultReservationTime]);
  useEffect(() => { applyCellDisplayRef.current = applyImmediateCellDisplay; }, [applyImmediateCellDisplay]);
  useEffect(() => { applyMergeSpanRef.current = applyImmediateMergeSpan; }, [applyImmediateMergeSpan]);
  useEffect(() => { clearCellDisplayRef.current = clearImmediateCellDisplay; }, [clearImmediateCellDisplay]);

  // 디바운스 cleanup
  useEffect(() => {
    const timeDebounce = timeDebounceRef.current;
    const visitDebounce = visitDebounceRef.current;
    return () => {
      if (timeDebounce?.timer) clearTimeout(timeDebounce.timer);
      if (visitDebounce?.timer) clearTimeout(visitDebounce.timer);
    };
  }, []);

  const {
    flushPendingMoveSave,
    schedulePendingMoveSave,
    getLatestMemosWithPendingMoves,
    applyPayloadToLatestRefs,
  } = useScheduleMovePersistence({
    addToast,
    applyCellDisplayRef,
    applyMergeSpanRef,
    cellKey,
    clearCellDisplayRef,
    memosRef,
    pendingMergeSpansRef,
    pendingRef,
    saveBulkRef,
    editingCell,
    pendingMemoOverridesRef,
  });

  const updateOpenContextMenuSnapshotFromPayload = useCallback((payload = []) => {
    if (!contextMenu || !setContextMenu) return;
    const contextKey = cellKey(contextMenu.weekIdx, contextMenu.dayIdx, contextMenu.rowIdx, contextMenu.colIdx);
    const rows = Array.isArray(payload) ? payload : [payload];
    const contextPayload = rows.find((item) => (
      `${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}` === contextKey
    ));
    if (!contextPayload) return;

    setContextMenu((prev) => {
      if (!prev) return prev;
      const prevKey = cellKey(prev.weekIdx, prev.dayIdx, prev.rowIdx, prev.colIdx);
      if (prevKey !== contextKey) return prev;
      return {
        ...prev,
        memoSnapshot: {
          ...(prev.memoSnapshot || {}),
          content: contextPayload.content || '',
          bg_color: contextPayload.bg_color ?? null,
          merge_span: contextPayload.merge_span,
          prescription: contextPayload.prescription || null,
          body_part: contextPayload.body_part || null,
        },
      };
    });
  }, [cellKey, contextMenu, setContextMenu]);

  const syncPendingShortcutSavesFromPayload = useCallback((payload = []) => {
    mergeSchedulePayloadIntoPendingShortcutSaves(timeDebounceRef.current.pending, payload);
    mergeSchedulePayloadIntoPendingShortcutSaves(visitDebounceRef.current.pending, payload);
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
  }, [currentMonth, currentYear, pendingRef, selectedKeys]);

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

  const toggleSelectedGreenBackground = useCallback(() => {
    const activeCell = getLatestSelectedCell();
    const selected = selectedKeysRef.current && selectedKeysRef.current.size > 0
      ? selectedKeysRef.current
      : activeCell
        ? new Set([cellKey(activeCell.w, activeCell.d, activeCell.r, activeCell.c)])
        : new Set();
    if (selected.size === 0) return;

    const latestMemos = memosRef.current || {};
    const latestPendingBg = pendingBgRef.current || {};
    const touchedKeys = new Set();
    const targetKeys = [];

    Array.from(selected).forEach((key) => {
      const [w, d, r, c] = key.split('-').map(Number);
      if (![w, d, r, c].every(Number.isFinite)) return;
      const memo = latestMemos[key] || {};
      const mergeSpan = pendingMergeSpansRef.current?.[key] || memo.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null };
      const rowSpan = Math.max(1, mergeSpan.rowSpan || 1);
      const colSpan = Math.max(1, mergeSpan.colSpan || 1);

      for (let row = r; row < r + rowSpan; row += 1) {
        for (let col = c; col < c + colSpan; col += 1) {
          const rangeKey = cellKey(w, d, row, col);
          if (touchedKeys.has(rangeKey)) continue;
          touchedKeys.add(rangeKey);
          targetKeys.push(rangeKey);
        }
      }
    });

    if (targetKeys.length === 0) return;

    const getVisibleBg = (key) => (
      Object.prototype.hasOwnProperty.call(latestPendingBg, key)
        ? latestPendingBg[key]
        : latestMemos[key]?.bg_color
    ) || null;
    const shouldClear = targetKeys.some((key) => getVisibleBg(key) === SCHEDULER_HOLIDAY_BG);
    const nextBgColor = shouldClear ? null : SCHEDULER_HOLIDAY_BG;

    const payload = targetKeys.map((key) => {
      const [w, d, r, c] = key.split('-').map(Number);
      const memo = latestMemos[key] || {};
      return {
        year: currentYear,
        month: currentMonth,
        week_index: w,
        day_index: d,
        row_index: r,
        col_index: c,
        content: memo.content || '',
        bg_color: nextBgColor,
        merge_span: pendingMergeSpansRef.current?.[key] || memo.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null },
        prescription: memo.prescription || null,
        body_part: memo.body_part || null,
      };
    });
    const oldMemos = targetKeys.map((key) => {
      const [w, d, r, c] = key.split('-').map(Number);
      const memo = latestMemos[key] || {};
      return {
        year: currentYear,
        month: currentMonth,
        week_index: w,
        day_index: d,
        row_index: r,
        col_index: c,
        content: memo.content || '',
        bg_color: getVisibleBg(key),
        merge_span: pendingMergeSpansRef.current?.[key] || memo.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null },
        prescription: memo.prescription || null,
        body_part: memo.body_part || null,
      };
    });

    recordUndoRef.current?.({ type: 'bulk-edit', oldMemos });
    applyImmediateCellBg?.(payload);
    saveBulkRef.current?.(payload).then((success) => {
      if (!success) addToast?.('배경색 변경 실패', 'error');
    });
  }, [addToast, applyImmediateCellBg, cellKey, currentMonth, currentYear, getLatestSelectedCell]);

  const toggleSameReservationGroup = useCallback(() => {
    const activeCell = getLatestSelectedCell();
    const selected = selectedKeysRef.current && selectedKeysRef.current.size > 0
      ? selectedKeysRef.current
      : activeCell
        ? new Set([cellKey(activeCell.w, activeCell.d, activeCell.r, activeCell.c)])
        : new Set();
    const latestMemos = memosRef.current || {};
    const shouldClear = selectionHasReservationGroup({
      keys: selected,
      memos: latestMemos,
      pendingMergeSpans: pendingMergeSpansRef.current,
    });
    const batch = shouldClear
      ? buildClearReservationGroupPayload({
          keys: selected,
          memos: latestMemos,
          pendingDisplayValues: pendingRef.current,
          pendingMergeSpans: pendingMergeSpansRef.current,
          currentYear,
          currentMonth,
        })
      : buildReservationGroupPayload({
          keys: selected,
          memos: latestMemos,
          pendingMergeSpans: pendingMergeSpansRef.current,
          currentYear,
          currentMonth,
          getDefaultReservationTime: getDefaultTimeRef.current,
          mode: RESERVATION_GROUP_SAME,
        });
    if (!shouldClear && selected.size < 2) {
      addToast?.('동시간 예약은 2개 이상 셀을 선택해 주세요.', 'warning');
      return;
    }
    if (!batch?.payload?.length) return;

    recordUndoRef.current?.({ type: 'bulk-edit', oldMemos: batch.oldMemos });
    applyCellDisplayRef.current?.(batch.payload);
    applyMergeSpanRef.current?.(batch.payload);
    applyPayloadToLatestRefs(batch.payload);
    saveBulkRef.current?.(batch.payload).then((success) => {
      if (!success) {
        applyCellDisplayRef.current?.(batch.oldMemos);
        applyMergeSpanRef.current?.(batch.oldMemos);
        applyPayloadToLatestRefs(batch.oldMemos);
        addToast?.(shouldClear ? '동시간 예약 취소 저장 실패' : '동시간 예약 설정 저장 실패', 'error');
      } else {
        addToast?.(shouldClear ? '동시간 예약을 취소했습니다.' : '동시간 예약으로 설정했습니다.', 'success');
      }
    });
  }, [addToast, applyPayloadToLatestRefs, cellKey, currentMonth, currentYear, getLatestSelectedCell, pendingRef]);

  const applyPrescriptionShortcut = useCallback((event) => {
    const activeCell = getLatestSelectedCell();
    if (!activeCell || editingCell) return false;

    const isMeta = event.metaKey || event.ctrlKey;
    const isMetaOrAltOrShift = isMeta || event.altKey || (event.shiftKey && isMeta);
    const keyNum = getScheduleShortcutKey(event);
    if (!isMetaOrAltOrShift || !/^[1-9A-Z]$/.test(keyNum)) return false;
    const effectiveManualSettings = getEffectiveSettlementSettings(shockwaveSettings, currentYear, currentMonth, 'manual_therapy');
    const effectiveShockwaveSettings = getEffectiveSettlementSettings(shockwaveSettings, currentYear, currentMonth, 'shockwave');
    const prescriptionScheduleSettings = getPrescriptionScheduleSettings(shockwaveSettings, currentYear, currentMonth);
    const hiddenPrescriptions = prescriptionScheduleSettings?.hiddenPrescriptions || [];

    const manualShortcuts = effectiveManualSettings?.shortcuts || {};
    const manualPrescription = Object.keys(manualShortcuts).find((prescription) => (
      normalizeScheduleShortcutValue(manualShortcuts[prescription]) === keyNum && !hiddenPrescriptions.includes(prescription)
    ));
    const shockwaveShortcuts = effectiveShockwaveSettings?.shortcuts || {};
    const shockwavePrescription = Object.keys(shockwaveShortcuts).find((prescription) => (
      normalizeScheduleShortcutValue(shockwaveShortcuts[prescription]) === keyNum && !hiddenPrescriptions.includes(prescription)
    ));
    const targetPrescription = manualPrescription || shockwavePrescription || '';
    if (!targetPrescription) return false;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();

    const doseTag = getActionDoseTagFromPrescription(targetPrescription, prescriptionScheduleSettings.doseTags);
    const rawSelected = selectedKeysRef.current && selectedKeysRef.current.size > 0
      ? selectedKeysRef.current
      : new Set([cellKey(activeCell.w, activeCell.d, activeCell.r, activeCell.c)]);
    const selectionMemos = memosRef.current || {};
    const selectionMergeSpans = pendingMergeSpansRef.current || {};
    const keys = Array.from(new Set(Array.from(rawSelected).map((key) => {
      const mergeSpan = selectionMergeSpans[key] || selectionMemos[key]?.merge_span;
      return mergeSpan?.mergedInto || key;
    })));
    const saveMemo = onSaveMemoRef.current;

    (async () => {
      let anyChanged = false;
      let mergeBlocked = false;
      const undoMemosByKey = new Map();
      const addUndoMemos = (snapshot = []) => {
        snapshot.forEach((memo) => {
          const key = cellKey(memo.week_index, memo.day_index, memo.row_index, memo.col_index);
          undoMemosByKey.set(key, memo);
        });
      };

      for (const key of keys) {
        const latestMemos = memosRef.current || {};
        const latestPending = pendingRef.current || {};
        const [kw, kd, kr, kc] = key.split('-').map(Number);
        if (![kw, kd, kr, kc].every(Number.isFinite)) continue;
        const memo = latestMemos[key] || {};
        const stableContent = latestPending[key] !== undefined ? String(latestPending[key]) : (memo.content || '');
        if (!stableContent) continue;

        const previousDoseTag = prescriptionScheduleSettings.doseTags?.[memo.prescription] || memo.prescription?.match(/(\d{2,3})/)?.[1] || '';
        const updatedContent = updateDoseTagForPrescriptionContent(
          stableContent,
          doseTag,
          previousDoseTag,
          prescriptionScheduleSettings.doseTags
        );

        if (memo.prescription === targetPrescription && stableContent === updatedContent) continue;

        const manualTherapyMerge = buildManualTherapyAutoMergePayload({
            key,
            memos: latestMemos,
            pendingMergeSpans: pendingMergeSpansRef.current,
            currentYear,
            currentMonth,
            rowCount,
            content: updatedContent,
            bgColor: memo.bg_color || null,
            prescription: targetPrescription,
            bodyPart: memo.body_part || null,
            mergeSpan: pendingMergeSpansRef.current?.[key] || memo.merge_span,
            durationMinutesMap: prescriptionScheduleSettings.durationMinutesMap,
            doseTags: prescriptionScheduleSettings.doseTags,
            slotMinutes: shockwaveSettings?.interval_minutes || 10,
            oldContent: memo.content || '',
            oldPrescription: memo.prescription || '',
          });

        if (manualTherapyMerge.ok) {
          const undoSnapshot = buildSnapshotRef.current(manualTherapyMerge.affectedKeys);
          addUndoMemos(undoSnapshot);
          applyCellDisplayRef.current?.(manualTherapyMerge.payload);
          applyMergeSpanRef.current?.(manualTherapyMerge.payload);
          applyPayloadToLatestRefs(manualTherapyMerge.payload);
          updateOpenContextMenuSnapshotFromPayload(manualTherapyMerge.payload);
          syncPendingShortcutSavesFromPayload(manualTherapyMerge.payload);

          const success = await saveBulkRef.current?.(manualTherapyMerge.payload);
          if (success) {
            anyChanged = true;
          } else {
            applyCellDisplayRef.current?.(undoSnapshot);
            applyMergeSpanRef.current?.(undoSnapshot);
            applyPayloadToLatestRefs(undoSnapshot);
            syncPendingShortcutSavesFromPayload(undoSnapshot);
            addToast?.('도수치료 자동 병합 저장에 실패했습니다.', 'error');
          }
          continue;
        }

        if (!manualPrescription) {
          const unmergePayload = buildManualTherapyUnmergePayload({
            key,
            memos: latestMemos,
            pendingMergeSpans: pendingMergeSpansRef.current,
            currentYear,
            currentMonth,
            content: updatedContent,
            bgColor: memo.bg_color || null,
            prescription: targetPrescription,
            bodyPart: memo.body_part || null,
          });

          if (unmergePayload.ok) {
            const undoSnapshot = buildSnapshotRef.current(unmergePayload.affectedKeys);
            addUndoMemos(undoSnapshot);
            applyCellDisplayRef.current?.(unmergePayload.payload);
            applyMergeSpanRef.current?.(unmergePayload.payload);
            applyPayloadToLatestRefs(unmergePayload.payload);
            updateOpenContextMenuSnapshotFromPayload(unmergePayload.payload);
            syncPendingShortcutSavesFromPayload(unmergePayload.payload);

            const success = await saveBulkRef.current?.(unmergePayload.payload);
            if (success) {
              anyChanged = true;
            } else {
              applyCellDisplayRef.current?.(undoSnapshot);
              applyMergeSpanRef.current?.(undoSnapshot);
              applyPayloadToLatestRefs(undoSnapshot);
              syncPendingShortcutSavesFromPayload(undoSnapshot);
              addToast?.('병합 해제 저장에 실패했습니다.', 'error');
            }
            continue;
          }
        }

        if (manualTherapyMerge.reason === 'occupied' || manualTherapyMerge.reason === 'bounds') {
          mergeBlocked = true;
        }

        const undoSnapshot = buildSnapshotRef.current([key]);
        const fallbackPayload = {
          year: currentYear,
          month: currentMonth,
          week_index: kw,
          day_index: kd,
          row_index: kr,
          col_index: kc,
          content: updatedContent,
          bg_color: memo.bg_color || null,
          merge_span: pendingMergeSpansRef.current?.[key] || memo.merge_span,
          prescription: targetPrescription,
          body_part: memo.body_part || null,
        };
        addUndoMemos(undoSnapshot);
        applyCellDisplayRef.current?.(fallbackPayload, { keepContextMenuOpen: Boolean(contextMenu) });
        applyPayloadToLatestRefs([fallbackPayload]);
        updateOpenContextMenuSnapshotFromPayload(fallbackPayload);
        syncPendingShortcutSavesFromPayload(fallbackPayload);
        const success = await saveMemo(
          currentYear,
          currentMonth,
          kw,
          kd,
          kr,
          kc,
          updatedContent,
          memo.bg_color,
          fallbackPayload.merge_span,
          targetPrescription,
          memo.body_part
        );
        if (success) {
          anyChanged = true;
        } else {
          applyCellDisplayRef.current?.(undoSnapshot, { keepContextMenuOpen: Boolean(contextMenu) });
          applyPayloadToLatestRefs(undoSnapshot);
          updateOpenContextMenuSnapshotFromPayload(undoSnapshot);
          syncPendingShortcutSavesFromPayload(undoSnapshot);
          addToast?.('처방 저장에 실패했습니다.', 'error');
        }
      }
      if (anyChanged) {
        recordUndoRef.current({ type: 'bulk-edit', oldMemos: Array.from(undoMemosByKey.values()) });
        addToast(`${targetPrescription} 처방이 적용되었습니다.`, 'success');
        if (mergeBlocked) {
          addToast('아래 셀이 비어있지 않거나 마지막 행이라 일부 셀은 자동 병합되지 않았습니다.', 'warning');
        }
      }
    })();

    return true;
  }, [addToast, applyPayloadToLatestRefs, cellKey, contextMenu, currentMonth, currentYear, editingCell, getLatestSelectedCell, pendingRef, rowCount, shockwaveSettings, syncPendingShortcutSavesFromPayload, updateOpenContextMenuSnapshotFromPayload]);

  const moveSelectedCellsByRow = useCallback((rowDelta) => {
    const activeCell = getLatestSelectedCell();
    const selectedCellKey = activeCell ? cellKey(activeCell.w, activeCell.d, activeCell.r, activeCell.c) : null;
    let moveKeys = selectedKeysRef.current;
    if (selectedCellKey && (!moveKeys || moveKeys.size === 0)) {
      moveKeys = new Set([selectedCellKey]);
      selectedKeysRef.current = moveKeys;
    }

    const currentMemos = getLatestMemosWithPendingMoves();
    const activeCellGroup = selectedCellKey
      ? getReservationGroupFromMergeSpan(pendingMergeSpansRef.current?.[selectedCellKey] || currentMemos[selectedCellKey]?.merge_span)
      : null;
    if (selectedCellKey && activeCellGroup?.id) {
      moveKeys = new Set([selectedCellKey]);
      selectedKeysRef.current = moveKeys;
    }
    const groupClearBatch = buildClearReservationGroupPayload({
      keys: moveKeys,
      memos: currentMemos,
      pendingDisplayValues: pendingRef.current,
      pendingMergeSpans: pendingMergeSpansRef.current,
      currentYear,
      currentMonth,
    });
    const result = buildMoveScheduleSelectionPayload({
      selectedKeys: moveKeys,
      memos: currentMemos,
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

    const movePayload = result.payload.map((item) => ({
      ...item,
      merge_span: buildMergeSpanWithReservationGroup(item.merge_span, null),
    }));
    const relocationPayload = [];
    if (selectedCellKey && activeCellGroup?.id && selectedCellKey === activeCellGroup.anchorKey) {
      const groupItems = (groupClearBatch.payload || [])
        .map((item) => ({
          key: `${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`,
          item,
        }))
        .filter(({ item }) => {
          const group = getReservationGroupFromMergeSpan(
            pendingMergeSpansRef.current?.[`${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`]
              || currentMemos[`${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`]?.merge_span
          );
          return group?.id === activeCellGroup.id;
        })
        .sort((a, b) => {
          const aValue = (((a.item.week_index * 10 + a.item.day_index) * 10 + a.item.col_index) * 1000) + a.item.row_index;
          const bValue = (((b.item.week_index * 10 + b.item.day_index) * 10 + b.item.col_index) * 1000) + b.item.row_index;
          return aValue - bValue;
        });
      const remainingItems = groupItems
        .filter(({ key, item }) => key !== selectedCellKey && String(item.content || '').trim())
        .map(({ key, item }) => ({ key, item }));
      const firstRemaining = remainingItems[0];
      if (firstRemaining) {
        const [w, d, r, c] = selectedCellKey.split('-').map(Number);
        relocationPayload.push({
          ...firstRemaining.item,
          year: currentYear,
          month: currentMonth,
          week_index: w,
          day_index: d,
          row_index: r,
          col_index: c,
          merge_span: buildMergeSpanWithReservationGroup(firstRemaining.item.merge_span, null),
        });
        relocationPayload.push({
          ...firstRemaining.item,
          content: '',
          bg_color: null,
          merge_span: { rowSpan: 1, colSpan: 1, mergedInto: null },
          prescription: null,
          body_part: null,
        });
      }
    }
    const nextPayloadByKey = new Map();
    (groupClearBatch.payload || []).forEach((item) => {
      nextPayloadByKey.set(`${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`, item);
    });
    movePayload.forEach((item) => {
      nextPayloadByKey.set(`${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`, item);
    });
    relocationPayload.forEach((item) => {
      nextPayloadByKey.set(`${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`, item);
    });
    const oldMemoByKey = new Map();
    [...(groupClearBatch.oldMemos || []), ...result.oldMemos].forEach((item) => {
      oldMemoByKey.set(`${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`, item);
    });

    if (Number(shockwaveSettings?.interval_minutes || 0) === 10) {
      const schedulePrescriptionSettings = getPrescriptionScheduleSettings(shockwaveSettings, currentYear, currentMonth);
      const buildActiveMemos = () => {
        const active = { ...(currentMemos || {}) };
        nextPayloadByKey.forEach((item) => {
          const key = `${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`;
          active[key] = {
            ...(active[key] || {}),
            content: item.content || '',
            bg_color: item.bg_color || null,
            merge_span: item.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null },
            prescription: item.prescription || null,
            body_part: item.body_part || null,
          };
        });
        return active;
      };
      const activeMemosForCandidates = buildActiveMemos();
      const candidateByKey = new Map();
      const addCandidate = (key) => {
        const [kw, kd, kr, kc] = key.split('-').map(Number);
        if (![kw, kd, kr, kc].every(Number.isFinite)) return;
        const memo = activeMemosForCandidates[key] || {};
        const mergeSpan = memo.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null };
        if (
          !String(memo.content || '').trim() ||
          mergeSpan.mergedInto ||
          (mergeSpan.rowSpan || 1) > 1 ||
          (mergeSpan.colSpan || 1) > 1
        ) {
          return;
        }
        candidateByKey.set(key, {
          year: currentYear,
          month: currentMonth,
          week_index: kw,
          day_index: kd,
          row_index: kr,
          col_index: kc,
          content: memo.content || '',
          bg_color: memo.bg_color || null,
          merge_span: mergeSpan,
          prescription: memo.prescription || null,
          body_part: memo.body_part || null,
        });
      };
      nextPayloadByKey.forEach((item) => {
        const key = `${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`;
        if (String(item.content || '').trim()) {
          addCandidate(key);
          return;
        }
        const aboveRow = item.row_index - 1;
        if (aboveRow >= 0) {
          addCandidate(`${item.week_index}-${item.day_index}-${aboveRow}-${item.col_index}`);
        }
      });
      const candidateItems = Array.from(candidateByKey.values());
      candidateItems.forEach((item) => {
        const key = `${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`;
        const activeMemos = buildActiveMemos();
        const manualTherapyMerge = buildManualTherapyAutoMergePayload({
          key,
          memos: activeMemos,
          pendingMergeSpans: {},
          currentYear,
          currentMonth,
          rowCount,
          content: item.content || '',
          bgColor: item.bg_color || null,
          prescription: item.prescription || '',
          bodyPart: item.body_part || null,
          mergeSpan: item.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null },
          durationMinutesMap: schedulePrescriptionSettings.durationMinutesMap,
          doseTags: schedulePrescriptionSettings.doseTags,
          slotMinutes: shockwaveSettings?.interval_minutes || 10,
        });
        if (!manualTherapyMerge.ok || !manualTherapyMerge.payload?.length) return;
        manualTherapyMerge.payload.forEach((payloadItem) => {
          const payloadKey = `${payloadItem.week_index}-${payloadItem.day_index}-${payloadItem.row_index}-${payloadItem.col_index}`;
          if (!oldMemoByKey.has(payloadKey)) {
            const oldMemo = activeMemos[payloadKey] || {};
            oldMemoByKey.set(payloadKey, {
              year: currentYear,
              month: currentMonth,
              week_index: payloadItem.week_index,
              day_index: payloadItem.day_index,
              row_index: payloadItem.row_index,
              col_index: payloadItem.col_index,
              content: oldMemo.content || '',
              bg_color: oldMemo.bg_color || null,
              merge_span: oldMemo.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null },
              prescription: oldMemo.prescription || null,
              body_part: oldMemo.body_part || null,
            });
          }
          nextPayloadByKey.set(payloadKey, {
            ...payloadItem,
            merge_span: payloadItem.merge_span?.mergedInto
              ? payloadItem.merge_span
              : buildMergeSpanWithReservationTime(
                  payloadItem.merge_span,
                  getDefaultTimeRef.current?.(payloadItem.week_index, payloadItem.day_index, payloadItem.row_index) || ''
                ),
          });
        });
      });
    }
    const nextPayload = Array.from(nextPayloadByKey.values());
    const oldMemos = Array.from(oldMemoByKey.values());

    applyCellDisplayRef.current?.(nextPayload);
    applyMergeSpanRef.current?.(nextPayload);
    recordUndoRef.current?.({ type: 'bulk-edit', oldMemos });

    applyPayloadToLatestRefs(nextPayload);

    const firstMovedCell = result.movedKeys[0]
      ? result.movedKeys[0].split('-').map(Number)
      : null;
    if (firstMovedCell) {
      const [w, d, r, c] = firstMovedCell;
      const nextCell = { w, d, r, c };
      if (selectedCellRef) {
        selectedCellRef.current = nextCell;
      }
      selectSingleCell(nextCell, { normalize: false });
      setRangeEnd(null);
      const movedKeySet = new Set(result.movedKeys);
      selectedKeysRef.current = movedKeySet;
      setSelectedKeys(movedKeySet);
      onSelectionMoved?.(nextCell, result.movedKeys);
    }

    schedulePendingMoveSave(nextPayload, oldMemos);
  }, [
    addToast,
    cellKey,
    currentMonth,
    currentYear,
    applyPayloadToLatestRefs,
    rowCount,
    schedulePendingMoveSave,
    selectSingleCell,
    setRangeEnd,
    setSelectedKeys,
    onSelectionMoved,
    getLatestMemosWithPendingMoves,
    getLatestSelectedCell,
    pendingRef,
    selectedCellRef,
    shockwaveSettings,
  ]);

  useEffect(() => {
    const handleEarlyReservationShortcut = (event) => {
      const activeCell = getLatestSelectedCell();
      if (!activeCell || editingCell || contextMenu) return;
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
    getLatestSelectedCell,
    handleReservationTimeShortcut,
    isContextMenuTarget,
    isEditableTarget,
    isReservationTimeShortcutEvent,
  ]);

  useEffect(() => {
    const handleEarlyBackgroundShortcut = (event) => {
      const activeCell = getLatestSelectedCell();
      if (!activeCell || editingCell || contextMenu) return;
      if (!isHolidayBackgroundShortcut(event)) return;
      if (isContextMenuTarget(event.target)) return;
      if (isEditableTarget(event.target)) return;
      if (event.__shockwaveBackgroundHandled) return;
      event.__shockwaveBackgroundHandled = true;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      toggleSelectedGreenBackground();
    };

    window.addEventListener('keydown', handleEarlyBackgroundShortcut, { capture: true, passive: false });
    document.addEventListener('keydown', handleEarlyBackgroundShortcut, { capture: true, passive: false });
    return () => {
      window.removeEventListener('keydown', handleEarlyBackgroundShortcut, { capture: true });
      document.removeEventListener('keydown', handleEarlyBackgroundShortcut, { capture: true });
    };
  }, [
    contextMenu,
    editingCell,
    getLatestSelectedCell,
    isContextMenuTarget,
    isEditableTarget,
    toggleSelectedGreenBackground,
  ]);

  useEffect(() => {
    const handleEarlyPrescriptionShortcut = (event) => {
      if (event.__shockwavePrescriptionHandled) return;
      if (applyPrescriptionShortcut(event)) {
        event.__shockwavePrescriptionHandled = true;
      }
    };

    window.addEventListener('keydown', handleEarlyPrescriptionShortcut, { capture: true, passive: false });
    document.addEventListener('keydown', handleEarlyPrescriptionShortcut, { capture: true, passive: false });
    return () => {
      window.removeEventListener('keydown', handleEarlyPrescriptionShortcut, { capture: true });
      document.removeEventListener('keydown', handleEarlyPrescriptionShortcut, { capture: true });
    };
  }, [applyPrescriptionShortcut]);

  useEffect(() => {
    const handleContextMenuTreatmentCompleteShortcut = (event) => {
      const activeCell = getLatestSelectedCell();
      if (!contextMenu || !activeCell || editingCell) return;
      if (!isTreatmentCompleteShortcut(event)) return;
      if (event.__shockwaveTreatmentCompleteHandled) return;
      event.__shockwaveTreatmentCompleteHandled = true;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      handleToggleTreatmentComplete({ keepContextMenuOpen: true });
    };

    window.addEventListener('keydown', handleContextMenuTreatmentCompleteShortcut, { capture: true, passive: false });
    document.addEventListener('keydown', handleContextMenuTreatmentCompleteShortcut, { capture: true, passive: false });
    return () => {
      window.removeEventListener('keydown', handleContextMenuTreatmentCompleteShortcut, { capture: true });
      document.removeEventListener('keydown', handleContextMenuTreatmentCompleteShortcut, { capture: true });
    };
  }, [contextMenu, editingCell, getLatestSelectedCell, handleToggleTreatmentComplete]);

  return useCallback((e) => {
    if (e.defaultPrevented) return;
    if (e.__shockwaveBackgroundHandled) return;
    if (e.__shockwavePrescriptionHandled) return;
    if (e.__shockwaveTreatmentCompleteHandled) return;
    if (clipboardSource && (e.key === 'Escape' || e.key === 'Backspace' || isUndoShortcutEvent(e))) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation?.();
      if (isUndoShortcutEvent(e)) e.__shockwaveUndoHandled = true;
      setClipboardSource?.(null);
      return;
    }
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

    if (applyPrescriptionShortcut(e)) {
      return;
    }

    if (isContextMenuTarget(e.target)) return;

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
        flushPendingMoveSave();
        deleteCells(selectedKeysRef.current);
        setContextMenu?.(null);
      }
      return;
    }
    const activeCell = getLatestSelectedCell();
    if (!activeCell) return;
    const { w, d, r, c } = activeCell;

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

    if (isMemoMenuShortcut(e)) {
      e.preventDefault();
      e.stopPropagation();
      if (handleOpenMemoMenu) {
        handleOpenMemoMenu();
      }
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      const key = cellKey(w, d, r, c);
      flushPendingMoveSave(key);
      beginEditingCell(key, memos[key]?.content || '', true);
      return;
    }

    if (e.key === 'F2') {
      e.preventDefault();
      const key = cellKey(w, d, r, c);
      flushPendingMoveSave(key);
      beginEditingCell(key, memos[key]?.content || '', true);
      return;
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      flushPendingMoveSave();
      deleteCells(selectedKeysRef.current);
      return;
    }

    const applyVisitCountDelta = (delta) => {
      const activeCell = getLatestSelectedCell();
      const keys = selectedKeysRef.current && selectedKeysRef.current.size > 0
        ? Array.from(selectedKeysRef.current)
        : activeCell
          ? [cellKey(activeCell.w, activeCell.d, activeCell.r, activeCell.c)]
          : [];
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

    if (isGridNavigationKey(e)) {
      e.preventDefault();

      if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.stopPropagation();
        e.stopImmediatePropagation?.();
        if (e.__shockwaveScheduleMoveHandled) {
          return;
        }
        e.__shockwaveScheduleMoveHandled = true;
        moveSelectedCellsByRow(e.key === 'ArrowUp' ? -1 : 1);
        return;
      }

      const nextCell = getAdjacentCell({ w, d, r, c }, e.key);

      if (e.shiftKey) {
        setRangeEnd(nextCell);
        const nextRangeKeys = buildRangeKeys(activeCell, nextCell);
        selectedKeysRef.current = nextRangeKeys;
        setSelectedKeys(nextRangeKeys);
        onSelectionMoved?.(nextCell, Array.from(nextRangeKeys));
      } else {
        const nextCellKey = cellKey(nextCell.w, nextCell.d, nextCell.r, nextCell.c);
        if (selectedCellRef) {
          selectedCellRef.current = nextCell;
        }
        selectedKeysRef.current = new Set([nextCellKey]);
        selectSingleCell(nextCell);
        onSelectionMoved?.(nextCell, [nextCellKey]);
      }
      return;
    }

    if (isTreatmentCancelShortcut(e)) {
      e.preventDefault();
      e.stopPropagation();
      handleToggleTreatmentCancel();
      return;
    }

    if (isSameReservationGroupShortcut(e)) {
      e.preventDefault();
      e.stopPropagation();
      toggleSameReservationGroup();
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
      toggleSelectedGreenBackground();
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
      const nextCell = { w, d, r, c: nextCol };
      const nextCellKey = cellKey(w, d, r, nextCol);
      if (selectedCellRef) {
        selectedCellRef.current = nextCell;
      }
      selectedKeysRef.current = new Set([nextCellKey]);
      selectSingleCell(nextCell);
      onSelectionMoved?.(nextCell, [nextCellKey]);
      return;
    }

    const shortcutKey = getScheduleShortcutKey(e);

    if (isMeta && shortcutKey === 'C') {
      e.preventDefault();
      handleCopySelection();
      return;
    }

    if (isMeta && shortcutKey === 'X') {
      e.preventDefault();
      handleCutSelection();
      return;
    }

    if ((e.key.length === 1 || e.key === 'Process' || e.keyCode === 229) && !isMeta && !e.altKey) {
      const key = cellKey(w, d, r, c);
      flushPendingMoveSave(key);
      const isImeCompositionKey =
        e.key === 'Process' ||
        e.keyCode === 229 ||
        e.nativeEvent?.isComposing ||
        (e.key.length === 1 && e.key.charCodeAt(0) > 127);
      if (isImeCompositionKey) {
        imeOpenRef.current = true;
        // Don't prevent default, but do start editing immediately so input is focused before composition really starts.
        // It might lose the first keystroke due to React asynchronous focus, but it ensures editing mode is active.
        beginEditingCell(key, '', false);
      } else {
        e.preventDefault();
        beginEditingCell(key, e.key, false);
      }
    }
  }, [
    contextMenu,
    clipboardSource,
    editingCell,
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
    toggleSameReservationGroup,
    applyPrescriptionShortcut,
    toggleSelectedGreenBackground,
    tryMergeSelection,
    doUndo,
    isEditableTarget,
    isContextMenuTarget,
    handleOpenPatientHistoryModal,
    handleOpenBodyPartMenu,
    handleOpenMemoMenu,
    flushPendingMoveSave,
    setEditingCell,
    setClipboardSource,
    setContextMenu,
    setRangeEnd,
    setSelectedKeys,
    handleReservationTimeShortcut,
    moveSelectedCellsByRow,
    onSelectionMoved,
    memos,
    getLatestSelectedCell,
    pendingRef,
    selectedCellRef,
  ]);
}
