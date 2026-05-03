import fs from 'fs';
const code = fs.readFileSync('src/styles/shockwave_stats.css', 'utf-8');
const lines = code.split('\n');
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('border') && (lines[i].includes('sw-settlement-table') || lines[i].includes('sw-summary-table'))) {
    console.log(`Line ${i}: ${lines[i].trim()}`);
  }
}
