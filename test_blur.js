import fs from 'fs';
const code = fs.readFileSync('src/components/shockwave/ShockwaveView.jsx', 'utf-8');
const lines = code.split('\n');
const start = lines.findIndex(l => l.includes('const handleCellInputBlur = useCallback'));
console.log(lines.slice(start, start + 30).join('\n'));
