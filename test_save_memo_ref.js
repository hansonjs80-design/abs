import fs from 'fs';
const code = fs.readFileSync('src/components/shockwave/ShockwaveView.jsx', 'utf-8');
const lines = code.split('\n');
const start = lines.findIndex(l => l.includes('saveMemoRef.current = '));
console.log(lines.slice(Math.max(0, start - 5), start + 25).join('\n'));
