import { buildCrossMonthMirroredPayloads } from './src/lib/calendarUtils.js';

const originalPayloads = [
  {
    year: 2026, month: 4, week_index: 4, day_index: 3, row_index: 2, col_index: 1, content: 'Test'
  }
];

const mirroredPayloads = buildCrossMonthMirroredPayloads(originalPayloads);
console.log("Original Payloads:", originalPayloads);
console.log("Mirrored Payloads:", mirroredPayloads);
