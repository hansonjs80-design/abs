import { generateShockwaveCalendar } from './src/lib/calendarUtils.js';

const weeks = generateShockwaveCalendar(2026, 4);
const week4 = weeks[4];
console.log("Week 4:");
week4.forEach(d => {
  console.log(`${d.month}/${d.day} isCurrentMonth: ${d.isCurrentMonth}`);
});
