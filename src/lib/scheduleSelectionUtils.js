export function getScheduleCellKey(w, d, r, c) {
  return `${w}-${d}-${r}-${c}`;
}

export function parseScheduleCellKey(key) {
  const [w, d, r, c] = String(key || '').split('-').map(Number);
  return { w, d, r, c };
}

function defaultMergeSpan() {
  return { rowSpan: 1, colSpan: 1, mergedInto: null };
}

export function getMergeSpanForScheduleKey({
  key,
  memos,
  pendingMergeSpans = {},
  currentMemos,
}) {
  if (!currentMemos && pendingMergeSpans[key]) return pendingMergeSpans[key];
  return currentMemos?.[key]?.merge_span || memos?.[key]?.merge_span;
}

export function getEffectiveScheduleMergeSpan({
  key,
  memos,
  pendingMergeSpans = {},
  currentMemos,
}) {
  const memosData = currentMemos || memos || {};
  const cellData = memosData[key];
  const pendingSpan = currentMemos ? null : pendingMergeSpans[key];
  if (!cellData && !pendingSpan) return defaultMergeSpan();

  const mergeSpan = pendingSpan || cellData?.merge_span || defaultMergeSpan();
  if (!mergeSpan.mergedInto) return mergeSpan;

  const masterKey = mergeSpan.mergedInto;
  const masterData = memosData[masterKey];
  const masterSpan = (currentMemos ? null : pendingMergeSpans[masterKey]) || masterData?.merge_span;

  if ((!masterData && !pendingMergeSpans[masterKey]) || !masterSpan) {
    return { ...mergeSpan, mergedInto: null };
  }

  const { w, d, r, c } = parseScheduleCellKey(key);
  const { w: mw, d: md, r: mr, c: mc } = parseScheduleCellKey(masterKey);
  const endRow = mr + (masterSpan.rowSpan || 1) - 1;
  const endCol = mc + (masterSpan.colSpan || 1) - 1;

  if (mw === w && md === d && r >= mr && r <= endRow && c >= mc && c <= endCol) {
    return mergeSpan;
  }

  return { ...mergeSpan, mergedInto: null };
}

export function computeScheduleSelectionInfo({
  selectedCell,
  selectedKeys,
  memos,
  pendingMergeSpans = {},
}) {
  if (!selectedCell || !selectedKeys || selectedKeys.size === 0) return null;
  const { w, d } = selectedCell;
  let minRow = Infinity;
  let maxRow = -Infinity;
  let minCol = Infinity;
  let maxCol = -Infinity;
  let hasValid = false;

  Array.from(selectedKeys).forEach((key) => {
    const { w: kw, d: kd, r, c } = parseScheduleCellKey(key);
    if (kw !== w || kd !== d) return;
    hasValid = true;
    minRow = Math.min(minRow, r);
    maxRow = Math.max(maxRow, r);
    minCol = Math.min(minCol, c);
    maxCol = Math.max(maxCol, c);

    const mergeSpan = getMergeSpanForScheduleKey({ key, memos, pendingMergeSpans });
    if (mergeSpan?.mergedInto) {
      const masterKey = mergeSpan.mergedInto;
      const { w: mw, d: md, r: mr, c: mc } = parseScheduleCellKey(masterKey);
      if (mw !== w || md !== d) return;
      const masterSpan = getMergeSpanForScheduleKey({ key: masterKey, memos, pendingMergeSpans }) || defaultMergeSpan();
      minRow = Math.min(minRow, mr);
      minCol = Math.min(minCol, mc);
      maxRow = Math.max(maxRow, mr + (masterSpan.rowSpan || 1) - 1);
      maxCol = Math.max(maxCol, mc + (masterSpan.colSpan || 1) - 1);
    } else if (mergeSpan?.rowSpan > 1 || mergeSpan?.colSpan > 1) {
      maxRow = Math.max(maxRow, r + (mergeSpan.rowSpan || 1) - 1);
      maxCol = Math.max(maxCol, c + (mergeSpan.colSpan || 1) - 1);
    }
  });

  if (!hasValid || minRow === Infinity) return null;
  const boundedMinRow = minRow === Infinity ? selectedCell.r : minRow;
  const boundedMaxRow = maxRow === -Infinity ? selectedCell.r : maxRow;
  const boundedMinCol = minCol === Infinity ? selectedCell.c : minCol;
  const boundedMaxCol = maxCol === -Infinity ? selectedCell.c : maxCol;
  const masterKey = getScheduleCellKey(w, d, boundedMinRow, boundedMinCol);
  const masterSpan = getMergeSpanForScheduleKey({ key: masterKey, memos, pendingMergeSpans }) || defaultMergeSpan();
  const selectionRowSpan = boundedMaxRow - boundedMinRow + 1;
  const selectionColSpan = boundedMaxCol - boundedMinCol + 1;
  const isMergedMaster = !masterSpan.mergedInto && (masterSpan.rowSpan > 1 || masterSpan.colSpan > 1);

  return {
    w,
    d,
    minRow: boundedMinRow,
    maxRow: boundedMaxRow,
    minCol: boundedMinCol,
    maxCol: boundedMaxCol,
    masterKey,
    masterSpan,
    selectionRowSpan,
    selectionColSpan,
    isMergedMaster,
    selectionMultiple: selectionRowSpan > 1 || selectionColSpan > 1,
  };
}

export function normalizeScheduleCellToMergeMaster({
  cell,
  memos,
  pendingMergeSpans = {},
}) {
  if (!cell) return cell;
  const key = getScheduleCellKey(cell.w, cell.d, cell.r, cell.c);
  const mergeSpan = getEffectiveScheduleMergeSpan({ key, memos, pendingMergeSpans });
  if (!mergeSpan.mergedInto) return cell;
  return parseScheduleCellKey(mergeSpan.mergedInto);
}

export function normalizeScheduleKeysToMergeMasters({
  keys,
  memos,
  pendingMergeSpans = {},
}) {
  const normalized = new Set();
  if (!keys) return normalized;

  Array.from(keys).forEach((key) => {
    const masterCell = normalizeScheduleCellToMergeMaster({
      cell: parseScheduleCellKey(key),
      memos,
      pendingMergeSpans,
    });
    normalized.add(getScheduleCellKey(masterCell.w, masterCell.d, masterCell.r, masterCell.c));
  });

  return normalized;
}

export function buildScheduleRangeKeys(anchor, target) {
  if (!anchor || !target) return new Set();
  if (anchor.w !== target.w || anchor.d !== target.d) {
    return new Set([getScheduleCellKey(target.w, target.d, target.r, target.c)]);
  }

  const rMin = Math.min(anchor.r, target.r);
  const rMax = Math.max(anchor.r, target.r);
  const cMin = Math.min(anchor.c, target.c);
  const cMax = Math.max(anchor.c, target.c);
  const keys = new Set();
  for (let r = rMin; r <= rMax; r += 1) {
    for (let c = cMin; c <= cMax; c += 1) {
      keys.add(getScheduleCellKey(anchor.w, anchor.d, r, c));
    }
  }
  return keys;
}
