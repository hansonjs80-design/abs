import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getRecentManualTherapyIonTreatmentMonths,
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

  it('keeps prior month records while a new month starts blank', () => {
    const settings = {
      monthly_settlement_settings: {
        '2026-08': {
          manual_therapy_ion_treatment: { count: '12', amount: '1200000' },
        },
      },
    };

    const months = getRecentManualTherapyIonTreatmentMonths(settings, 2026, 9, 3);

    assert.deepEqual(months.map(({ year, month, value }) => ({ year, month, value })), [
      { year: 2026, month: 9, value: { count: '', amount: '' } },
      { year: 2026, month: 8, value: { count: '12', amount: '1200000' } },
      { year: 2026, month: 7, value: { count: '', amount: '' } },
    ]);
  });
});
