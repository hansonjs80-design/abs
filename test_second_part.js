import fs from 'fs';
const code = fs.readFileSync('src/components/shockwave/ManualTherapySixMonthStats.jsx', 'utf-8');
console.log(code.split('\n').filter(l => l.includes('className')).join('\n'));
