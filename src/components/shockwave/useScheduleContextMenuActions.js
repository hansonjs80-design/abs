import { useCallback, useRef } from 'react';
import { has4060Pattern, normalize4060StarOrder, strip4060FromContent } from '../../lib/schedulerContentFormat';
import {
  addBodyPartToMap,
  applyVisitCountToSchedulerContent,
  buildMergeSpanWithBodyPartOptions,
  buildMergeSpanWithMemoList,
  buildMergeSpanWithReservationTime,
  formatBodyPartInput,
  getBodyPartOptionsFromMergeSpan,
  getMemoListFromMergeSpan,
  getReservationTimeFromMergeSpan,
  normalizeBodyPartKey,
  normalizeReservationTimeValue,
  normalizeVisitInputValue,
  splitBodyParts,
} from '../../lib/schedulerUtils';

export default function useScheduleContextMenuActions({
  selectedKeys,
  contextMenu,
  memos,
  pendingDisplayValues,
  currentYear,
  currentMonth,
  onSaveMemo,
  addToast,
  handleCopySelection,
  handleCutSelection,
  handlePasteSelection,
  handleToggleTreatmentComplete,
  handleToggleTreatmentCancel,
  tryMergeSelection,
  buildMemoSnapshotForKeys,
  recordUndo,
  setContextMenu,
  setContextMenuBodyPartOptions,
  setContextMenuMemoDrafts,
  setContextMenuReservationInput,
  setContextMenuVisitInput,
  getDefaultReservationTime,
}) {
  const saveDebounceRef = useRef({ timer: null, pending: new Map(), undoMemos: null });
  return useCallback(async (action) => {
    const getContextKey = () => (
      contextMenu
        ? `${contextMenu.weekIdx}-${contextMenu.dayIdx}-${contextMenu.rowIdx}-${contextMenu.colIdx}`
        : null
    );
    const getMemoForAction = (key) => (
      memos[key] || (key === getContextKey() ? contextMenu?.memoSnapshot : null) || {}
    );
    const getStableMemoContent = (key, memo = {}) => {
      if (typeof memo.content === 'string') return memo.content;
      if (typeof pendingDisplayValues[key] === 'string') return pendingDisplayValues[key];
      if (key === getContextKey() && typeof contextMenu?.memoSnapshot?.content === 'string') {
        return contextMenu.memoSnapshot.content;
      }
      return '';
    };
    const getContextTargetKeys = () => (
      contextMenu
        ? [getContextKey()]
        : Array.from(selectedKeys || [])
    );
    const getBodyPartOptionList = (memo = {}, nextParts = []) => {
      const optionsMap = new Map();
      getBodyPartOptionsFromMergeSpan(memo.merge_span).forEach((part) => addBodyPartToMap(optionsMap, part));
      splitBodyParts(memo.body_part || '').forEach((part) => addBodyPartToMap(optionsMap, part));
      nextParts.forEach((part) => addBodyPartToMap(optionsMap, part));
      return Array.from(optionsMap.values());
    };
    const saveMemoMeta = (key, memo = {}, overrides = {}) => {
      const [w, d, r, c] = key.split('-').map(Number);
      const pick = (name, fallback) => (
        Object.prototype.hasOwnProperty.call(overrides, name) ? overrides[name] : fallback
      );
      return onSaveMemo(
        currentYear,
        currentMonth,
        w,
        d,
        r,
        c,
        pick('content', getStableMemoContent(key, memo)),
        pick('bg_color', memo.bg_color),
        pick('merge_span', memo.merge_span),
        pick('prescription', memo.prescription),
        pick('body_part', memo.body_part)
      );
    };
    const rememberBodyPartOptions = (parts = []) => {
      if (!setContextMenuBodyPartOptions) return;
      setContextMenuBodyPartOptions((prev) => {
        const optionsMap = new Map();
        (prev || []).forEach((part) => addBodyPartToMap(optionsMap, part));
        parts.forEach((part) => addBodyPartToMap(optionsMap, part));
        return Array.from(optionsMap.values());
      });
    };
    const updateContextMemoSnapshot = (key, memo = {}, overrides = {}) => {
      if (key !== getContextKey()) return;
      setContextMenu((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          memoSnapshot: {
            ...(prev.memoSnapshot || memo || {}),
            ...overrides,
          },
        };
      });
    };

    if (action === 'copy') handleCopySelection();
    else if (action === 'cut') handleCutSelection();
    else if (action === 'paste') handlePasteSelection();
    else if (action === 'complete-toggle') handleToggleTreatmentComplete();
    else if (action === 'cancel-toggle') handleToggleTreatmentCancel();
    else if (action === 'merge' || action === 'unmerge') tryMergeSelection();
    else if (action?.type === 'prescription') {
      const keys = Array.from(selectedKeys || []);
      const oldMemos = buildMemoSnapshotForKeys(keys);
      let anyChanged = false;

      for (const key of keys) {
        const [w, d, r, c] = key.split('-').map(Number);
        const memo = getMemoForAction(key);
        let updatedContent = getStableMemoContent(key, memo);
        const prescriptionValue = action.value || '';
        const doseNumber = prescriptionValue.match(/^(40|60)분$/)?.[1];

        if (doseNumber) {
          updatedContent = strip4060FromContent(updatedContent);
          const parenMatch = updatedContent.match(/^(.+?)(\(\d+\).*)$/);
          if (parenMatch) {
            updatedContent = `${parenMatch[1]}${doseNumber}${parenMatch[2]}`;
          } else if (updatedContent && !/\(\d+\)/.test(updatedContent)) {
            updatedContent = `${updatedContent}${doseNumber}`;
          }
          updatedContent = normalize4060StarOrder(updatedContent);
        } else if (action.value && has4060Pattern(updatedContent)) {
          updatedContent = strip4060FromContent(updatedContent);
        } else if (!action.value) {
          updatedContent = strip4060FromContent(updatedContent);
        }
        if (memo.prescription !== action.value || updatedContent !== getStableMemoContent(key, memo)) {
          const success = await onSaveMemo(currentYear, currentMonth, w, d, r, c, updatedContent, memo.bg_color, memo.merge_span, action.value);
          if (success) anyChanged = true;
        }
      }
      if (anyChanged) {
        recordUndo({ type: 'bulk-edit', oldMemos });
        addToast('처방이 적용되었습니다.', 'success');
      }
      return;
    }
    else if (action?.type === 'bodyPart') {
      const keys = getContextTargetKeys();
      const oldMemos = buildMemoSnapshotForKeys(keys);
      let anyChanged = false;

      for (const key of keys) {
        const memo = getMemoForAction(key);
        if (memo.body_part !== action.value) {
          const nextParts = splitBodyParts(action.value || '');
          const nextMergeSpan = buildMergeSpanWithBodyPartOptions(memo.merge_span, getBodyPartOptionList(memo, nextParts));
          const success = await saveMemoMeta(key, memo, { merge_span: nextMergeSpan, body_part: action.value });
          if (success) anyChanged = true;
        }
      }
      if (anyChanged) {
        recordUndo({ type: 'bulk-edit', oldMemos });
        addToast('부위가 적용되었습니다.', 'success');
      }
      return;
    }
    else if (action?.type === 'bodyPartAdd') {
      const keys = getContextTargetKeys();
      const oldMemos = buildMemoSnapshotForKeys(keys);
      let anyChanged = false;
      for (const key of keys) {
        const memo = getMemoForAction(key);
        const existing = (memo.body_part || '').trim();
        const newPart = formatBodyPartInput(action.value);
        if (!newPart) continue;
        const combined = existing ? `${existing}, ${newPart}` : newPart;
        const nextParts = splitBodyParts(combined);
        const nextMergeSpan = buildMergeSpanWithBodyPartOptions(memo.merge_span, getBodyPartOptionList(memo, nextParts));
        const success = await saveMemoMeta(key, memo, { merge_span: nextMergeSpan, body_part: combined });
        if (success) anyChanged = true;
      }
      if (anyChanged) {
        recordUndo({ type: 'bulk-edit', oldMemos });
        addToast('부위가 추가되었습니다.', 'success');
      }
      return;
    }
    else if (action?.type === 'bodyPartRemove') {
      const keys = getContextTargetKeys();
      const oldMemos = buildMemoSnapshotForKeys(keys);
      let anyChanged = false;
      for (const key of keys) {
        const memo = getMemoForAction(key);
        const parts = (memo.body_part || '').split(',').map(p => p.trim()).filter(Boolean);
        const updated = parts.filter((_, i) => i !== action.index).join(', ');
        const nextMergeSpan = buildMergeSpanWithBodyPartOptions(memo.merge_span, getBodyPartOptionList(memo, splitBodyParts(updated)));
        const success = await saveMemoMeta(key, memo, { merge_span: nextMergeSpan, body_part: updated });
        if (success) anyChanged = true;
      }
      if (anyChanged) {
        recordUndo({ type: 'bulk-edit', oldMemos });
        addToast('부위가 삭제되었습니다.', 'success');
      }
      return;
    }
    else if (action?.type === 'bodyPartDeleteValue') {
      const keys = getContextTargetKeys();
      const oldMemos = buildMemoSnapshotForKeys(keys);
      let anyChanged = false;
      const targetPart = action.value.trim();
      for (const key of keys) {
        const memo = getMemoForAction(key);
        const parts = (memo.body_part || '').split(',').map(p => p.trim()).filter(Boolean);
        const idx = parts.findIndex(p => normalizeBodyPartKey(p) === normalizeBodyPartKey(targetPart));
        if (idx >= 0) {
          parts.splice(idx, 1);
        }
        const updated = parts.join(', ');
        const targetKey = normalizeBodyPartKey(targetPart);
        const nextOptions = getBodyPartOptionList(memo, splitBodyParts(updated))
          .filter((part) => normalizeBodyPartKey(part) !== targetKey);
        const nextMergeSpan = buildMergeSpanWithBodyPartOptions(memo.merge_span, nextOptions);
        const success = await saveMemoMeta(key, memo, { merge_span: nextMergeSpan, body_part: updated });
        if (success) anyChanged = true;
      }
      if (anyChanged) {
        recordUndo({ type: 'bulk-edit', oldMemos });
        addToast('부위가 삭제되었습니다.', 'success');
      }
      return;
    }
    else if (action?.type === 'bodyPartEdit') {
      const keys = getContextTargetKeys();
      const oldMemos = buildMemoSnapshotForKeys(keys);
      let anyChanged = false;
      for (const key of keys) {
        const memo = getMemoForAction(key);
        const parts = (memo.body_part || '').split(',').map(p => p.trim()).filter(Boolean);
        parts[action.index] = formatBodyPartInput(action.value);
        const updated = parts.filter(Boolean).join(', ');
        const nextMergeSpan = buildMergeSpanWithBodyPartOptions(memo.merge_span, getBodyPartOptionList(memo, splitBodyParts(updated)));
        const success = await saveMemoMeta(key, memo, { merge_span: nextMergeSpan, body_part: updated });
        if (success) anyChanged = true;
      }
      if (anyChanged) {
        recordUndo({ type: 'bulk-edit', oldMemos });
        addToast('부위가 수정되었습니다.', 'success');
      }
      return;
    }
    else if (action?.type === 'bodyPartClear') {
      const keys = getContextTargetKeys();
      const oldMemos = buildMemoSnapshotForKeys(keys);
      let anyChanged = false;
      for (const key of keys) {
        const memo = getMemoForAction(key);
        const nextMergeSpan = buildMergeSpanWithBodyPartOptions(memo.merge_span, getBodyPartOptionList(memo));
        const success = await saveMemoMeta(key, memo, { merge_span: nextMergeSpan, body_part: '' });
        if (success) anyChanged = true;
      }
      if (anyChanged) {
        recordUndo({ type: 'bulk-edit', oldMemos });
        addToast('부위가 삭제되었습니다.', 'success');
      }
      return;
    }
    else if (action?.type === 'bodyPartToggle') {
      const keys = getContextTargetKeys();
      const oldMemos = buildMemoSnapshotForKeys(keys);
      const targetPart = action.value.trim();

      // 1회만 계산하여 UI + DB 모두에 사용할 결과를 미리 준비
      const computedResults = [];
      for (const key of keys) {
        const memo = getMemoForAction(key);
        const parts = (memo.body_part || '').split(',').map(p => p.trim()).filter(Boolean);
        const idx = parts.findIndex(p => normalizeBodyPartKey(p) === normalizeBodyPartKey(targetPart));
        if (idx >= 0) {
          parts.splice(idx, 1);
        } else {
          parts.push(targetPart);
        }
        const updated = parts.join(', ');
        const nextOptions = getBodyPartOptionList(memo, [targetPart, ...parts]);
        const nextMergeSpan = buildMergeSpanWithBodyPartOptions(memo.merge_span, nextOptions);
        computedResults.push({ key, memo, updated, nextOptions, nextMergeSpan });
      }

      // 즉시 UI 반영 (동기적)
      for (const { key, memo, updated, nextOptions, nextMergeSpan } of computedResults) {
        rememberBodyPartOptions(nextOptions);
        updateContextMemoSnapshot(key, memo, { merge_span: nextMergeSpan, body_part: updated });
        
        // 디바운스 대기열에 추가
        saveDebounceRef.current.pending.set(key, { memo, overrides: { merge_span: nextMergeSpan, body_part: updated } });
      }

      if (!saveDebounceRef.current.undoMemos) {
        saveDebounceRef.current.undoMemos = oldMemos;
      }

      if (saveDebounceRef.current.timer) {
        clearTimeout(saveDebounceRef.current.timer);
      }

      saveDebounceRef.current.timer = setTimeout(() => {
        const pendingSaves = Array.from(saveDebounceRef.current.pending.entries());
        const undoMemos = saveDebounceRef.current.undoMemos;
        
        saveDebounceRef.current.pending.clear();
        saveDebounceRef.current.undoMemos = null;
        saveDebounceRef.current.timer = null;

        Promise.all(
          pendingSaves.map(([key, { memo, overrides }]) =>
            saveMemoMeta(key, memo, overrides)
          )
        ).then(saveResults => {
          if (saveResults.some(Boolean) && undoMemos) {
            recordUndo({ type: 'bulk-edit', oldMemos: undoMemos });
          }
        });
      }, 500);

      return;
    }
    else if (action?.type === 'memoAdd') {
      const keys = getContextTargetKeys();
      const oldMemos = buildMemoSnapshotForKeys(keys);
      let anyChanged = false;
      const newMemo = String(action.value || '').trim();
      if (!newMemo) return;
      setContextMenuMemoDrafts((prev) => [...prev, newMemo]);
      for (const key of keys) {
        const memo = getMemoForAction(key);
        const memoList = getMemoListFromMergeSpan(memo.merge_span);
        const nextMemoList = [...memoList, newMemo];
        const nextMergeSpan = buildMergeSpanWithMemoList(memo.merge_span, nextMemoList);
        const success = await saveMemoMeta(key, memo, { merge_span: nextMergeSpan });
        if (success) anyChanged = true;
      }
      if (anyChanged) {
        recordUndo({ type: 'bulk-edit', oldMemos });
        addToast('메모가 추가되었습니다.', 'success');
      }
      return;
    }
    else if (action?.type === 'memoRemove') {
      const keys = getContextTargetKeys();
      const oldMemos = buildMemoSnapshotForKeys(keys);
      let anyChanged = false;
      setContextMenuMemoDrafts((prev) => prev.filter((_, index) => index !== action.index));
      for (const key of keys) {
        const memo = getMemoForAction(key);
        const memoList = getMemoListFromMergeSpan(memo.merge_span);
        const nextMemoList = memoList.filter((_, index) => index !== action.index);
        const nextMergeSpan = buildMergeSpanWithMemoList(memo.merge_span, nextMemoList);
        const success = await saveMemoMeta(key, memo, { merge_span: nextMergeSpan });
        if (success) anyChanged = true;
      }
      if (anyChanged) {
        recordUndo({ type: 'bulk-edit', oldMemos });
        addToast('메모가 삭제되었습니다.', 'success');
      }
      return;
    }
    else if (action?.type === 'memoUpdate') {
      const keys = getContextTargetKeys();
      const oldMemos = buildMemoSnapshotForKeys(keys);
      let anyChanged = false;
      const nextValue = String(action.value || '').trim();
      setContextMenuMemoDrafts((prev) => prev.map((item, index) => index === action.index ? nextValue : item).filter(Boolean));
      for (const key of keys) {
        const memo = getMemoForAction(key);
        const memoList = getMemoListFromMergeSpan(memo.merge_span);
        const nextMemoList = memoList.map((item, index) => index === action.index ? nextValue : item).filter(Boolean);
        const nextMergeSpan = buildMergeSpanWithMemoList(memo.merge_span, nextMemoList);
        const success = await saveMemoMeta(key, memo, { merge_span: nextMergeSpan });
        if (success) anyChanged = true;
      }
      if (anyChanged) {
        recordUndo({ type: 'bulk-edit', oldMemos });
        addToast('메모가 수정되었습니다.', 'success');
      }
      return;
    }
    else if (action?.type === 'reservationTime') {
      const keys = getContextTargetKeys();
      const oldMemos = buildMemoSnapshotForKeys(keys);
      let anyChanged = false;
      const nextTime = normalizeReservationTimeValue(action.value);
      setContextMenuReservationInput(nextTime);
      if (contextMenu) {
        setContextMenu((prev) => prev ? { ...prev, savedReservationTime: nextTime } : prev);
      }
      for (const key of keys) {
        const memo = getMemoForAction(key);
        const nextMergeSpan = buildMergeSpanWithReservationTime(memo.merge_span, nextTime);
        const currentTime = getReservationTimeFromMergeSpan(memo.merge_span);
        if (currentTime === getReservationTimeFromMergeSpan(nextMergeSpan)) continue;
        const success = await saveMemoMeta(key, memo, { merge_span: nextMergeSpan });
        if (success) anyChanged = true;
      }
      if (anyChanged) {
        recordUndo({ type: 'bulk-edit', oldMemos });
        addToast('예약 시간이 수정되었습니다.', 'success');
      }
      return;
    }
    else if (action?.type === 'reservationTimeReset') {
      const keys = getContextTargetKeys();
      const oldMemos = buildMemoSnapshotForKeys(keys);
      let anyChanged = false;
      const defaultTime = contextMenu?.defaultReservationTime || (contextMenu ? getDefaultReservationTime(contextMenu.weekIdx, contextMenu.dayIdx, contextMenu.rowIdx) : '');
      setContextMenuReservationInput(defaultTime);
      for (const key of keys) {
        const memo = getMemoForAction(key);
        const currentTime = getReservationTimeFromMergeSpan(memo.merge_span);
        if (!currentTime) continue;
        const nextMergeSpan = buildMergeSpanWithReservationTime(memo.merge_span, '');
        const success = await saveMemoMeta(key, memo, { merge_span: nextMergeSpan });
        if (success) anyChanged = true;
      }
      if (contextMenu) {
        setContextMenu((prev) => prev ? { ...prev, savedReservationTime: '' } : prev);
      }
      if (anyChanged) {
        recordUndo({ type: 'bulk-edit', oldMemos });
        addToast('예약 시간이 기본 시간으로 복구되었습니다.', 'success');
      }
      return;
    }
    else if (action?.type === 'visitCount') {
      const keys = getContextTargetKeys();
      const oldMemos = buildMemoSnapshotForKeys(keys);
      let anyChanged = false;
      const nextVisitInput = normalizeVisitInputValue(action.value);
      setContextMenuVisitInput(nextVisitInput);
      for (const key of keys) {
        const memo = getMemoForAction(key);
        const stableContent = getStableMemoContent(key, memo);
        const updatedContent = applyVisitCountToSchedulerContent(stableContent, nextVisitInput);
        if (updatedContent === stableContent) continue;
        const success = await saveMemoMeta(key, memo, { content: updatedContent });
        if (success) anyChanged = true;
      }
      if (anyChanged) {
        recordUndo({ type: 'bulk-edit', oldMemos });
        addToast('회차가 수정되었습니다.', 'success');
      }
      return;
    }
    setContextMenu(null);
  }, [
    selectedKeys,
    contextMenu,
    memos,
    pendingDisplayValues,
    currentYear,
    currentMonth,
    onSaveMemo,
    addToast,
    handleCopySelection,
    handleCutSelection,
    handlePasteSelection,
    handleToggleTreatmentComplete,
    handleToggleTreatmentCancel,
    tryMergeSelection,
    buildMemoSnapshotForKeys,
    recordUndo,
    setContextMenu,
    setContextMenuBodyPartOptions,
    setContextMenuMemoDrafts,
    setContextMenuReservationInput,
    setContextMenuVisitInput,
    getDefaultReservationTime,
  ]);
}
