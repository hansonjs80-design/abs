import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  partitionVisibleScheduleMonthTargets,
  shiftScheduleMonth,
  shouldKeepScheduleMounted,
} from '../scheduleMonthLoadUtils.js';

describe('schedule month loading priority', () => {
  it('separates the displayed month from adjacent visible months', () => {
    const result = partitionVisibleScheduleMonthTargets([
      { year: 2026, month: 6 },
      { year: 2026, month: 7 },
      { year: 2026, month: 8 },
    ], 2026, 7);

    assert.deepEqual(result.currentTarget, { year: 2026, month: 7 });
    assert.deepEqual(result.adjacentTargets, [
      { year: 2026, month: 6 },
      { year: 2026, month: 8 },
    ]);
  });

  it('provides a displayed-month target even when the visible list is incomplete', () => {
    const result = partitionVisibleScheduleMonthTargets([
      { year: 2026, month: 6 },
    ], '2026', '7');

    assert.deepEqual(result.currentTarget, { year: 2026, month: 7 });
    assert.deepEqual(result.adjacentTargets, [{ year: 2026, month: 6 }]);
  });

  it('keeps rapid month navigation correct across year boundaries', () => {
    const january = shiftScheduleMonth(2026, 12, 1);
    const february = shiftScheduleMonth(january.year, january.month, 1);

    assert.deepEqual(january, { year: 2027, month: 1 });
    assert.deepEqual(february, { year: 2027, month: 2 });
    assert.deepEqual(shiftScheduleMonth(2027, 1, -1), { year: 2026, month: 12 });
  });

  it('keeps the scheduler mounted while the next month is loading', () => {
    assert.equal(shouldKeepScheduleMounted({
      currentMonthReady: false,
      lastLoadedMonthKey: '2026-7',
      loadError: '',
    }), true);
    assert.equal(shouldKeepScheduleMounted({
      currentMonthReady: false,
      lastLoadedMonthKey: '',
      loadError: '',
    }), false);
    assert.equal(shouldKeepScheduleMounted({
      currentMonthReady: false,
      lastLoadedMonthKey: '2026-7',
      loadError: 'failed',
    }), false);
    assert.equal(shouldKeepScheduleMounted({
      currentMonthReady: true,
      lastLoadedMonthKey: '2026-7',
      loadError: 'non-critical warning',
    }), true);
  });
});
