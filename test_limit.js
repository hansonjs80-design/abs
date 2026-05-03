import fs from 'fs';
const code = fs.readFileSync('src/contexts/ScheduleContext.jsx', 'utf-8');
const lines = code.split('\n');
lines.forEach((l, i) => {
  if (l.includes('.select(') && !l.includes('count')) {
    console.log(`Line ${i}: ${l.trim()}`);
  }
});
