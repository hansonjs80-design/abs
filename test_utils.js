import fs from 'fs';
const code = fs.readFileSync('src/lib/calendarUtils.js', 'utf-8');
const lines = code.split('\n');
const start = lines.findIndex(l => l.includes('export function buildCrossMonthMirroredPayloads'));
console.log(lines.slice(start, start + 20).join('\n'));
