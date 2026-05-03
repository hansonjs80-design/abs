import fs from 'fs';
const code = fs.readFileSync('src/styles/shockwave_stats.css', 'utf-8');
const lines = code.split('\n');
lines.forEach((l, i) => {
  if (l.includes('.sw-grid-table-wrap')) {
    console.log(`Line ${i}: ${l.trim()}`);
  }
});
