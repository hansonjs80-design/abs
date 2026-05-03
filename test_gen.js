import { generateShockwaveCalendar } from './src/lib/calendarUtils.js';
const weeks = generateShockwaveCalendar(2026, 5);
console.log(weeks[0].map(d => `${d.year}-${d.month}-${d.day}`));
