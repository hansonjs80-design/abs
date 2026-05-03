import fs from 'fs';
const code = fs.readFileSync('src/contexts/ScheduleContext.jsx', 'utf-8');
const lines = code.split('\n');

for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('useEffect') || lines[i].includes('fetchData') || lines[i].includes('loadShockwaveMemos') || lines[i].includes('loadStaffMemos')) {
    // Print a snippet around it
    console.log(`Line ${i}: ${lines[i].trim()}`);
  }
}
