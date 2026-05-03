import fs from 'fs';
const code = fs.readFileSync('src/components/shockwave/ShockwaveDataGrid.jsx', 'utf-8');
const lines = code.split('\n');
console.log(lines.slice(Math.max(0, lines.length - 150), lines.length).join('\n'));
