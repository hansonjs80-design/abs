import fs from 'fs';
const code = fs.readFileSync('src/pages/ShockwavePage.jsx', 'utf-8');
const lines = code.split('\n');
const start = lines.findIndex(l => l.includes('onSaveMemo={'));
console.log(lines.slice(Math.max(0, start - 15), start + 15).join('\n'));
