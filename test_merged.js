import fs from 'fs';
const code = fs.readFileSync('src/components/shockwave/ShockwaveSettlementView.jsx', 'utf-8');
const lines = code.split('\n');
lines.forEach((l, i) => {
  if (l.includes('결산 금액(원)') || l.includes('인센티브 (')) {
    console.log(`\nHeader at line ${i}: ${l.trim()}`);
    // print next 10 lines
    console.log(lines.slice(i+1, i+10).join('\n'));
  }
});
