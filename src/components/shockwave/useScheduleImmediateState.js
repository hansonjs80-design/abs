import { useCallback, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';

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
  return value ?? null;
}

function normalizeMergeSpanForCompare(mergeSpan) {
  if (!mergeSpan) return null;
  const next = { ...mergeSpan };
  if (next.meta) {
    const meta = { ...next.meta };
    delete meta.intentional_clear;
    if (Object.keys(meta).length > 0) next.meta = meta;
    else delete next.meta;
  }
  return next;
}

function mergeSpanEquals(left, right) {
  return JSON.stringify(normalizeMergeSpanForCompare(left)) === JSON.stringify(normalizeMergeSpanForCompare(right));
}

function expectedMemoOverrideMatches(current, expectedItem) {
  if (!current || !expectedItem) return false;
  if (String(current.content ?? '') !== String(expectedItem.content ?? '')) return false;

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
    (!Object.prototype.hasOwnProperty.call(item, 'bg_color') || item.bg_color == null) &&
    (!Object.prototype.hasOwnProperty.call(item, 'prescription') || item.prescription == null) &&
    (!Object.prototype.hasOwnProperty.call(item, 'body_part') || item.body_part == null) &&
    isDefaultMergeSpan(mergeSpan);
}

function memoMatchesExpectedItem(memo, expectedItem, hasMemo = true) {
  if (!expectedItem) return false;
  if (!hasMemo) return isBlankExpectedItem(expectedItem);
  if (String(memo?.content ?? '') !== String(expectedItem.content ?? '')) return false;

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

  useEffect(() => {
    setPendingCellBgColors((prev) => {
      let changed = false;
      const next = { ...prev };
      Object.entries(prev).forEach(([key, bgColor]) => {
        if ((memos[key]?.bg_color || null) === (bgColor || null)) {
          delete next[key];
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [memos]);

  useEffect(() => {
    setPendingDisplayValues((prev) => {
      let changed = false;
      const next = { ...prev };
      Object.entries(prev).forEach(([key, value]) => {
        const hasMemo = Object.prototype.hasOwnProperty.call(memos || {}, key);
        const memoContent = String(memos?.[key]?.content ?? '');
        const pendingContent = String(value ?? '');
        if (hasMemo ? memoContent !== pendingContent : pendingContent !== '') return;
        delete next[key];
        changed = true;
      });
      return changed ? next : prev;
    });

    setPendingMergeSpans((prev) => {
      let changed = false;
      const next = { ...prev };
      Object.entries(prev).forEach(([key, mergeSpan]) => {
        if (!mergeSpanEquals(memos?.[key]?.merge_span, mergeSpan)) return;
        delete next[key];
        changed = true;
      });
      return changed ? next : prev;
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
      return changed ? next : prev;
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

    flushSync(() => {
      setPendingCellBgColors((prev) => ({ ...prev, ...nextBgColors }));
      if (!keepContextMenuOpen) setContextMenu(null);
    });
  }, [setContextMenu, currentYear, currentMonth]);

  const clearImmediateCellBg = useCallback((updates) => {
    const entries = normalizeUpdateEntries(updates);
    setPendingCellBgColors((prev) => {
      let changed = false;
      const next = { ...prev };
      entries.forEach((item) => {
        const key = getUpdateKey(item);
        if (!isValidKey(key)) return;
        const expectedBgColor = item?.bg_color || null;
        if (key in next && (next[key] || null) === expectedBgColor) {
          delete next[key];
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, []);

  const clearImmediateCellDisplay = useCallback((updates) => {
    const expectedByKey = getExpectedUpdateMap(updates);
    const keys = Array.from(expectedByKey.keys());
    if (keys.length === 0) return;

    setTimeout(() => {
      setPendingDisplayValues((prev) => {
        let changed = false;
        const next = { ...prev };
        keys.forEach((key) => {
          const expectedItem = expectedByKey.get(key);
          const hasMemo = Object.prototype.hasOwnProperty.call(memos || {}, key);
          if (!memoMatchesExpectedItem(memos?.[key], expectedItem, hasMemo)) return;
          const expectedContent = String(expectedItem?.content ?? '');
          if (key in next && String(next[key] ?? '') === expectedContent) {
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
          if (!memoMatchesExpectedItem(memos?.[key], expectedItem, hasMemo)) return;
          const expectedMergeSpan = expectedItem?.merge_span || expectedItem?.mergeSpan;
          if (key in next && expectedMergeSpan && mergeSpanEquals(next[key], expectedMergeSpan)) {
            delete next[key];
            changed = true;
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
          if (!memoMatchesExpectedItem(memos?.[key], expectedItem, hasMemo)) return;
          if (key in next && expectedMemoOverrideMatches(next[key], expectedItem)) {
            delete next[key];
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    }, 0);
  }, [memos]);

  return {
    pendingCellBgColors,
    pendingDisplayValues,
    pendingMemoOverrides,
    pendingMergeSpans,
    setPendingDisplayValues,
    applyImmediateCellBg,
    applyImmediateCellDisplay,
    applyImmediateMergeSpan,
    clearImmediateCellBg,
    clearImmediateCellDisplay,
  };
}
