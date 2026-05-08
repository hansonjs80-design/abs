import { useCallback } from 'react';

export default function useScheduleSelectionModel({
  selectedCell,
  selectedKeys,
  memos,
}) {
  const cellKey = useCallback((w, d, r, c) => `${w}-${d}-${r}-${c}`, []);

  const computeSelectionInfo = useCallback(() => {
    if (!selectedCell || !selectedKeys || selectedKeys.size === 0) return null;
    const { w, d } = selectedCell;
    let minRow = Infinity;
    let maxRow = -Infinity;
    let minCol = Infinity;
    let maxCol = -Infinity;
    let hasValid = false;

    Array.from(selectedKeys).forEach((key) => {
      const [kw, kd, r, c] = key.split('-').map(Number);
      if (kw !== w || kd !== d) return;
      hasValid = true;
      minRow = Math.min(minRow, r);
      maxRow = Math.max(maxRow, r);
      minCol = Math.min(minCol, c);
      maxCol = Math.max(maxCol, c);

      const mergeSpan = memos[key]?.merge_span;
      if (mergeSpan?.mergedInto) {
        const masterKey = mergeSpan.mergedInto;
        const [mw, md, mr, mc] = masterKey.split('-').map(Number);
        if (mw !== w || md !== d) return;
        const masterSpan = memos[masterKey]?.merge_span || { rowSpan: 1, colSpan: 1 };
        minRow = Math.min(minRow, mr);
        minCol = Math.min(minCol, mc);
        maxRow = Math.max(maxRow, mr + masterSpan.rowSpan - 1);
        maxCol = Math.max(maxCol, mc + masterSpan.colSpan - 1);
      } else if (mergeSpan?.rowSpan > 1 || mergeSpan?.colSpan > 1) {
        maxRow = Math.max(maxRow, r + mergeSpan.rowSpan - 1);
        maxCol = Math.max(maxCol, c + mergeSpan.colSpan - 1);
      }
    });

    if (!hasValid || minRow === Infinity) return null;
    const boundedMinRow = minRow === Infinity ? selectedCell.r : minRow;
    const boundedMaxRow = maxRow === -Infinity ? selectedCell.r : maxRow;
    const boundedMinCol = minCol === Infinity ? selectedCell.c : minCol;
    const boundedMaxCol = maxCol === -Infinity ? selectedCell.c : maxCol;
    const masterKey = cellKey(w, d, boundedMinRow, boundedMinCol);
    const masterSpan = memos[masterKey]?.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null };
    const selectionRowSpan = boundedMaxRow - boundedMinRow + 1;
    const selectionColSpan = boundedMaxCol - boundedMinCol + 1;
    const isMergedMaster = masterSpan.mergedInto === null && (masterSpan.rowSpan > 1 || masterSpan.colSpan > 1);

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
  }, [selectedCell, selectedKeys, memos, cellKey]);

  const getEffectiveMergeSpan = useCallback((key, currentMemos) => {
    const memosData = currentMemos || memos;
    const cellData = memosData[key];
    if (!cellData || !cellData.merge_span) return { rowSpan: 1, colSpan: 1, mergedInto: null };

    const mergeSpan = cellData.merge_span;
    if (!mergeSpan.mergedInto) return mergeSpan;

    const masterKey = mergeSpan.mergedInto;
    const masterData = memosData[masterKey];
    const masterSpan = masterData?.merge_span;

    if (!masterData || !masterSpan || masterSpan.rowSpan <= 1) {
      return { ...mergeSpan, mergedInto: null };
    }
    const [w, d, r, c] = key.split('-').map(Number);
    const [mw, md, mr, mc] = masterKey.split('-').map(Number);
    if (mw === w && md === d && mc === c) {
      const endRow = mr + (masterSpan.rowSpan || 1) - 1;
      if (r >= mr && r <= endRow) {
        return mergeSpan;
      }
    }
    return { ...mergeSpan, mergedInto: null };
  }, [memos]);

  const normalizeCellToMergeMaster = useCallback((cell) => {
    if (!cell) return cell;
    const key = cellKey(cell.w, cell.d, cell.r, cell.c);
    const mergeSpan = getEffectiveMergeSpan(key);
    if (!mergeSpan.mergedInto) return cell;
    const [w, d, r, c] = mergeSpan.mergedInto.split('-').map(Number);
    return { w, d, r, c };
  }, [cellKey, getEffectiveMergeSpan]);

  const normalizeKeysToMergeMasters = useCallback((keys) => {
    const normalized = new Set();
    if (!keys) return normalized;

    Array.from(keys).forEach((key) => {
      const [w, d, r, c] = key.split('-').map(Number);
      const masterCell = normalizeCellToMergeMaster({ w, d, r, c });
      normalized.add(cellKey(masterCell.w, masterCell.d, masterCell.r, masterCell.c));
    });

    return normalized;
  }, [normalizeCellToMergeMaster, cellKey]);

  const buildRangeKeys = useCallback((anchor, target) => {
    if (!anchor || !target) return new Set();
    if (anchor.w !== target.w || anchor.d !== target.d) {
      return new Set([cellKey(target.w, target.d, target.r, target.c)]);
    }

    const rMin = Math.min(anchor.r, target.r);
    const rMax = Math.max(anchor.r, target.r);
    const cMin = Math.min(anchor.c, target.c);
    const cMax = Math.max(anchor.c, target.c);
    const keys = new Set();
    for (let r = rMin; r <= rMax; r += 1) {
      for (let c = cMin; c <= cMax; c += 1) {
        keys.add(cellKey(anchor.w, anchor.d, r, c));
      }
    }
    return keys;
  }, [cellKey]);

  return {
    cellKey,
    computeSelectionInfo,
    getEffectiveMergeSpan,
    normalizeCellToMergeMaster,
    normalizeKeysToMergeMasters,
    buildRangeKeys,
  };
}
