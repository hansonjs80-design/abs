import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  collectVisibleScheduleMonthRows,
  normalizeLoadedScheduleMonthKey,
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

  it('normalizes the context month key to the scheduler view key', () => {
    assert.equal(normalizeLoadedScheduleMonthKey('2026-7', 2026, 7), '2026-07');
    assert.equal(normalizeLoadedScheduleMonthKey('2026-07', 2026, 7), '2026-07');
    assert.equal(normalizeLoadedScheduleMonthKey('2026-10', 2026, 10), '2026-10');
    assert.equal(normalizeLoadedScheduleMonthKey('2026-6', 2026, 7), '2026-6');
    assert.equal(normalizeLoadedScheduleMonthKey('', 2026, 7), '');
  });

  it('rebuilds a cached view when adjacent month rows arrive later', () => {
    const targets = [
      { year: 2026, month: 6 },
      { year: 2026, month: 7 },
      { year: 2026, month: 8 },
    ];
    const cachedRows = new Map([
      ['2026-6', [{ id: 'previous' }]],
      ['2026-7', [{ id: 'current' }]],
    ]);
    const readRows = (target) => cachedRows.get(`${target.year}-${target.month}`);

    const incompleteView = collectVisibleScheduleMonthRows(
      targets,
      2026,
      7,
      readRows
    );
    assert.deepEqual(incompleteView.rows.map((row) => row.id), ['previous', 'current']);
    assert.deepEqual(incompleteView.missingTargets, [{ year: 2026, month: 8 }]);
    assert.equal(incompleteView.hasCurrentMonthRows, true);
    assert.equal(incompleteView.isComplete, false);

    cachedRows.set('2026-8', [{ id: 'next' }]);
    const completedView = collectVisibleScheduleMonthRows(
      targets,
      2026,
      7,
      readRows
    );
    assert.deepEqual(completedView.rows.map((row) => row.id), [
      'previous',
      'current',
      'next',
    ]);
    assert.deepEqual(completedView.missingTargets, []);
    assert.equal(completedView.hasCurrentMonthRows, true);
    assert.equal(completedView.isComplete, true);
  });

  it('does not treat adjacent rows without the displayed month as a complete view', () => {
    const targets = [
      { year: 2026, month: 6 },
      { year: 2026, month: 7 },
      { year: 2026, month: 8 },
    ];
    const cachedRows = new Map([
      ['2026-6', [{ id: 'previous' }]],
      ['2026-8', [{ id: 'next' }]],
    ]);

    const view = collectVisibleScheduleMonthRows(
      targets,
      2026,
      7,
      (target) => cachedRows.get(`${target.year}-${target.month}`)
    );

    assert.deepEqual(view.missingTargets, [{ year: 2026, month: 7 }]);
    assert.equal(view.hasCurrentMonthRows, false);
    assert.equal(view.isComplete, false);
  });
});
