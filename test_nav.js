import fs from 'fs';
const code = fs.readFileSync('src/index.css', 'utf-8');
const lines = code.split('\n');
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('nav-tab')) {
    console.log(`Line ${i}: ${lines[i].trim()}`);
  }
}
