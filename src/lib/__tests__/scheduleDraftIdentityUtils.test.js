import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getShockwaveScheduleDraftIdentities,
  isShockwaveScheduleItemVisibleInView,
} from '../scheduleDraftIdentityUtils.js';

describe('shockwave schedule draft identities', () => {
  it('keeps one identity for a current-month cell', () => {
    const identities = getShockwaveScheduleDraftIdentities({
      year: 2026,
      month: 7,
      week_index: 2,
      day_index: 3,
      row_index: 4,
      col_index: 1,
    });

    assert.deepEqual(identities, [
      { year: 2026, month: 7, key: '2-3-4-1' },
    ]);
  });

  it('tracks both visible and canonical identities for an adjacent-month cell', () => {
    const identities = getShockwaveScheduleDraftIdentities({
      year: 2026,
      month: 7,
      week_index: 0,
      day_index: 1,
      row_index: 4,
      col_index: 1,
    });

    assert.deepEqual(identities, [
      { year: 2026, month: 7, key: '0-1-4-1' },
      { year: 2026, month: 6, key: '4-1-4-1' },
    ]);
  });

  it('accepts adjacent-month coordinates as active visible cells', () => {
    assert.equal(isShockwaveScheduleItemVisibleInView({
      year: 2026,
      month: 7,
      week_index: 0,
      day_index: 1,
      row_index: 4,
      col_index: 1,
    }, 2026, 7), true);

    assert.equal(isShockwaveScheduleItemVisibleInView({
      year: 2026,
      month: 6,
      week_index: 4,
      day_index: 1,
      row_index: 4,
      col_index: 1,
    }, 2026, 7), false);
  });
});
