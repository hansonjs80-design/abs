import fs from 'fs';
const code = fs.readFileSync('src/styles/shockwave_stats.css', 'utf-8');
const lines = code.split('\n');

const keywords = ['.sw-settlement-card', '.label-col', '.grand-col', '.grand-value', '.row-label', '.sw-stats-container', 'box-shadow'];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (line.includes('background') || line.includes('box-shadow')) {
    let blockStart = i;
    while (blockStart >= 0 && !lines[blockStart].includes('{')) blockStart--;
    
    let selectorLine = blockStart;
    while (selectorLine >= 0 && lines[selectorLine].trim() !== '' && !lines[selectorLine].includes('}')) {
      if (keywords.some(k => lines[selectorLine].includes(k))) {
        console.log(`Line ${selectorLine} to ${i}:`);
        console.log(lines.slice(selectorLine, i + 1).join('\n'));
        console.log('---');
        break;
      }
      selectorLine--;
    }
  }
}
