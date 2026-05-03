import fs from 'fs';
const code = fs.readFileSync('src/contexts/ScheduleContext.jsx', 'utf-8');
const lines = code.split('\n');
lines.forEach((l, i) => {
  if (l.includes('.select(')) {
    console.log(`Line ${Math.max(0, i-5)} to ${i+5}`);
  }
});
