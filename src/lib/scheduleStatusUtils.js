export const TREATMENT_COMPLETE_BG = '#ffe599';
export const TREATMENT_CANCEL_BG = '#f4cccc';

export function getEffectiveCellBgColor(memos, pendingCellBgColors, key) {
  if (Object.prototype.hasOwnProperty.call(pendingCellBgColors || {}, key)) {
    return pendingCellBgColors[key];
  }
  return memos?.[key]?.bg_color || null;
}

export function buildTreatmentStatusPayload({
  mode,
  selectedKeys,
  memos,
  currentYear,
  currentMonth,
  normalizeKeysToMergeMasters,
  cellKey,
  pendingCellBgColors = {},
}) {
  if (!selectedKeys || selectedKeys.size === 0) return null;

  const effectiveKeys = normalizeKeysToMergeMasters(selectedKeys);
  const oldMemos = [];
  const payload = [];
  const touchedKeys = new Set();
  const statusBg = mode === 'cancel-toggle' ? TREATMENT_CANCEL_BG : TREATMENT_COMPLETE_BG;
  const getBgColor = (key) => getEffectiveCellBgColor(memos, pendingCellBgColors, key);
  const shouldClearSelection =
    mode === 'toggle'
      ? Array.from(effectiveKeys).some((key) => getBgColor(key) === TREATMENT_COMPLETE_BG)
      : mode === 'cancel-toggle'
        ? Array.from(effectiveKeys).some((key) => getBgColor(key) === TREATMENT_CANCEL_BG)
        : mode === 'clear';

  Array.from(effectiveKeys).forEach((key) => {
    const [w, d, r, c] = key.split('-').map(Number);
    const memo = memos[key];
    const content = memo?.content || '';

    if (!String(content).trim()) return;

    const masterSpan = memo?.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null };
    const rowSpan = Math.max(1, masterSpan.rowSpan || 1);
    const colSpan = Math.max(1, masterSpan.colSpan || 1);
    const nextBgColor = shouldClearSelection ? null : statusBg;

    if ((getBgColor(key) || null) === nextBgColor) return;

    for (let row = r; row < r + rowSpan; row += 1) {
      for (let col = c; col < c + colSpan; col += 1) {
        const rangeKey = cellKey(w, d, row, col);
        if (touchedKeys.has(rangeKey)) continue;
        touchedKeys.add(rangeKey);

        const rangeMemo = memos[rangeKey];
        const oldBgColor = getBgColor(rangeKey) || null;
        oldMemos.push({
          year: currentYear,
          month: currentMonth,
          week_index: w,
          day_index: d,
          row_index: row,
          col_index: col,
          content: rangeMemo?.content || '',
          bg_color: oldBgColor,
          merge_span: rangeMemo?.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null },
          prescription: rangeMemo?.prescription || null,
          body_part: rangeMemo?.body_part || null,
        });

        payload.push({
          year: currentYear,
          month: currentMonth,
          week_index: w,
          day_index: d,
          row_index: row,
          col_index: col,
          content: rangeMemo?.content || '',
          bg_color: nextBgColor,
          merge_span: rangeMemo?.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null },
          prescription: rangeMemo?.prescription || null,
          body_part: rangeMemo?.body_part || null,
        });
      }
    }
  });

  if (payload.length === 0) return null;
  return { oldMemos, payload };
}
