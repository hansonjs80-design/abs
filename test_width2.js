import fs from 'fs';
const code = fs.readFileSync('src/styles/shockwave_stats.css', 'utf-8');
const lines = code.split('\n');
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('width') && lines[i-1] && lines[i-1].includes('sw-manual-compact')) {
    console.log(`Line ${i-1}: ${lines[i-1].trim()}`);
    console.log(`Line ${i}: ${lines[i].trim()}`);
  }
}
