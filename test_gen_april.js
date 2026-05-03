import { generateShockwaveCalendar } from './src/lib/calendarUtils.js';

const weeks = generateShockwaveCalendar(2026, 4);
weeks.forEach((w, wIdx) => {
  w.forEach((d, dIdx) => {
    if (d.month === 4 && d.day === 30) {
      console.log(`April 30th is at Week ${wIdx}, Day ${dIdx}`);
    }
  });
});
