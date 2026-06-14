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
  editingCell,
  pendingDisplayValuesRef,
}) {
  const moveSaveStateRef = useRef({
    timer: null,
    payloadByKey: new Map(),
    rollbackMemos: [],
    requestId: 0,
    activePromise: Promise.resolve(),
  });

  // editingCell을 ref로 추적 – setTimeout 콜백에서 항상 최신 값을 읽기 위함
  const editingCellRef = useRef(editingCell);
  useEffect(() => {
    editingCellRef.current = editingCell;
  }, [editingCell]);

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

  const getLatestMemosWithPendingMoves = useCallback(() => {
    const memos = { ...(memosRef.current || {}) };
    moveSaveStateRef.current.payloadByKey.forEach((item, key) => {
      const previousMemo = memos[key] || {};
      memos[key] = {
        ...previousMemo,
        content: item.content || '',
        bg_color: item.bg_color || null,
        merge_span: item.merge_span || DEFAULT_MERGE_SPAN,
        prescription: item.prescription || null,
        body_part: item.body_part || null,
      };
    });
    return memos;
  }, [memosRef]);

  const flushPendingMoveSave = useCallback((excludeKey) => {
    const state = moveSaveStateRef.current;
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }

    const payload = Array.from(state.payloadByKey.values());
    if (payload.length === 0) return Promise.resolve(true);

    const currentPayload = payload;
    const rollbackMemos = state.rollbackMemos || [];
    const requestId = state.requestId;

    state.payloadByKey = new Map();
    state.rollbackMemos = [];

    state.activePromise = state.activePromise.then(() => {
      return Promise.resolve(saveBulkRef.current?.(currentPayload)).then((success) => {
        if (success) {
          // DB 저장 완료 후 즉각적인 clearCellDisplay 호출을 생략하여,
          // memos state가 DB 상태를 반영할 때까지 pendingDisplayValues가 유지되도록 함
          // (useScheduleImmediateState.js의 memos 감시 useEffect에서 최종 정리됨)
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
    });

    return state.activePromise;
  }, [
    addToast,
    applyCellDisplayRef,
    applyMergeSpanRef,
    applyPayloadToLatestRefs,
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
    getLatestMemosWithPendingMoves,
  };
}
