import fs from 'fs';
const code = fs.readFileSync('src/styles/shockwave_stats.css', 'utf-8');
const lines = code.split('\n');
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('.amount') || lines[i].includes('.incentive')) {
    console.log(`Line ${i}: ${lines[i].trim()}`);
  }
}
