import fs from 'fs';

const backup = JSON.parse(fs.readFileSync('backup_2026_06.json', 'utf-8'));

const conflicts = [
  { w: 2, d: 4, c: 1, label: 'Week 2, Day 4, Col 1 (금요일, 신수민)' },
  { w: 2, d: 4, c: 0, label: 'Week 2, Day 4, Col 0 (금요일, 주한솔)' },
  { w: 2, d: 0, c: 1, label: 'Week 2, Day 0, Col 1 (월요일, 신수민)' },
  { w: 2, d: 0, c: 0, label: 'Week 2, Day 0, Col 0 (월요일, 주한솔)' },
  { w: 1, d: 4, c: 0, label: 'Week 1, Day 4, Col 0 (금요일, 주한솔)' },
  { w: 1, d: 4, c: 0, label: 'Week 1, Day 4, Col 0 (금요일, 주한솔) - another' },
  { w: 1, d: 4, c: 0, label: 'Week 1, Day 4, Col 0 (금요일, 주한솔) - another 2' }
];

// Deduplicate conflicts to scan unique day/col coordinates
const uniqueCoordinates = [];
const seen = new Set();
conflicts.forEach(c => {
  const key = `${c.w}-${c.d}-${c.c}`;
  if (!seen.has(key)) {
    seen.add(key);
    uniqueCoordinates.push(c);
  }
});

uniqueCoordinates.forEach(conf => {
  const matching = backup.filter(item => 
    item.week_index === conf.w &&
    item.day_index === conf.d &&
    item.col_index === conf.c &&
    item.content && item.content.trim() !== ''
  );
  
  console.log(`\nConflict details for ${conf.label} (w:${conf.w}, d:${conf.d}, c:${conf.c}):`);
  matching.forEach(m => {
    console.log(`- Row ${m.row_index}: Content="${m.content}", Prescription="${m.prescription}", rowSpan=${m.merge_span?.rowSpan}`);
  });
});
