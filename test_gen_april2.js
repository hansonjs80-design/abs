import { generateShockwaveCalendar } from './src/lib/calendarUtils.js';

const weeks = generateShockwaveCalendar(2026, 4);
weeks.forEach((w, wIdx) => {
  w.forEach((d, dIdx) => {
    console.log(`Week ${wIdx}, Day ${dIdx}: ${d.year}-${d.month}-${d.day}`);
  });
});
