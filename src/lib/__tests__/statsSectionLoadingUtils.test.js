import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  isDisplayedStatsMonth,
  loadStatsMonthsTogether,
  shouldKeepStatsSectionMounted,
  shouldPrepareStatsSecondarySections,
} from '../statsSectionLoadingUtils.js';

describe('statistics secondary section preparation', () => {
  it('starts background preparation only after the primary data is ready', () => {
    assert.equal(shouldPrepareStatsSecondarySections({
      dataReady: false,
      isPrimaryLoading: false,
    }), false);
    assert.equal(shouldPrepareStatsSecondarySections({
      dataReady: true,
      isPrimaryLoading: true,
    }), false);
    assert.equal(shouldPrepareStatsSecondarySections({
      dataReady: true,
      isPrimaryLoading: false,
    }), true);
  });

  it('keeps a requested section visible even before background preparation', () => {
    assert.equal(shouldKeepStatsSectionMounted({
      activeSection: 'settlement',
      targetSection: 'settlement',
      secondarySectionsReady: false,
    }), true);
  });

  it('keeps secondary sections mounted in the background once primary loading finishes', () => {
    assert.equal(shouldKeepStatsSectionMounted({
      activeSection: 'grid',
      targetSection: 'settlement',
      secondarySectionsReady: true,
    }), true);
    assert.equal(shouldKeepStatsSectionMounted({
      activeSection: 'grid',
      targetSection: 'new-patients',
      secondarySectionsReady: false,
    }), false);
  });

  it('recognizes the displayed month so background history loading can skip duplicate sync', () => {
    assert.equal(isDisplayedStatsMonth({ year: 2026, month: 7 }, '2026', '7'), true);
    assert.equal(isDisplayedStatsMonth({ year: 2026, month: 6 }, 2026, 7), false);
  });

  it('starts every independent month together and preserves month order in the final result', async () => {
    const started = [];
    const finishes = new Map();
    const targets = [{ month: 5 }, { month: 6 }, { month: 7 }];
    const resultPromise = loadStatsMonthsTogether(targets, (target) => {
      started.push(target.month);
      return new Promise((resolve) => {
        finishes.set(target.month, resolve);
      });
    });

    assert.deepEqual(started, [5, 6, 7]);
    finishes.get(7)('July');
    finishes.get(5)('May');
    finishes.get(6)('June');

    assert.deepEqual(await resultPromise, ['May', 'June', 'July']);
  });
});
