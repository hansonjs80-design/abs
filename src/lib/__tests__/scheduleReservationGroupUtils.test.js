import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildClearReservationGroupPayload,
  buildMergeSpanWithReservationGroup,
  getReservationGroupFromMergeSpan,
  RESERVATION_GROUP_SAME,
} from '../scheduleReservationGroupUtils.js';

const BASE_SPAN = { rowSpan: 1, colSpan: 1, mergedInto: null };

function groupedSpan(index) {
  return buildMergeSpanWithReservationGroup(BASE_SPAN, {
    id: 'group-1',
    mode: RESERVATION_GROUP_SAME,
    anchorKey: '0-0-10-1',
    baseTime: '10:00',
    reservationTime: '10:00',
    index,
    size: 2,
    minRow: 10,
    maxRow: 11,
    minCol: 1,
    maxCol: 1,
  });
}

describe('schedule reservation group helpers', () => {
  it('clears the whole same-time group while preserving pending display content', () => {
    const memos = {
      '0-0-10-1': {
        content: '345/이지솔(3)',
        merge_span: groupedSpan(0),
      },
      '0-0-11-1': {
        content: '',
        merge_span: groupedSpan(1),
      },
    };
    const pendingDisplayValues = {
      '0-0-11-1': '444/주한솔(2)',
    };

    const batch = buildClearReservationGroupPayload({
      keys: new Set(['0-0-10-1']),
      memos,
      pendingDisplayValues,
      currentYear: 2026,
      currentMonth: 7,
    });

    assert.equal(batch.payload.length, 2);
    const lower = batch.payload.find((item) => item.row_index === 11);
    assert.equal(lower.content, '444/주한솔(2)');
    assert.equal(getReservationGroupFromMergeSpan(lower.merge_span), null);
  });
});
