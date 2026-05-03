import fs from 'fs';
const code = fs.readFileSync('src/components/shockwave/ShockwaveView.jsx', 'utf-8');
const lines = code.split('\n');
const saveLines = [];
lines.forEach((l, i) => {
  if (l.includes('saveShockwaveMemosBulk')) {
    saveLines.push(`Line ${i}: ${l.trim()}`);
  }
});
console.log(saveLines.join('\n'));
