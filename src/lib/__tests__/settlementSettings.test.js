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

  it('uses only shortcuts for prescriptions active in the effective month', () => {
    const settings = {
      prescriptions: ['F/Rdc', 'F1.5'],
      shortcuts: {
        'F/Rdc': '2',
        'F1.5': '3',
      },
    };

    const monthly_settlement_settings = setMonthlySettlementSettings(settings, 2026, 7, 'shockwave', {
      prescriptions: ['F2.0'],
      shortcuts: {
        'F2.0': '2',
      },
    });

    const effective = getEffectiveSettlementSettings({
      ...settings,
      monthly_settlement_settings,
    }, 2026, 7, 'shockwave');

    assert.equal(effective.shortcuts['F2.0'], '2');
    assert.equal(effective.shortcuts['F/Rdc'], undefined);
    assert.deepEqual(Object.keys(effective.shortcuts), ['F2.0']);
  });
});
