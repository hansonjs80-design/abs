import fs from 'fs';
const code = fs.readFileSync('src/contexts/ScheduleContext.jsx', 'utf-8');
const lines = code.split('\n');
const start = lines.findIndex(l => l.includes('const saveShockwaveMemo = useCallback(async (year, month, week_index, day_index, row_index, col_index, content) => {'));
if (start === -1) {
  const start2 = lines.findIndex(l => l.includes('const saveShockwaveMemo = useCallback'));
  console.log(lines.slice(start2, start2 + 30).join('\n'));
} else {
  console.log(lines.slice(start, start + 30).join('\n'));
}
