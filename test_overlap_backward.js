import { getOverlappingCalendarCoordinates } from './src/lib/calendarUtils.js';

const coords = getOverlappingCalendarCoordinates(2026, 5, 0, 3);
console.log("Coords from May's April 30th:", coords);
