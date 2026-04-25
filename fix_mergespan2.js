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

if (!content.includes('const getEffectiveMergeSpan')) {
  const insertPos = content.indexOf('const normalizeCellToMergeMaster');
  content = content.slice(0, insertPos) + helper + content.slice(insertPos);
  fs.writeFileSync('src/components/shockwave/ShockwaveView.jsx', content);
}
