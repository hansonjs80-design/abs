import fs from 'fs';
const code = fs.readFileSync('src/styles/shockwave_stats.css', 'utf-8');
const lines = code.split('\n');
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (line.includes('width') && (
      lines.slice(Math.max(0, i-5), i).some(l => l.includes('therapist-col') || l.includes('prescription-col') || l.includes('grand-col') || l.includes('grand-value') || l.includes('label-col'))
  )) {
    console.log(`Line ${i-2} to ${i+2}:`);
    console.log(lines.slice(Math.max(0, i-2), i+3).join('\n'));
    console.log('---');
  }
}
