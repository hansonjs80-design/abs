import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  canonicalizeShockwaveScheduleItemDate,
  mapShockwaveScheduleItemToVisibleMonth,
} from '../shockwaveScheduleDateMapping.js';

describe('shockwave schedule date mapping', () => {
  it('remaps hidden relocation source keys across visible month boundaries', () => {
    const canonicalJuneItem = {
      year: 2026,
      month: 6,
      week_index: 4,
      day_index: 1,
      row_index: 11,
      col_index: 2,
      content: '222/이동됨',
      merge_span: {
        rowSpan: 1,
        colSpan: 1,
        mergedInto: null,
        meta: { relocated_from_hidden_merge_cell: '4-1-10-2' },
      },
    };

    const visibleInJuly = mapShockwaveScheduleItemToVisibleMonth(canonicalJuneItem, 2026, 7);
    assert.equal(visibleInJuly.week_index, 0);
    assert.equal(visibleInJuly.day_index, 1);
    assert.equal(visibleInJuly.merge_span.meta.relocated_from_hidden_merge_cell, '0-1-10-2');

    const canonicalAgain = canonicalizeShockwaveScheduleItemDate(visibleInJuly);
    assert.equal(canonicalAgain.year, 2026);
    assert.equal(canonicalAgain.month, 6);
    assert.equal(canonicalAgain.week_index, 4);
    assert.equal(canonicalAgain.day_index, 1);
    assert.equal(canonicalAgain.merge_span.meta.relocated_from_hidden_merge_cell, '4-1-10-2');
  });
});
