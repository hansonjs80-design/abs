import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getManualTherapyIonTreatment,
  setManualTherapyIonTreatment,
} from '../manualTherapyIonTreatmentUtils.js';

describe('manual therapy ion treatment settings', () => {
  it('returns blank inputs when a month has no stored ion treatment values', () => {
    assert.deepEqual(getManualTherapyIonTreatment({}, 2026, 8), { count: '', amount: '' });
  });

  it('stores the monthly ion treatment values without replacing settlement settings', () => {
    const monthlySettings = setManualTherapyIonTreatment({
      monthly_settlement_settings: {
        '2026-08': {
          manual_therapy: { prescriptions: ['40분'] },
        },
      },
    }, 2026, 8, { count: '12', amount: '450000' });

    assert.deepEqual(monthlySettings['2026-08'].manual_therapy, { prescriptions: ['40분'] });
    assert.deepEqual(monthlySettings['2026-08'].manual_therapy_ion_treatment, {
      count: '12',
      amount: '450000',
    });
  });
});
