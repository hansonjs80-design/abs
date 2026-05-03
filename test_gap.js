import fs from 'fs';
const code = fs.readFileSync('src/pages/ManualTherapyStatsPage.jsx', 'utf-8');
const lines = code.split('\n');
lines.forEach((l, i) => {
  if (l.includes('ManualTherapySixMonthStats') || l.includes('ManualTherapyStatsView')) {
    console.log(`Line ${i}: ${l.trim()}`);
  }
});
