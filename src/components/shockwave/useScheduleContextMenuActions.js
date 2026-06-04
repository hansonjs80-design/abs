import { useCallback, useEffect, useRef } from 'react';
import { buildManualTherapyUnmergePayload } from '../../lib/manualTherapyMergeUtils';
import { buildManualTherapyAutoMergePayload } from '../../lib/scheduleManualTherapyAutoMergeUtils';
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
  saveShockwaveMemosBulk,
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
  rowCount,
  pendingMergeSpans,
  applyImmediateCellDisplay,
  applyImmediateMergeSpan,
  clearImmediateCellDisplay,
}) {
  const saveDebounceRef = useRef({ timer: null, pending: new Map(), undoMemos: null });

  useEffect(() => {
    const saveDebounce = saveDebounceRef.current;
    return () => {
      if (saveDebounce.timer) {
        clearTimeout(saveDebounce.timer);
      }
    };
  }, []);

  return useCallback(async (action) => {
    const getContextKey = () => (
      contextMenu
        ? `${contextMenu.weekIdx}-${contextMenu.dayIdx}-${contextMenu.rowIdx}-${contextMenu.colIdx}`
        : null
    );
    const getMemoForAction = (key) => {
      const memo = memos[key] || {};
      if (key === getContextKey() && contextMenu?.memoSnapshot) {
        return { ...memo, ...contextMenu.memoSnapshot };
      }
      return memo;
    };
    const getStableMemoContent = (key, memo = {}) => {
      if (typeof pendingDisplayValues[key] === 'string') return pendingDisplayValues[key];
      if (typeof memo.content === 'string') return memo.content;
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
        const prevSnapshot = prev.memoSnapshot || memo || {};
        const nextSnapshot = {
          ...prevSnapshot,
          ...overrides,
        };
        const sameBodyPart = prevSnapshot.body_part === nextSnapshot.body_part;
        const sameMergeSpan = prevSnapshot.merge_span === nextSnapshot.merge_span;
        const sameContent = prevSnapshot.content === nextSnapshot.content;
        const samePrescription = prevSnapshot.prescription === nextSnapshot.prescription;
        if (sameBodyPart && sameMergeSpan && sameContent && samePrescription) return prev;
        return {
          ...prev,
          memoSnapshot: nextSnapshot,
        };
      });
    };
    const applyImmediateMeta = (key, memo = {}, overrides = {}) => {
      const [w, d, r, c] = key.split('-').map(Number);
      if (![w, d, r, c].every(Number.isFinite)) return;
      applyImmediateCellDisplay?.({
        year: currentYear,
        month: currentMonth,
        week_index: w,
        day_index: d,
        row_index: r,
        col_index: c,
        content: Object.prototype.hasOwnProperty.call(overrides, 'content') ? overrides.content : getStableMemoContent(key, memo),
        bg_color: Object.prototype.hasOwnProperty.call(overrides, 'bg_color') ? overrides.bg_color : (memo.bg_color ?? null),
        merge_span: Object.prototype.hasOwnProperty.call(overrides, 'merge_span') ? overrides.merge_span : memo.merge_span,
        prescription: Object.prototype.hasOwnProperty.call(overrides, 'prescription') ? overrides.prescription : (memo.prescription ?? null),
        body_part: Object.prototype.hasOwnProperty.call(overrides, 'body_part') ? overrides.body_part : (memo.body_part ?? null),
      }, { keepContextMenuOpen: Boolean(contextMenu) });
    };

    if (action === 'copy') handleCopySelection();
    else if (action === 'cut') handleCutSelection();
    else if (action === 'paste') handlePasteSelection();
    else if (action === 'complete-toggle') handleToggleTreatmentComplete();
    else if (action === 'cancel-toggle') handleToggleTreatmentCancel();
    else if (action === 'merge' || action === 'unmerge') tryMergeSelection();
    else if (action?.type === 'prescription') {
      const contextKey = getContextKey();
      const selectedKeyList = Array.from(selectedKeys || []);
      const keys = contextKey && !selectedKeyList.includes(contextKey)
        ? [contextKey]
        : selectedKeyList;
      let anyChanged = false;
      const payloadByKey = new Map();
      const affectedKeys = new Set(keys);
      const fallbackSaves = [];

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
          updateContextMemoSnapshot(key, memo, {
            content: updatedContent,
            prescription: prescriptionValue,
          });

          const manualTherapyMerge = buildManualTherapyAutoMergePayload({
            key,
            memos,
            pendingMergeSpans,
            currentYear,
            currentMonth,
            rowCount,
            content: updatedContent,
            bgColor: memo.bg_color || null,
            prescription: action.value,
            bodyPart: memo.body_part || null,
            mergeSpan: memo.merge_span,
          });

          if (manualTherapyMerge.ok) {
            const contextPayload = manualTherapyMerge.payload.find((item) => (
              `${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}` === key
            ));
            if (contextPayload) {
              updateContextMemoSnapshot(key, memo, {
                content: contextPayload.content,
                prescription: contextPayload.prescription || null,
                merge_span: contextPayload.merge_span || memo.merge_span,
                body_part: Object.prototype.hasOwnProperty.call(contextPayload, 'body_part')
                  ? contextPayload.body_part
                  : memo.body_part,
              });
            }
            manualTherapyMerge.payload.forEach((item) => {
              const itemKey = `${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`;
              payloadByKey.set(itemKey, item);
            });
            manualTherapyMerge.affectedKeys.forEach((itemKey) => affectedKeys.add(itemKey));
            anyChanged = true;
          } else {
            if (manualTherapyMerge.reason === 'not-manual-therapy') {
              const unmergePayload = buildManualTherapyUnmergePayload({
                key,
                memos,
                pendingMergeSpans,
                currentYear,
                currentMonth,
                content: updatedContent,
                bgColor: memo.bg_color || null,
                prescription: action.value,
                bodyPart: memo.body_part || null,
              });

              if (unmergePayload.ok) {
                const contextPayload = unmergePayload.payload.find((item) => (
                  `${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}` === key
                ));
                if (contextPayload) {
                  updateContextMemoSnapshot(key, memo, {
                    content: contextPayload.content,
                    prescription: contextPayload.prescription || null,
                    merge_span: contextPayload.merge_span || memo.merge_span,
                    body_part: Object.prototype.hasOwnProperty.call(contextPayload, 'body_part')
                      ? contextPayload.body_part
                      : memo.body_part,
                  });
                }
                unmergePayload.payload.forEach((item) => {
                  const itemKey = `${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`;
                  payloadByKey.set(itemKey, item);
                });
                unmergePayload.affectedKeys.forEach((itemKey) => affectedKeys.add(itemKey));
                anyChanged = true;
                continue;
              }
            }
            if (manualTherapyMerge.reason === 'occupied') {
              addToast('아래 셀이 비어있지 않아 자동 병합하지 않았습니다.', 'warning');
            } else if (manualTherapyMerge.reason === 'bounds') {
              addToast('아래 시간이 부족해 자동 병합하지 않았습니다.', 'warning');
            }
            const fallbackPayload = {
              year: currentYear,
              month: currentMonth,
              week_index: w,
              day_index: d,
              row_index: r,
              col_index: c,
              content: updatedContent,
              bg_color: memo.bg_color || null,
              merge_span: pendingMergeSpans?.[key] || memo.merge_span,
              prescription: action.value || null,
              body_part: memo.body_part || null,
            };
            applyImmediateCellDisplay?.(fallbackPayload, { keepContextMenuOpen: Boolean(contextMenu) });
            updateContextMemoSnapshot(key, memo, {
              content: updatedContent,
              merge_span: fallbackPayload.merge_span,
              prescription: action.value || null,
              body_part: memo.body_part || null,
            });
            fallbackSaves.push(onSaveMemo(currentYear, currentMonth, w, d, r, c, updatedContent, memo.bg_color, fallbackPayload.merge_span, action.value, memo.body_part));
          }
        }
      }

      const oldMemos = buildMemoSnapshotForKeys(Array.from(affectedKeys));

      if (payloadByKey.size > 0) {
        const payload = Array.from(payloadByKey.values());
        applyImmediateCellDisplay?.(payload, { keepContextMenuOpen: Boolean(contextMenu) });
        applyImmediateMergeSpan?.(payload);
        const success = await saveShockwaveMemosBulk(payload);
        if (success) {
          clearImmediateCellDisplay?.(payload);
        } else {
          addToast('처방 적용에 실패했습니다.', 'error');
          return;
        }
      }

      if (fallbackSaves.length > 0) {
        const results = await Promise.all(fallbackSaves);
        if (results.some(Boolean)) anyChanged = true;
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
      const computedResults = [];
      
      for (const key of keys) {
        const memo = getMemoForAction(key);
        const existing = (memo.body_part || '').trim();
        const newPart = formatBodyPartInput(action.value);
        if (!newPart) continue;
        const combined = existing ? `${existing}, ${newPart}` : newPart;
        const nextParts = splitBodyParts(combined);
        const nextOptions = getBodyPartOptionList(memo, nextParts);
        const nextMergeSpan = buildMergeSpanWithBodyPartOptions(memo.merge_span, nextOptions);
        computedResults.push({ key, memo, combined, nextOptions, nextMergeSpan });
        anyChanged = true;
      }

      if (anyChanged) {
        for (const { key, memo, combined, nextOptions, nextMergeSpan } of computedResults) {
          rememberBodyPartOptions(nextOptions);
          applyImmediateMeta(key, memo, { merge_span: nextMergeSpan, body_part: combined });
          updateContextMemoSnapshot(key, memo, { merge_span: nextMergeSpan, body_part: combined });
          saveDebounceRef.current.pending.set(key, {
            memo, overrides: { merge_span: nextMergeSpan, body_part: combined }
          });
        }
        
        if (saveDebounceRef.current.timer) clearTimeout(saveDebounceRef.current.timer);
        saveDebounceRef.current.timer = setTimeout(() => {
          const snapshot = saveDebounceRef.current;
          const pendingSaves = Array.from(snapshot.pending.entries());
          snapshot.pending.clear();
          snapshot.timer = null;
          Promise.all(pendingSaves.map(([k, { memo, overrides }]) => saveMemoMeta(k, memo, overrides)));
        }, 500);

        recordUndo({ type: 'bulk-edit', oldMemos });
      }
      return;
    }
    else if (action?.type === 'bodyPartRemove') {
      const keys = getContextTargetKeys();
      const oldMemos = buildMemoSnapshotForKeys(keys);
      let anyChanged = false;
      const computedResults = [];

      for (const key of keys) {
        const memo = getMemoForAction(key);
        const parts = (memo.body_part || '').split(',').map(p => p.trim()).filter(Boolean);
        const updated = parts.filter((_, i) => i !== action.index).join(', ');
        const nextOptions = getBodyPartOptionList(memo, splitBodyParts(updated));
        const nextMergeSpan = buildMergeSpanWithBodyPartOptions(memo.merge_span, nextOptions);
        computedResults.push({ key, memo, updated, nextOptions, nextMergeSpan });
        anyChanged = true;
      }

      if (anyChanged) {
        for (const { key, memo, updated, nextOptions, nextMergeSpan } of computedResults) {
          rememberBodyPartOptions(nextOptions);
          applyImmediateMeta(key, memo, { merge_span: nextMergeSpan, body_part: updated });
          updateContextMemoSnapshot(key, memo, { merge_span: nextMergeSpan, body_part: updated });
          saveDebounceRef.current.pending.set(key, {
            memo, overrides: { merge_span: nextMergeSpan, body_part: updated }
          });
        }

        if (saveDebounceRef.current.timer) clearTimeout(saveDebounceRef.current.timer);
        saveDebounceRef.current.timer = setTimeout(() => {
          const snapshot = saveDebounceRef.current;
          const pendingSaves = Array.from(snapshot.pending.entries());
          snapshot.pending.clear();
          snapshot.timer = null;
          Promise.all(pendingSaves.map(([k, { memo, overrides }]) => saveMemoMeta(k, memo, overrides)));
        }, 500);

        recordUndo({ type: 'bulk-edit', oldMemos });
      }
      return;
    }
    else if (action?.type === 'bodyPartDeleteValue') {
      const keys = getContextTargetKeys();
      const oldMemos = buildMemoSnapshotForKeys(keys);
      let anyChanged = false;
      const targetPart = action.value.trim();
      const computedResults = [];

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
        
        computedResults.push({ key, memo, updated, nextOptions, nextMergeSpan });
        anyChanged = true;
      }

      if (anyChanged) {
        for (const { key, memo, updated, nextOptions, nextMergeSpan } of computedResults) {
          setContextMenuBodyPartOptions?.((prev) => {
            const optionsMap = new Map();
            const targetKey = normalizeBodyPartKey(targetPart);
            (prev || []).forEach((part) => {
              if (normalizeBodyPartKey(part) !== targetKey) addBodyPartToMap(optionsMap, part);
            });
            nextOptions.forEach((part) => {
              if (normalizeBodyPartKey(part) !== targetKey) addBodyPartToMap(optionsMap, part);
            });
            return Array.from(optionsMap.values());
          });
          applyImmediateMeta(key, memo, { merge_span: nextMergeSpan, body_part: updated });
          updateContextMemoSnapshot(key, memo, { merge_span: nextMergeSpan, body_part: updated });
          saveDebounceRef.current.pending.set(key, {
            memo, overrides: { merge_span: nextMergeSpan, body_part: updated }
          });
        }

        if (saveDebounceRef.current.timer) clearTimeout(saveDebounceRef.current.timer);
        saveDebounceRef.current.timer = setTimeout(() => {
          const snapshot = saveDebounceRef.current;
          const pendingSaves = Array.from(snapshot.pending.entries());
          snapshot.pending.clear();
          snapshot.timer = null;
          Promise.all(pendingSaves.map(([k, { memo, overrides }]) => saveMemoMeta(k, memo, overrides)));
        }, 500);

        recordUndo({ type: 'bulk-edit', oldMemos });
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
      const targetPart = formatBodyPartInput(action.value);
      if (!targetPart) return;

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
      if (computedResults.length === 0) return;

      for (const { key, memo, updated, nextOptions, nextMergeSpan } of computedResults) {
        rememberBodyPartOptions(nextOptions);
        applyImmediateMeta(key, memo, { merge_span: nextMergeSpan, body_part: updated });
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
      const nextTime = normalizeReservationTimeValue(action.value);
      setContextMenuReservationInput(nextTime);
      if (contextMenu) {
        setContextMenu((prev) => prev ? { ...prev, savedReservationTime: nextTime } : prev);
      }
      let anyChanged = false;
      for (const key of keys) {
        const memo = getMemoForAction(key);
        const nextMergeSpan = buildMergeSpanWithReservationTime(memo.merge_span, nextTime);
        const currentTime = getReservationTimeFromMergeSpan(memo.merge_span);
        if (currentTime === getReservationTimeFromMergeSpan(nextMergeSpan)) continue;
        updateContextMemoSnapshot(key, memo, { merge_span: nextMergeSpan });
        saveDebounceRef.current.pending.set(key, { memo, overrides: { merge_span: nextMergeSpan } });
        anyChanged = true;
      }
      if (anyChanged) {
        if (!saveDebounceRef.current.undoMemos) {
          saveDebounceRef.current.undoMemos = oldMemos;
        }
        if (saveDebounceRef.current.timer) clearTimeout(saveDebounceRef.current.timer);
        saveDebounceRef.current.timer = setTimeout(() => {
          const snapshot = saveDebounceRef.current;
          const pendingSaves = Array.from(snapshot.pending.entries());
          const undoMemos = snapshot.undoMemos;
          snapshot.pending.clear();
          snapshot.undoMemos = null;
          snapshot.timer = null;

          Promise.all(
            pendingSaves.map(([k, { memo, overrides }]) => saveMemoMeta(k, memo, overrides))
          ).then((saveResults) => {
            if (saveResults.some(Boolean) && undoMemos) {
              recordUndo({ type: 'bulk-edit', oldMemos: undoMemos });
            }
          });
        }, 500);
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
        const overrides = { content: updatedContent };
        applyImmediateMeta(key, memo, overrides);
        updateContextMemoSnapshot(key, memo, overrides);
        saveDebounceRef.current.pending.set(key, { memo, overrides });
        anyChanged = true;
      }
      if (anyChanged) {
        if (!saveDebounceRef.current.undoMemos) {
          saveDebounceRef.current.undoMemos = oldMemos;
        }
        if (saveDebounceRef.current.timer) clearTimeout(saveDebounceRef.current.timer);
        saveDebounceRef.current.timer = setTimeout(() => {
          const snapshot = saveDebounceRef.current;
          const pendingSaves = Array.from(snapshot.pending.entries());
          const undoMemos = snapshot.undoMemos;
          snapshot.pending.clear();
          snapshot.undoMemos = null;
          snapshot.timer = null;

          Promise.all(
            pendingSaves.map(([k, { memo, overrides }]) => saveMemoMeta(k, memo, overrides))
          ).then((saveResults) => {
            if (saveResults.some(Boolean) && undoMemos) {
              recordUndo({ type: 'bulk-edit', oldMemos: undoMemos });
            }
          });
        }, 350);
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
    saveShockwaveMemosBulk,
    rowCount,
    pendingMergeSpans,
    applyImmediateCellDisplay,
    applyImmediateMergeSpan,
    clearImmediateCellDisplay,
  ]);
}
