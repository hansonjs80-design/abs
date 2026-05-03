import fs from 'fs';
const code = fs.readFileSync('src/contexts/ScheduleContext.jsx', 'utf-8');
const lines = code.split('\n');
const start = lines.findIndex(l => l.includes('const saveShockwaveMemosBulk = useCallback'));
console.log(lines.slice(start, start + 40).join('\n'));
