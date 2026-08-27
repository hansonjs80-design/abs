import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  canStorePreloadedScheduleView,
  collectUniqueScheduleMonthTargets,
  collectVisibleScheduleMonthRows,
  getScheduleRealtimePayloadKind,
  getStaffScheduleViewKey,
  isStaffScheduleViewReady,
  normalizeLoadedScheduleMonthKey,
  partitionVisibleScheduleMonthTargets,
  shiftScheduleMonth,
  shouldKeepScheduleMounted,
  updateCachedScheduleRowsFromRealtime,
} from '../scheduleMonthLoadUtils.js';

describe('schedule month loading priority', () => {
  it('applies staff schedule colors only after the target view has loaded', () => {
    assert.equal(getStaffScheduleViewKey(2026, 8, true), '2026-8-adj');
    assert.equal(isStaffScheduleViewReady('2026-8-adj', 2026, 8, true), true);
    assert.equal(isStaffScheduleViewReady('2026-7-adj', 2026, 8, true), false);
    assert.equal(isStaffScheduleViewReady('2026-8-single', 2026, 8, true), false);
  });

  it('stores a preloaded screen only when its complete cache version is still current', () => {
    assert.equal(canStorePreloadedScheduleView({
      expectedVersion: 4,
      currentVersion: 4,
      isComplete: true,
      hasRelocations: false,
    }), true);
    assert.equal(canStorePreloadedScheduleView({
      expectedVersion: 4,
      currentVersion: 5,
      isComplete: true,
      hasRelocations: false,
    }), false);
    assert.equal(canStorePreloadedScheduleView({
      expectedVersion: 4,
      currentVersion: 4,
      isComplete: false,
      hasRelocations: false,
    }), false);
    assert.equal(canStorePreloadedScheduleView({
      expectedVersion: 4,
      currentVersion: 4,
      isComplete: true,
      hasRelocations: true,
    }), false);
  });

  it('deduplicates the current and neighboring view months for background preloading', () => {
    assert.deepEqual(collectUniqueScheduleMonthTargets(
      [
        { year: 2026, month: 6 },
        { year: 2026, month: 7 },
        { year: 2026, month: 8 },
      ],
      [
        { year: 2026, month: 5 },
        { year: 2026, month: 6 },
        { year: 2026, month: 7 },
      ],
      [
        { year: 2026, month: 7 },
        { year: 2026, month: 8 },
        { year: 2026, month: 9 },
      ]
    ), [
      { year: 2026, month: 6 },
      { year: 2026, month: 7 },
      { year: 2026, month: 8 },
      { year: 2026, month: 5 },
      { year: 2026, month: 9 },
    ]);
  });

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

  it('keeps raw month rows aligned with realtime upserts and deletes', () => {
    const originalRows = [
      {
        id: 'row-a',
        year: 2026,
        month: 7,
        week_index: 4,
        day_index: 2,
        row_index: 3,
        col_index: 1,
        content: '이전 내용',
        prescription: 'F2.5',
      },
    ];

    const updatedRows = updateCachedScheduleRowsFromRealtime(originalRows, {
      id: 'row-a',
      year: 2026,
      month: 7,
      week_index: 4,
      day_index: 2,
      row_index: 3,
      col_index: 1,
      content: '실시간 변경',
    });
    assert.notEqual(updatedRows, originalRows);
    assert.equal(updatedRows[0].content, '실시간 변경');
    assert.equal(updatedRows[0].prescription, 'F2.5');

    const insertedRows = updateCachedScheduleRowsFromRealtime(updatedRows, {
      id: 'row-b',
      year: 2026,
      month: 7,
      week_index: 4,
      day_index: 3,
      row_index: 5,
      col_index: 1,
      content: '새 내용',
    });
    assert.deepEqual(insertedRows.map((row) => row.id), ['row-a', 'row-b']);

    const deletedRows = updateCachedScheduleRowsFromRealtime(
      insertedRows,
      { id: 'row-a' },
      { remove: true }
    );
    assert.deepEqual(deletedRows.map((row) => row.id), ['row-b']);
  });

  it('does not change raw month rows for an unrelated realtime delete', () => {
    const rows = [{ id: 'row-a', content: '유지' }];
    assert.equal(
      updateCachedScheduleRowsFromRealtime(rows, { id: 'missing' }, { remove: true }),
      rows
    );
  });

  it('recognizes a Supabase delete even when its new record is an empty object', () => {
    assert.equal(getScheduleRealtimePayloadKind({
      eventType: 'DELETE',
      new: {},
      old: { id: 'row-a' },
    }), 'delete');
    assert.equal(getScheduleRealtimePayloadKind({
      eventType: 'UPDATE',
      new: { id: 'row-a', content: '변경' },
      old: { id: 'row-a', content: '이전' },
    }), 'upsert');
    assert.equal(getScheduleRealtimePayloadKind({
      eventType: 'INSERT',
      new: {},
      old: {},
    }), 'unknown');
  });
});
