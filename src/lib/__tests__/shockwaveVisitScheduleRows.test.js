import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildShockwaveVisitScheduleRows } from '../shockwaveVisitScheduleRows.js';

test('keeps explicit visit schedules independently of insurance prescription configuration', () => {
  const schedules = [
    { id: 'a', year: 2026, month: 9, week_index: 2, day_index: 0, row_index: 0, col_index: 0, content: '101/가상환자*', prescription: 'F4.0', body_part: 'Lt. Elbow' },
    { id: 'b', year: 2026, month: 9, week_index: 3, day_index: 2, row_index: 0, col_index: 0, content: '101/가상환자(3)', prescription: 'F4.0', body_part: 'Lt. Elbow' },
  ];
  const rows = buildShockwaveVisitScheduleRows(schedules, { monthly_settlement_settings: { '2026-09': { shockwave: { prescriptions: [] } } } }, '2026-09-30');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.visit_count), ['*', '3']);
  assert.ok(rows.every((row) => !row._excluded && row._schedule));
});
