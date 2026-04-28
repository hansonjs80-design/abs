const getEffectiveMergeSpan = (key, memos) => {
    const memosData = memos;
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
};

// Scenario: Master is 0-5-4-0 (row 4, col 0) with rowSpan 2.
// Sub cell is 0-5-6-0 (row 6, col 0) pointing to 0-5-4-0.
const memos = {
    "0-5-4-0": {
        content: "14278/이태유",
        merge_span: { rowSpan: 2, colSpan: 1, mergedInto: null }
    },
    "0-5-6-0": {
        content: "",
        merge_span: { rowSpan: 1, colSpan: 1, mergedInto: "0-5-4-0" }
    }
};

console.log("Sub cell merge span:", getEffectiveMergeSpan("0-5-6-0", memos));
