import fs from 'fs';

let content = fs.readFileSync('src/components/shockwave/ShockwaveView.jsx', 'utf-8');

const helper = `
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

`;

// insert it right before normalizeCellToMergeMaster
// or somewhere near the top of the component
// The component is `export default function ShockwaveView({...}) {`

const insertPos = content.indexOf('const buildScheduleState = useCallback');
if (insertPos !== -1) {
  content = content.slice(0, insertPos) + helper + content.slice(insertPos);
}

// Now replace usages of normalizeCellToMergeMaster to use it
content = content.replace(/const normalizeCellToMergeMaster = useCallback\(\(cell\) => \{[\s\S]*?\}, \[cellKey, memos\]\);/m, 
`const normalizeCellToMergeMaster = useCallback((cell) => {
    if (!cell) return cell;
    const key = cellKey(cell.w, cell.d, cell.r, cell.c);
    const mergeSpan = getEffectiveMergeSpan(key);
    if (!mergeSpan.mergedInto) return cell;
    const [w, d, r, c] = mergeSpan.mergedInto.split('-').map(Number);
    return { w, d, r, c };
  }, [cellKey, getEffectiveMergeSpan]);`);

content = content.replace(/const normalizeKeysToMergeMasters = useCallback\(\(keys\) => \{[\s\S]*?\}, \[memos\]\);/m,
`const normalizeKeysToMergeMasters = useCallback((keys) => {
    const normalized = new Set();
    if (!keys) return normalized;

    Array.from(keys).forEach((key) => {
      const [w, d, r, c] = key.split('-').map(Number);
      const masterCell = normalizeCellToMergeMaster({w, d, r, c});
      normalized.add(cellKey(masterCell.w, masterCell.d, masterCell.r, masterCell.c));
    });

    return normalized;
  }, [normalizeCellToMergeMaster, cellKey]);`);

// And in the rendering loop:
const renderLoopMatch = `let mergeSpan = cellData?.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null };

                        // Validate mergedInto reference - prevent "dead" cells
                        if (mergeSpan.mergedInto) {
                          const masterKey = mergeSpan.mergedInto;
                          const masterData = memos[masterKey];
                          const masterSpan = masterData?.merge_span;
                          if (!masterData || !masterSpan || masterSpan.rowSpan <= 1) {
                            // Master cell doesn't exist or has no merge span - orphaned reference
                            mergeSpan = { rowSpan: 1, colSpan: 1, mergedInto: null };
                          } else {
                            // Verify master actually covers this cell
                            const [mw, md, mr, mc] = masterKey.split('-').map(Number);
                            if (mw === weekIdx && md === dayIdx && mc === colIdx) {
                              const endRow = mr + (masterSpan.rowSpan || 1) - 1;
                              if (rowIdx < mr || rowIdx > endRow) {
                                mergeSpan = { rowSpan: 1, colSpan: 1, mergedInto: null };
                              }
                            } else {
                              // Master is in a different column/day - invalid
                              mergeSpan = { rowSpan: 1, colSpan: 1, mergedInto: null };
                            }
                          }
                        }`;

content = content.replace(renderLoopMatch, `let mergeSpan = getEffectiveMergeSpan(key);`);

fs.writeFileSync('src/components/shockwave/ShockwaveView.jsx', content);
