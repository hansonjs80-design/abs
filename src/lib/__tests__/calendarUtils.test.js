import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canonicalizeShockwaveScheduleItemDate,
  getVisibleShockwaveScheduleMonths,
  mapShockwaveScheduleItemToCurrentMonthView,
  mapShockwaveScheduleItemToVisibleMonth,
} from '../shockwaveScheduleDateMapping.js';

test('canonicalizes a visible next-month cell to the actual month coordinates', () => {
  const displayPayload = {
    year: 2026,
    month: 6,
    week_index: 4,
    day_index: 2,
    row_index: 0,
    col_index: 1,
    content: 'next month patient',
  };

  const canonical = canonicalizeShockwaveScheduleItemDate(displayPayload);

  assert.equal(canonical.year, 2026);
  assert.equal(canonical.month, 7);
  assert.equal(canonical.week_index, 0);
  assert.equal(canonical.day_index, 2);
  assert.equal(canonical.row_index, 0);
  assert.equal(canonical.col_index, 1);
  assert.equal(canonical.content, 'next month patient');
});

test('maps an actual month schedule row back to a visible adjacent-month cell', () => {
  const storedRow = {
    year: 2026,
    month: 7,
    week_index: 0,
    day_index: 2,
    row_index: 0,
    col_index: 1,
    content: 'next month patient',
  };

  const visible = mapShockwaveScheduleItemToVisibleMonth(storedRow, 2026, 6);

  assert.equal(visible.year, 2026);
  assert.equal(visible.month, 6);
  assert.equal(visible.week_index, 4);
  assert.equal(visible.day_index, 2);
  assert.equal(visible.row_index, 0);
  assert.equal(visible.col_index, 1);
});

test('loads all months represented by a shockwave calendar view', () => {
  const visibleMonths = getVisibleShockwaveScheduleMonths(2026, 6)
    .map((item) => `${item.year}-${item.month}`);

  assert.deepEqual(visibleMonths, ['2026-6', '2026-7']);
});

test('does not map adjacent-month schedules into a current month view', () => {
  const june29Row = {
    year: 2026,
    month: 6,
    week_index: 4,
    day_index: 0,
    row_index: 0,
    col_index: 1,
    content: 'previous month patient',
  };
  const aug1Row = {
    year: 2026,
    month: 8,
    week_index: 0,
    day_index: 5,
    row_index: 0,
    col_index: 1,
    content: 'next month patient',
  };

  assert.equal(mapShockwaveScheduleItemToCurrentMonthView(june29Row, 2026, 7), null);
  assert.equal(mapShockwaveScheduleItemToCurrentMonthView(aug1Row, 2026, 7), null);
});
