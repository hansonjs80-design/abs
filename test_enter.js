import fs from 'fs';
const code = fs.readFileSync('src/components/shockwave/ShockwaveView.jsx', 'utf-8');
const lines = code.split('\n');
lines.forEach((l, i) => {
  if (l.includes('Enter') || l.includes('commit') || l.includes('onKeyDown')) {
    console.log(`Line ${i}: ${l.trim()}`);
  }
});
