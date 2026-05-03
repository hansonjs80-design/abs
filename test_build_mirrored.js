import { buildCrossMonthMirroredPayloads } from './src/lib/calendarUtils.js';

const p = [{
  year: 2026, month: 4, week_index: 4, day_index: 3, row_index: 4, col_index: 1, content: 'TEST'
}];
try {
  console.log(buildCrossMonthMirroredPayloads(p));
} catch(e) {
  console.error("ERROR", e);
}
