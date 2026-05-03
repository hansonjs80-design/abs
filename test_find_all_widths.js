import fs from 'fs';
const code = fs.readFileSync('src/styles/shockwave_stats.css', 'utf-8');
const lines = code.split('\n');

const keywords = ['.label-col', '.therapist-col', '.prescription-col', '.grand-col', '.grand-value'];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (line.includes('width') || line.includes('padding')) {
    // Check if the current block belongs to any of the keywords
    let blockStart = i;
    while (blockStart >= 0 && !lines[blockStart].includes('{')) {
      blockStart--;
    }
    // Now blockStart is the line with '{' or the line before it. Look backwards for the selectors
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
