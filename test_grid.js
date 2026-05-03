import fs from 'fs';
const code = fs.readFileSync('src/components/shockwave/ShockwaveDataGrid.jsx', 'utf-8');
const lines = code.split('\n');
console.log(lines.slice(0, 100).join('\n'));
