import fs from 'fs';
const code = fs.readFileSync('src/styles/shockwave_stats.css', 'utf-8');
const lines = code.split('\n');
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('.sw-summary-table') || lines[i].includes('.month-label')) {
    let blockStart = i;
    while (blockStart >= 0 && !lines[blockStart].includes('{')) blockStart--;
    let selectorLine = blockStart;
    while (selectorLine >= 0 && lines[selectorLine].trim() !== '' && !lines[selectorLine].includes('}')) {
      console.log(`Line ${selectorLine} to ${i}:`);
      console.log(lines.slice(selectorLine, i + 1).join('\n'));
      console.log('---');
      break;
    }
  }
}
