import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_SCHEDULE_TIME_COL_WIDTH,
  MAX_SCHEDULE_TIME_COL_WIDTH,
  MIN_SCHEDULE_TIME_COL_WIDTH,
  clampScheduleTimeColWidth,
} from '../scheduleGridSizeUtils.js';

test('time column width keeps the existing 41px default', () => {
  assert.equal(DEFAULT_SCHEDULE_TIME_COL_WIDTH, 41);
  assert.equal(clampScheduleTimeColWidth(undefined), 41);
});

test('time column width rounds user adjustments and stays within safe bounds', () => {
  assert.equal(clampScheduleTimeColWidth(54.6), 55);
  assert.equal(clampScheduleTimeColWidth(1), MIN_SCHEDULE_TIME_COL_WIDTH);
  assert.equal(clampScheduleTimeColWidth(999), MAX_SCHEDULE_TIME_COL_WIDTH);
});
