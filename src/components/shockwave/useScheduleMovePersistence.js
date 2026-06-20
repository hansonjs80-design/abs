import { useCallback, useEffect, useRef } from 'react';

const MOVE_SAVE_IDLE_MS = 250;
const DEFAULT_MERGE_SPAN = { rowSpan: 1, colSpan: 1, mergedInto: null };

export default function useScheduleMovePersistence({
  addToast,
  applyCellDisplayRef,
  applyMergeSpanRef,
  cellKey,
  memosRef,
  pendingMergeSpansRef,
  pendingRef,
  saveBulkRef,
  editingCell,
  pendingMemoOverridesRef,
}) {
  const moveSaveStateRef = useRef({
    timer: null,
    payloadByKey: new Map(),
    rollbackMemos: [],
    requestId: 0,
    activePromise: Promise.resolve(),
    isFlushing: false,
    flushQueued: false,
  });
  const flushPendingMoveSaveRef = useRef(null);

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
    const overrides = pendingMemoOverridesRef?.current || {};
    Object.entries(overrides).forEach(([key, override]) => {
      const previousMemo = memos[key] || {};
      memos[key] = {
        ...previousMemo,
        content: override.content || '',
        bg_color: override.bg_color || null,
        merge_span: override.merge_span || DEFAULT_MERGE_SPAN,
        prescription: override.prescription || null,
        body_part: override.body_part || null,
      };
    });
    return memos;
  }, [memosRef, pendingMemoOverridesRef]);

  const flushPendingMoveSave = useCallback(() => {
    const state = moveSaveStateRef.current;
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }

    if (state.isFlushing) {
      state.flushQueued = true;
      return state.activePromise;
    }

    const payload = Array.from(state.payloadByKey.values());
    if (payload.length === 0) return Promise.resolve(true);

    const currentPayload = payload;
    const rollbackMemos = state.rollbackMemos || [];
    const requestId = state.requestId;

    state.payloadByKey = new Map();
    state.rollbackMemos = [];
    state.isFlushing = true;

    state.activePromise = state.activePromise.then(() => {
      return Promise.resolve(saveBulkRef.current?.(currentPayload, {
        deferStatsSync: true,
        source: 'keyboard-move',
        shouldApplyClientState: () => moveSaveStateRef.current.requestId === requestId,
      })).then((success) => {
        if (success) {
          // DB 저장 성공 시, 강제 캐시 삭제(clearCellDisplayRef)를 수행하지 않고 서버 데이터(memos)가
          // 최신화될 때까지 캐시를 안전하게 유지하여, 구 데이터 노출로 인한 잔상(Trail) 및 누락을 방지합니다.
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
    }).finally(() => {
      state.isFlushing = false;
      if (state.payloadByKey.size > 0 || state.flushQueued) {
        state.flushQueued = false;
        flushPendingMoveSaveRef.current?.();
      }
    });

    return state.activePromise;
  }, [
    addToast,
    applyCellDisplayRef,
    applyMergeSpanRef,
    applyPayloadToLatestRefs,
    saveBulkRef,
  ]);
  useEffect(() => {
    flushPendingMoveSaveRef.current = flushPendingMoveSave;
  }, [flushPendingMoveSave]);

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
