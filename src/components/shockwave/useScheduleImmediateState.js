import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { removeDeletedScheduleDraft } from '../../lib/schedulerUtils.js';

function getUpdateKey(item) {
  if (!item) return '';
  return item.key || `${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`;
}

function normalizeUpdateEntries(updates) {
  return (Array.isArray(updates) ? updates : [updates]).filter(Boolean);
}

function isValidKey(key) {
  return Boolean(key && !key.includes('undefined'));
}

function getExpectedUpdateMap(updates) {
  const expectedByKey = new Map();
  normalizeUpdateEntries(updates).forEach((item) => {
    const key = getUpdateKey(item);
    if (isValidKey(key)) expectedByKey.set(key, item);
  });
  return expectedByKey;
}

function normalizeNullable(value) {
  if (value === undefined || value === null || String(value).replace(/\u200B/g, '').trim() === '') {
    return null;
  }
  if (typeof value === 'string') {
    const s = String(value).replace(/\u200B/g, '').trim();
    if (s.startsWith('#')) {
      return s.toLowerCase();
    }
    return s;
  }
  return value;
}

function normalizeMergeSpanForCompare(mergeSpan) {
  if (!mergeSpan) return null;
  const next = { ...mergeSpan };
  if (next.meta) {
    const meta = { ...next.meta };
    delete meta.intentional_clear;

    Object.keys(meta).forEach(key => {
      const val = meta[key];
      const isEmptyArray = Array.isArray(val) && val.length === 0;
      const isEmptyValue = val === undefined || val === null || val === '';
      if (isEmptyArray || isEmptyValue) {
        delete meta[key];
      }
    });

    if (Object.keys(meta).length > 0) next.meta = meta;
    else delete next.meta;
  }
  return next;
}

function mergeSpanEquals(left, right) {
  if (isDefaultMergeSpan(left) && isDefaultMergeSpan(right)) {
    return true;
  }
  return JSON.stringify(normalizeMergeSpanForCompare(left)) === JSON.stringify(normalizeMergeSpanForCompare(right));
}

function normalizeContentForCompare(val) {
  return String(val ?? '').trim().replace(/\u200B/g, '');
}

function expectedMemoOverrideMatches(current, expectedItem) {
  if (!current || !expectedItem) return false;
  if (normalizeContentForCompare(current.content) !== normalizeContentForCompare(expectedItem.content)) return false;

  if (
    Object.prototype.hasOwnProperty.call(expectedItem, 'bg_color') &&
    normalizeNullable(current.bg_color) !== normalizeNullable(expectedItem.bg_color)
  ) {
    return false;
  }

  const expectedMergeSpan = expectedItem.merge_span || expectedItem.mergeSpan;
  if (
    expectedMergeSpan &&
    !mergeSpanEquals(current.merge_span, expectedMergeSpan)
  ) {
    return false;
  }

  if (
    Object.prototype.hasOwnProperty.call(expectedItem, 'prescription') &&
    normalizeNullable(current.prescription) !== normalizeNullable(expectedItem.prescription)
  ) {
    return false;
  }

  if (
    Object.prototype.hasOwnProperty.call(expectedItem, 'body_part') &&
    normalizeNullable(current.body_part) !== normalizeNullable(expectedItem.body_part)
  ) {
    return false;
  }

  return true;
}

function isDefaultMergeSpan(mergeSpan) {
  const span = normalizeMergeSpanForCompare(mergeSpan);
  if (!span) return true;
  return (span.rowSpan || 1) === 1 && (span.colSpan || 1) === 1 && !span.mergedInto && !span.meta;
}

function isBlankExpectedItem(item) {
  if (!item) return false;
  const mergeSpan = item.merge_span || item.mergeSpan;
  return String(item.content ?? '') === '' &&
    (!Object.prototype.hasOwnProperty.call(item, 'bg_color') || normalizeNullable(item.bg_color) == null) &&
    (!Object.prototype.hasOwnProperty.call(item, 'prescription') || normalizeNullable(item.prescription) == null) &&
    (!Object.prototype.hasOwnProperty.call(item, 'body_part') || normalizeNullable(item.body_part) == null) &&
    isDefaultMergeSpan(mergeSpan);
}

