import { useEffect } from 'react';

import {
  getPendingDraftId,
  getShockwaveScheduleScrollKey,
  readDeletedScheduleDrafts,
  readPendingScheduleDrafts,
  removePendingScheduleDraft,
  removePendingScheduleDraftIfValue,
} from '../../lib/schedulerUtils';

export default function useSchedulePendingPersistence({
  currentMonth,
  currentYear,
  loadedMemosKey,
  memos,
  onSaveMemo,
  pendingDisplayValues,
  setPendingDisplayValues,
}) {
  // 중복 정리 방지: memos 변경에 따른 pendingDisplayValues 정리는 
  // 이미 useScheduleImmediateState.js의 flushSync 단일 훅에서 함께 동기적으로 처리되므로
  // 이곳의 중복 useEffect 호출은 불필요한 추가 비동기 리렌더링을 유발하여 깜빡임을 발생시킬 수 있으므로 비활성화합니다.
  /*
  useEffect(() => {
    setPendingDisplayValues((prev) => {
      const keys = Object.keys(prev);
      if (keys.length === 0) return prev;
      const keysToRemove = keys.filter((key) => {
        const pendingContent = prev[key];
        const memoContent = memos[key]?.content || '';
        return memoContent === pendingContent;
      });
      if (keysToRemove.length === 0) return prev;
      const next = { ...prev };
      keysToRemove.forEach((key) => delete next[key]);
      return next;
    });
  }, [memos, setPendingDisplayValues]);
  */

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (loadedMemosKey !== getShockwaveScheduleScrollKey(currentYear, currentMonth)) return;
    let cancelled = false;
    const drafts = readPendingScheduleDrafts();
    const deletedDrafts = readDeletedScheduleDrafts();
    const currentDrafts = Object.values(drafts).filter((draft) => (
      Number(draft?.year) === currentYear &&
      Number(draft?.month) === currentMonth &&
      draft?.key
    ));
    if (currentDrafts.length === 0) return;

    const nextPendingDisplay = {};
    const draftsToSave = [];

    currentDrafts.forEach((draft) => {
      const key = String(draft.key);
      const value = String(draft.value ?? '');
      const savedMemo = memos[key];
      const savedUpdatedAt = savedMemo?.updated_at ? Date.parse(savedMemo.updated_at) : 0;
      const draftUpdatedAt = Number(draft.updatedAt) || 0;
      const deletedDraft = deletedDrafts[getPendingDraftId(currentYear, currentMonth, key)];
      const deletedUpdatedAt = Number(deletedDraft?.updatedAt) || 0;

      if (draft.source !== 'failed-save') {
        removePendingScheduleDraft(currentYear, currentMonth, key);
        return;
      }

      if (deletedUpdatedAt >= draftUpdatedAt) {
        removePendingScheduleDraft(currentYear, currentMonth, key);
        return;
      }

      if (savedMemo && savedUpdatedAt > draftUpdatedAt && String(savedMemo.content || '') !== value) {
        removePendingScheduleDraft(currentYear, currentMonth, key);
        return;
      }

      if (String(savedMemo?.content || '') === value) {
        removePendingScheduleDraft(currentYear, currentMonth, key);
        return;
      }

      nextPendingDisplay[key] = value;
      draftsToSave.push({ key, value });
    });

    if (Object.keys(nextPendingDisplay).length > 0) {
      setPendingDisplayValues((prev) => (cancelled ? prev : { ...prev, ...nextPendingDisplay }));
    }

    draftsToSave.forEach(({ key, value }) => {
      const [w, d, r, c] = key.split('-').map(Number);
      if (![w, d, r, c].every(Number.isFinite)) {
        removePendingScheduleDraft(currentYear, currentMonth, key);
        return;
      }

      Promise.resolve(onSaveMemo(currentYear, currentMonth, w, d, r, c, value))
        .then((success) => {
          if (cancelled) return;
          if (success) {
            removePendingScheduleDraftIfValue(currentYear, currentMonth, key, value);
            setPendingDisplayValues((prev) => {
              if (!(key in prev)) return prev;
              if (String(prev[key] ?? '') !== value) return prev;
              const next = { ...prev };
              delete next[key];
              return next;
            });
          }
        })
        .catch((error) => {
          console.error('Failed to restore pending schedule draft:', error);
        });
    });

    return () => {
      cancelled = true;
    };
  }, [currentYear, currentMonth, loadedMemosKey, memos, onSaveMemo, setPendingDisplayValues]);


}
