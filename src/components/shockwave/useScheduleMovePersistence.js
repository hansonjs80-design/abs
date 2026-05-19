import { useCallback, useEffect, useRef } from 'react';

const MOVE_SAVE_IDLE_MS = 220;
const DEFAULT_MERGE_SPAN = { rowSpan: 1, colSpan: 1, mergedInto: null };

export default function useScheduleMovePersistence({
  addToast,
  applyCellDisplayRef,
  applyMergeSpanRef,
  cellKey,
  clearCellDisplayRef,
  memosRef,
  pendingMergeSpansRef,
  pendingRef,
  saveBulkRef,
}) {
  const moveSaveStateRef = useRef({
    timer: null,
    payloadByKey: new Map(),
    rollbackMemos: [],
    requestId: 0,
  });

  useEffect(() => {
    const moveSaveState = moveSaveStateRef.current;
    return () => {
      if (moveSaveState?.timer) clearTimeout(moveSaveState.timer);
    };
  }, []);

  const getPayloadKey = useCallback((item) => cellKey(
    item.week_index,
    item.day_index,
    item.row_index,
    item.col_index
  ), [cellKey]);

  const applyPayloadToLatestRefs = useCallback((payload) => {
    const nextMemos = { ...(memosRef.current || {}) };
    const nextPendingDisplay = { ...(pendingRef.current || {}) };
    const nextPendingMergeSpans = { ...(pendingMergeSpansRef.current || {}) };

    payload.forEach((item) => {
      const key = getPayloadKey(item);
      const previousMemo = nextMemos[key] || {};
      const nextMergeSpan = item.merge_span || DEFAULT_MERGE_SPAN;
      const nextMemo = {
        ...previousMemo,
        content: item.content || '',
        bg_color: item.bg_color || null,
        merge_span: nextMergeSpan,
        prescription: item.prescription || null,
        body_part: item.body_part || null,
      };

      nextMemos[key] = nextMemo;
      nextPendingDisplay[key] = item.content || '';
      nextPendingMergeSpans[key] = nextMergeSpan;
    });

    memosRef.current = nextMemos;
    pendingRef.current = nextPendingDisplay;
    pendingMergeSpansRef.current = nextPendingMergeSpans;
  }, [getPayloadKey, memosRef, pendingMergeSpansRef, pendingRef]);

  const flushPendingMoveSave = useCallback(() => {
    const state = moveSaveStateRef.current;
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }

    const payload = Array.from(state.payloadByKey.values());
    if (payload.length === 0) return Promise.resolve(true);

    state.payloadByKey = new Map();
    const rollbackMemos = state.rollbackMemos || [];
    const requestId = state.requestId;

    return Promise.resolve(saveBulkRef.current?.(payload)).then((success) => {
      if (success) {
        if (moveSaveStateRef.current.requestId === requestId && moveSaveStateRef.current.payloadByKey.size === 0) {
          clearCellDisplayRef.current?.(payload);
        }
        return true;
      }

      if (moveSaveStateRef.current.requestId === requestId) {
        applyCellDisplayRef.current?.(rollbackMemos);
        applyMergeSpanRef.current?.(rollbackMemos);
        applyPayloadToLatestRefs(rollbackMemos);
        addToast('셀 이동 실패', 'error');
      }
      return false;
    });
  }, [
    addToast,
    applyCellDisplayRef,
    applyMergeSpanRef,
    applyPayloadToLatestRefs,
    clearCellDisplayRef,
    saveBulkRef,
  ]);

  const schedulePendingMoveSave = useCallback((payload, rollbackMemos) => {
    const state = moveSaveStateRef.current;
    if (state.timer) clearTimeout(state.timer);

    state.requestId += 1;
    payload.forEach((item) => {
      state.payloadByKey.set(getPayloadKey(item), item);
    });
    state.rollbackMemos = rollbackMemos || [];
    state.timer = setTimeout(() => {
      flushPendingMoveSave();
    }, MOVE_SAVE_IDLE_MS);
  }, [flushPendingMoveSave, getPayloadKey]);

  const invalidatePendingMoveSave = useCallback(() => {
    moveSaveStateRef.current.requestId += 1;
  }, []);

  return {
    applyPayloadToLatestRefs,
    flushPendingMoveSave,
    invalidatePendingMoveSave,
    schedulePendingMoveSave,
  };
}
