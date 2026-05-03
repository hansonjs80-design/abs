import fs from 'fs';
const code = fs.readFileSync('src/components/shockwave/ManualTherapyStatsView.jsx', 'utf-8');
const lines = code.split('\n');
const start = lines.findIndex(l => l.includes('총 합계'));
console.log(lines.slice(Math.max(0, start - 15), start + 40).join('\n'));
