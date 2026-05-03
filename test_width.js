import fs from 'fs';
const code = fs.readFileSync('src/styles/shockwave_stats.css', 'utf-8');
const lines = code.split('\n');
lines.forEach((l, i) => {
  if ((l.includes('width') || l.includes('flex')) && (l.includes('therapist-col') || l.includes('prescription-col') || l.includes('grand-col') || l.includes('grand-value'))) {
    console.log(`Line ${i}: ${l.trim()}`);
  }
});
