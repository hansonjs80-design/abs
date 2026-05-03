import fs from 'fs';
const code = fs.readFileSync('src/index.css', 'utf-8');
const lines = code.split('\n');
lines.forEach((l, i) => {
  if (l.includes('.dashboard-card')) {
    console.log(`Line ${i}: ${l.trim()}`);
  }
});
