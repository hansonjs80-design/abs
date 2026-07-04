import test from 'node:test';
import assert from 'node:assert/strict';

import { buildShockwaveIntervalRealignmentUpdates } from '../scheduleIntervalRealignmentUtils.js';

const settings15 = {
  start_time: '09:00',
  end_time: '10:00',
  interval_minutes: 15,
  time_label_interval_minutes: 15,
};

test('buildShockwaveIntervalRealignmentUpdates moves a timed cell to the closest new slot', () => {
  const updates = buildShockwaveIntervalRealignmentUpdates([
    {
      id: 'row-1',
      week_index: 0,
      day_index: 1,
      row_index: 1,
      col_index: 2,
      merge_span: {
        rowSpan: 1,
        colSpan: 1,
        mergedInto: null,
        meta: { reservation_time: '09:29' },
      },
    },
  ], settings15);

  assert.equal(updates.length, 1);
  assert.equal(updates[0].id, 'row-1');
  assert.equal(updates[0].row_index, 2);
  assert.equal(updates[0].merge_span.meta.reservation_time, '09:29');
});

test('buildShockwaveIntervalRealignmentUpdates adjusts merged children with the moved master', () => {
  const updates = buildShockwaveIntervalRealignmentUpdates([
    {
      id: 'master',
      week_index: 0,
      day_index: 1,
      row_index: 1,
      col_index: 2,
      merge_span: {
        rowSpan: 2,
        colSpan: 1,
        mergedInto: null,
        meta: { reservation_time: '09:30' },
      },
    },
    {
      id: 'child',
      week_index: 0,
      day_index: 1,
      row_index: 2,
      col_index: 2,
      merge_span: {
        rowSpan: 1,
        colSpan: 1,
        mergedInto: '0-1-1-2',
      },
    },
  ], settings15);

  assert.deepEqual(updates.map((item) => item.id), ['child', 'master']);
  assert.equal(updates.find((item) => item.id === 'master').row_index, 2);
  const childUpdate = updates.find((item) => item.id === 'child');
  assert.equal(childUpdate.row_index, 3);
  assert.equal(childUpdate.merge_span.mergedInto, '0-1-2-2');
});

test('buildShockwaveIntervalRealignmentUpdates skips moves into occupied cells', () => {
  const updates = buildShockwaveIntervalRealignmentUpdates([
    {
      id: 'row-1',
      week_index: 0,
      day_index: 1,
      row_index: 0,
      col_index: 2,
      merge_span: {
        rowSpan: 1,
        colSpan: 1,
        mergedInto: null,
        meta: { reservation_time: '09:15' },
      },
    },
    {
      id: 'occupied',
      week_index: 0,
      day_index: 1,
      row_index: 1,
      col_index: 2,
      content: '이미 예약',
      merge_span: {
        rowSpan: 1,
        colSpan: 1,
        mergedInto: null,
      },
    },
  ], settings15);

  assert.deepEqual(updates, []);
});
