import fs from 'fs';
const code = fs.readFileSync('src/components/shockwave/ShockwaveSettlementView.jsx', 'utf-8');
const lines = code.split('\n');
lines.forEach((l, i) => {
  if (l.includes('결산 금액') || l.includes('인센티브')) {
    console.log(`Line ${i}: ${l.trim()}`);
  }
});
