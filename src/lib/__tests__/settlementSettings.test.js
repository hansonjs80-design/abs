import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getEffectiveSettlementSettings,
  setMonthlySettlementSettings,
} from '../settlementSettings.js';
import { getPrescriptionScheduleSettings } from '../prescriptionScheduleSettings.js';

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

  it('keeps hidden manual therapy prescriptions available for scheduler automation', () => {
    const settings = {
      manual_therapy_prescriptions: ['40분', '60분'],
      manual_therapy_dose_tags: {
        '40분': '40',
        '60분': '60',
      },
    };

    const monthly_settlement_settings = setMonthlySettlementSettings(settings, 2026, 7, 'manual_therapy', {
      prescriptions: ['30분'],
      hidden_prescriptions: ['40분', '60분'],
      dose_tags: {
        '30분': '30',
      },
    });

    const config = getPrescriptionScheduleSettings({
      ...settings,
      monthly_settlement_settings,
    }, 2026, 7);

    assert.deepEqual(config.manualTherapy.prescriptions, ['30분']);
    assert.deepEqual(config.manualTherapy.hidden_prescriptions, ['40분', '60분']);
    assert(config.schedulerPrescriptions.manualTherapy.includes('30분'));
    assert(config.schedulerPrescriptions.manualTherapy.includes('40분'));
    assert(config.schedulerPrescriptions.manualTherapy.includes('60분'));
    assert(config.schedulerPrescriptions.all.includes('40분'));
    assert(config.schedulerPrescriptions.all.includes('60분'));
  });
});
