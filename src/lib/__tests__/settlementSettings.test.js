import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getEffectiveSettlementSettings,
  setMonthlySettlementSettings,
} from '../settlementSettings.js';

describe('monthly settlement shortcut settings', () => {
  it('keeps an explicitly blank monthly shortcut instead of falling back to defaults', () => {
    const settings = {
      shortcuts: {
        'F/R': '1',
        'F1.5': '3',
      },
    };

    const monthly_settlement_settings = setMonthlySettlementSettings(settings, 2026, 7, 'shockwave', {
      prescriptions: ['F/R', 'F1.5'],
      shortcuts: {
        'F/R': '',
        'F1.5': '5',
      },
    });

    const effective = getEffectiveSettlementSettings({
      ...settings,
      monthly_settlement_settings,
    }, 2026, 7, 'shockwave');

    assert.equal(effective.shortcuts['F/R'], '');
    assert.equal(effective.shortcuts['F1.5'], '5');
  });
});
