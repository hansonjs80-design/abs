import { generateShockwaveCalendar } from './src/lib/calendarUtils.js';

const weeks = generateShockwaveCalendar(2026, 4);
console.log(JSON.stringify(weeks[4][3], null, 2));
