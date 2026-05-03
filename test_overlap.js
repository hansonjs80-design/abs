import { getOverlappingCalendarCoordinates } from './src/lib/calendarUtils.js';

const c1 = getOverlappingCalendarCoordinates(2026, 4, 4, 3);
console.log("From Month 4 (April 30th):", c1);

const c2 = getOverlappingCalendarCoordinates(2026, 5, 0, 3);
console.log("From Month 5 (April 30th):", c2);