function memoMatchesExpectedItem(memo, expectedItem, hasMemo = true) {
  if (!expectedItem) return false;
  if (!hasMemo) return isBlankExpectedItem(expectedItem);
  if (normalizeContentForCompare(memo?.content) !== normalizeContentForCompare(expectedItem.content)) return false;

  if (
    Object.prototype.hasOwnProperty.call(expectedItem, 'bg_color') &&
    normalizeNullable(memo?.bg_color) !== normalizeNullable(expectedItem.bg_color)
  ) {
    return false;
  }

  const expectedMergeSpan = expectedItem.merge_span || expectedItem.mergeSpan;
  if (expectedMergeSpan && !mergeSpanEquals(memo?.merge_span, expectedMergeSpan)) {
    return false;
  }

  if (
    Object.prototype.hasOwnProperty.call(expectedItem, 'prescription') &&
    normalizeNullable(memo?.prescription) !== normalizeNullable(expectedItem.prescription)
  ) {
    return false;
  }

  if (
    Object.prototype.hasOwnProperty.call(expectedItem, 'body_part') &&
    normalizeNullable(memo?.body_part) !== normalizeNullable(expectedItem.body_part)
  ) {
    return false;
  }

  return true;
}

export default function useScheduleImmediateState({ memos, setContextMenu, setEditingCell, currentYear, currentMonth }) {
  const [pendingDisplayValues, setPendingDisplayValues] = useState({});
  const [pendingMergeSpans, setPendingMergeSpans] = useState({});
  const [pendingMemoOverrides, setPendingMemoOverrides] = useState({});
  const [pendingCellBgColors, setPendingCellBgColors] = useState({});

  const pendingDisplayValuesRef = useRef({});
  const pendingMergeSpansRef = useRef({});
  const pendingMemoOverridesRef = useRef({});
  const pendingCellBgColorsRef = useRef({});

  useEffect(() => {
    flushSync(() => {
      setPendingCellBgColors((prev) => {
        let changed = false;
        const next = { ...prev };
        Object.entries(prev).forEach(([key, bgColor]) => {
          if (normalizeNullable(memos[key]?.bg_color) === normalizeNullable(bgColor)) {
            delete next[key];
            changed = true;
          }
        });
        if (changed) {
          pendingCellBgColorsRef.current = next;
          return next;
        }
        return prev;
      });

      setPendingDisplayValues((prev) => {
        let changed = false;
        const next = { ...prev };
        Object.entries(prev).forEach(([key, value]) => {
          const hasMemo = Object.prototype.hasOwnProperty.call(memos || {}, key);
          const memoContent = normalizeContentForCompare(memos?.[key]?.content);
          const pendingContent = normalizeContentForCompare(value);
          if (hasMemo ? memoContent !== pendingContent : pendingContent !== '') return;
          delete next[key];
          changed = true;
        });
        if (changed) {
          pendingDisplayValuesRef.current = next;
          return next;
        }
        return prev;
      });

      setPendingMergeSpans((prev) => {
        let changed = false;
        const next = { ...prev };
        Object.entries(prev).forEach(([key, mergeSpan]) => {
          const memoMergeSpan = memos?.[key]?.merge_span;
          const isMatch = mergeSpanEquals(memoMergeSpan, mergeSpan) ||
            (isDefaultMergeSpan(memoMergeSpan) && isDefaultMergeSpan(mergeSpan));
          if (!isMatch) return;
          delete next[key];
          changed = true;
        });
        if (changed) {
          pendingMergeSpansRef.current = next;
          return next;
        }
        return prev;
      });

      setPendingMemoOverrides((prev) => {
        let changed = false;
        const next = { ...prev };
        Object.entries(prev).forEach(([key, override]) => {
          const hasMemo = Object.prototype.hasOwnProperty.call(memos || {}, key);
          if (!memoMatchesExpectedItem(memos?.[key], override, hasMemo)) return;
          delete next[key];
          changed = true;
        });
        if (changed) {
          pendingMemoOverridesRef.current = next;
          return next;
        }
        return prev;
      });
    });
  }, [memos]);

  const applyImmediateCellDisplay = useCallback((updates, options = {}) => {
    const { keepContextMenuOpen = false } = options;
    const entries = normalizeUpdateEntries(updates);
    const nextValues = {};
    entries.forEach((item) => {
      if (item.year && item.month && (item.year !== currentYear || item.month !== currentMonth)) {
        return;
      }
      const key = getUpdateKey(item);
      if (isValidKey(key)) nextValues[key] = String(item.content ?? '');
    });
    if (Object.keys(nextValues).length === 0) return;

    pendingDisplayValuesRef.current = { ...pendingDisplayValuesRef.current, ...nextValues };
    
    const nextOverrides = { ...pendingMemoOverridesRef.current };
    entries.forEach((item) => {
      if (item.year && item.month && (item.year !== currentYear || item.month !== currentMonth)) {
        return;
      }
      const key = getUpdateKey(item);
      if (!isValidKey(key)) return;
      if (String(item.content ?? '').trim()) {
        removeDeletedScheduleDraft(item.year ?? currentYear, item.month ?? currentMonth, key);
      }
      const override = { ...nextOverrides[key], content: String(item.content ?? '') };
      if (Object.prototype.hasOwnProperty.call(item, 'bg_color')) override.bg_color = item.bg_color ?? null;
      if (item.merge_span || item.mergeSpan) override.merge_span = item.merge_span || item.mergeSpan;
      if (Object.prototype.hasOwnProperty.call(item, 'prescription')) override.prescription = item.prescription ?? null;
      if (Object.prototype.hasOwnProperty.call(item, 'body_part')) override.body_part = item.body_part ?? null;
      nextOverrides[key] = override;
    });
    pendingMemoOverridesRef.current = nextOverrides;

    flushSync(() => {
      setPendingDisplayValues((prev) => ({ ...prev, ...nextValues }));
      setPendingMemoOverrides((prev) => {
        const next = { ...prev };
        entries.forEach((item) => {
          if (item.year && item.month && (item.year !== currentYear || item.month !== currentMonth)) {
            return;
          }
          const key = getUpdateKey(item);
          if (!isValidKey(key)) return;
          const override = { ...next[key], content: String(item.content ?? '') };
          if (Object.prototype.hasOwnProperty.call(item, 'bg_color')) override.bg_color = item.bg_color ?? null;
          if (item.merge_span || item.mergeSpan) override.merge_span = item.merge_span || item.mergeSpan;
          if (Object.prototype.hasOwnProperty.call(item, 'prescription')) override.prescription = item.prescription ?? null;
          if (Object.prototype.hasOwnProperty.call(item, 'body_part')) override.body_part = item.body_part ?? null;
          next[key] = override;
        });
        return next;
      });
      setEditingCell(null);
      if (!keepContextMenuOpen) setContextMenu(null);
    });
  }, [setContextMenu, setEditingCell, currentYear, currentMonth]);

  const applyImmediateMergeSpan = useCallback((updates) => {
    const nextSpans = {};
    normalizeUpdateEntries(updates).forEach((item) => {
      if (item.year && item.month && (item.year !== currentYear || item.month !== currentMonth)) {
        return;
      }
      const key = getUpdateKey(item);
      const mergeSpan = item.mergeSpan || item.merge_span;
      if (isValidKey(key) && mergeSpan) nextSpans[key] = mergeSpan;
    });
    if (Object.keys(nextSpans).length === 0) return;

    pendingMergeSpansRef.current = { ...pendingMergeSpansRef.current, ...nextSpans };

    flushSync(() => {
      setPendingMergeSpans((prev) => ({ ...prev, ...nextSpans }));
    });
  }, [currentYear, currentMonth]);

  const applyImmediateCellBg = useCallback((updates, options = {}) => {
    const { keepContextMenuOpen = false } = options;
    const nextBgColors = {};
    normalizeUpdateEntries(updates).forEach((item) => {
      if (item.year && item.month && (item.year !== currentYear || item.month !== currentMonth)) {
        return;
      }
      const key = getUpdateKey(item);
      if (isValidKey(key)) nextBgColors[key] = item.bg_color || null;
    });
    if (Object.keys(nextBgColors).length === 0) return;

    pendingCellBgColorsRef.current = { ...pendingCellBgColorsRef.current, ...nextBgColors };

    flushSync(() => {
      setPendingCellBgColors((prev) => ({ ...prev, ...nextBgColors }));
      if (!keepContextMenuOpen) setContextMenu(null);
    });
  }, [setContextMenu, currentYear, currentMonth]);

  const clearImmediateCellBg = useCallback((updates) => {
    const entries = normalizeUpdateEntries(updates);
    
    const nextBg = { ...pendingCellBgColorsRef.current };
    let changed = false;
    entries.forEach((item) => {
      const key = getUpdateKey(item);
      if (!isValidKey(key)) return;
      const expectedBgColor = item?.bg_color || null;
      if (key in nextBg && normalizeNullable(nextBg[key]) === normalizeNullable(expectedBgColor)) {
        delete nextBg[key];
        changed = true;
      }
    });
    if (changed) {
      pendingCellBgColorsRef.current = nextBg;
    }

    setPendingCellBgColors((prev) => {
      let changed = false;
      const next = { ...prev };
      entries.forEach((item) => {
        const key = getUpdateKey(item);
        if (!isValidKey(key)) return;
        const expectedBgColor = item?.bg_color || null;
        if (key in next && normalizeNullable(next[key]) === normalizeNullable(expectedBgColor)) {
          delete next[key];
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, []);

  const clearImmediateCellDisplay = useCallback((updates, options = {}) => {
    const { force = false } = options;
    const expectedByKey = getExpectedUpdateMap(updates);
    const keys = Array.from(expectedByKey.keys());
    if (keys.length === 0) return;

    const nextDisplay = { ...pendingDisplayValuesRef.current };
    const nextMerge = { ...pendingMergeSpansRef.current };
    const nextOverrides = { ...pendingMemoOverridesRef.current };

    keys.forEach((key) => {
      const expectedItem = expectedByKey.get(key);
      const hasMemo = Object.prototype.hasOwnProperty.call(memos || {}, key);
      if (!force && !memoMatchesExpectedItem(memos?.[key], expectedItem, hasMemo)) return;

      const expectedContent = normalizeContentForCompare(expectedItem?.content);
      if (key in nextDisplay && normalizeContentForCompare(nextDisplay[key]) === expectedContent) {
        delete nextDisplay[key];
      }

      const expectedMergeSpan = expectedItem?.merge_span || expectedItem?.mergeSpan;
      if (key in nextMerge && expectedMergeSpan) {
        const isMatch = mergeSpanEquals(nextMerge[key], expectedMergeSpan) ||
          (isDefaultMergeSpan(nextMerge[key]) && isDefaultMergeSpan(expectedMergeSpan));
        if (isMatch) {
          delete nextMerge[key];
        }
      }

      if (key in nextOverrides && (force || expectedMemoOverrideMatches(nextOverrides[key], expectedItem))) {
        delete nextOverrides[key];
      }
    });

    pendingDisplayValuesRef.current = nextDisplay;
    pendingMergeSpansRef.current = nextMerge;
    pendingMemoOverridesRef.current = nextOverrides;

    flushSync(() => {
      setPendingDisplayValues((prev) => {
        let changed = false;
        const next = { ...prev };
        keys.forEach((key) => {
          const expectedItem = expectedByKey.get(key);
          const hasMemo = Object.prototype.hasOwnProperty.call(memos || {}, key);
          if (!force && !memoMatchesExpectedItem(memos?.[key], expectedItem, hasMemo)) return;
          const expectedContent = normalizeContentForCompare(expectedItem?.content);
          if (key in next && normalizeContentForCompare(next[key]) === expectedContent) {
            delete next[key];
            changed = true;
          }
        });
        return changed ? next : prev;
      });

      setPendingMergeSpans((prev) => {
        let changed = false;
        const next = { ...prev };
        keys.forEach((key) => {
          const expectedItem = expectedByKey.get(key);
          const hasMemo = Object.prototype.hasOwnProperty.call(memos || {}, key);
          if (!force && !memoMatchesExpectedItem(memos?.[key], expectedItem, hasMemo)) return;
          const expectedMergeSpan = expectedItem?.merge_span || expectedItem?.mergeSpan;
          if (key in next && expectedMergeSpan) {
            const isMatch = mergeSpanEquals(next[key], expectedMergeSpan) ||
              (isDefaultMergeSpan(next[key]) && isDefaultMergeSpan(expectedMergeSpan));
            if (isMatch) {
              delete next[key];
              changed = true;
            }
          }
        });
        return changed ? next : prev;
      });

      setPendingMemoOverrides((prev) => {
        let changed = false;
        const next = { ...prev };
        keys.forEach((key) => {
          const expectedItem = expectedByKey.get(key);
          const hasMemo = Object.prototype.hasOwnProperty.call(memos || {}, key);
          if (!force && !memoMatchesExpectedItem(memos?.[key], expectedItem, hasMemo)) return;
          if (key in next && (force || expectedMemoOverrideMatches(next[key], expectedItem))) {
            delete next[key];
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    });
  }, [memos]);

  return {
    pendingCellBgColors,
    pendingDisplayValues,
    pendingMemoOverrides,
    pendingMergeSpans,
    pendingDisplayValuesRef,
    pendingMergeSpansRef,
    pendingMemoOverridesRef,
    pendingCellBgColorsRef,
    setPendingDisplayValues,
    applyImmediateCellBg,
    applyImmediateCellDisplay,
    applyImmediateMergeSpan,
    clearImmediateCellBg,
    clearImmediateCellDisplay,
  };
}
