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

    state.payloadByKey = new Map();
    const rollbackMemos = state.rollbackMemos || [];
    const requestId = state.requestId;

    return Promise.resolve(saveBulkRef.current?.(payload)).then((success) => {
      if (success) {
        if (moveSaveStateRef.current.requestId === requestId && moveSaveStateRef.current.payloadByKey.size === 0) {
          // DB 저장 완료 후 pending display를 정리할 때,
          // 사용자가 직접 수정한 pending 값이 남아있는 셀은 건드리지 않음
          const latestPending = pendingDisplayValuesRef?.current || pendingRef.current || {};
          
          // 콜백 실행 시점에 최신 editingCell 값을 읽어옴 – 비동기 대기 동안에 사용자가 수정을 시작했을 수 있음
          const currentEditingCell = editingCellRef.current;
          const effectiveExcludeKey = excludeKey || currentEditingCell;

          const clearPayload = payload.filter((item) => {
            const key = getPayloadKey(item);
            // 1) 현재 편집 중인 셀은 무조건 제외
            if (key === effectiveExcludeKey) return false;
            // 2) payload의 content와 현재 pending 값이 다르면 사용자가 수정한 것 → 건드리지 않음
            if (key in latestPending) {
              const pendingVal = String(latestPending[key] ?? '');
              const payloadVal = String(item.content ?? '');
              if (pendingVal !== payloadVal) return false;
            }
            return true;
          });
          if (clearPayload.length > 0) {
            clearCellDisplayRef.current?.(clearPayload);
          }
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
    getPayloadKey,
    pendingDisplayValuesRef,
    pendingRef,
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
