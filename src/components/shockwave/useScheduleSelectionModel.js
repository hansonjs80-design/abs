import { useCallback } from 'react';

import {
  buildScheduleRangeKeys,
  computeScheduleSelectionInfo,
  getEffectiveScheduleMergeSpan,
  getScheduleCellKey,
  normalizeScheduleCellToMergeMaster,
  normalizeScheduleKeysToMergeMasters,
} from '../../lib/scheduleSelectionUtils.js';

export default function useScheduleSelectionModel({
  selectedCell,
  selectedKeys,
  memos,
  pendingMergeSpans = {},
}) {
  const cellKey = useCallback((w, d, r, c) => getScheduleCellKey(w, d, r, c), []);

  const computeSelectionInfo = useCallback(() => {
    return computeScheduleSelectionInfo({ selectedCell, selectedKeys, memos, pendingMergeSpans });
  }, [selectedCell, selectedKeys, memos, pendingMergeSpans]);

  const getEffectiveMergeSpan = useCallback((key, currentMemos) => {
    return getEffectiveScheduleMergeSpan({ key, memos, pendingMergeSpans, currentMemos });
  }, [memos, pendingMergeSpans]);

  const normalizeCellToMergeMaster = useCallback((cell) => {
    return normalizeScheduleCellToMergeMaster({ cell, memos, pendingMergeSpans });
  }, [memos, pendingMergeSpans]);

  const normalizeKeysToMergeMasters = useCallback((keys) => {
    return normalizeScheduleKeysToMergeMasters({ keys, memos, pendingMergeSpans });
  }, [memos, pendingMergeSpans]);

  const buildRangeKeys = useCallback((anchor, target) => {
    return buildScheduleRangeKeys(anchor, target);
  }, []);

  return {
    cellKey,
    computeSelectionInfo,
    getEffectiveMergeSpan,
    normalizeCellToMergeMaster,
    normalizeKeysToMergeMasters,
    buildRangeKeys,
  };
}
