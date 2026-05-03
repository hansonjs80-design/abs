import fs from 'fs';
const code = fs.readFileSync('src/components/shockwave/ShockwaveView.jsx', 'utf-8');
const lines = code.split('\n');
const start = lines.findIndex(l => l.includes('useEffect(() => {'));
// find all useeffects and check if they return a cleanup that calls saveShockwaveMemosBulk
const cleanups = [];
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('return () => {') || lines[i].includes('return () => saveShockwaveMemosBulk')) {
    cleanups.push(`Line ${i}: ${lines[i].trim()}`);
    if (lines[i+1]) cleanups.push(`Line ${i+1}: ${lines[i+1].trim()}`);
  }
}
console.log(cleanups.join('\n'));
