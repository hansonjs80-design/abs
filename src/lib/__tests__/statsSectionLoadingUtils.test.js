import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  isDisplayedStatsMonth,
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
});
