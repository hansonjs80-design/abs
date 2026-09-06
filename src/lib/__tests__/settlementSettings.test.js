import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildPrescriptionClassificationSignature,
  getEffectiveSettlementSettings,
  getEffectiveShinjangSpraySettings,
  setMonthlySettlementSettings,
  setMonthlyShinjangSpraySettings,
} from '../settlementSettings.js';
import {
  getPrescriptionScheduleSettings,
  getScheduleItemTreatmentGroup,
} from '../prescriptionScheduleSettings.js';

describe('monthly settlement shortcut settings', () => {
  it('stores and inherits per-prescription shinjang spray incentive percentages', () => {
    const settings = {
      monthly_settlement_settings: {
        '2026-08': {
          shockwave: { prescriptions: ['F2.5(신장분사)'] },
        },
      },
    };
    const monthly_settlement_settings = setMonthlyShinjangSpraySettings(
      settings,
      2026,
      9,
      {
        prescriptions: ['F2.5(신장분사)', '도수 40분(신장분사)'],
        prescription_incentive_percentages: {
          'F2.5(신장분사)': 7.5,
          '도수 40분(신장분사)': 11,
        },
        therapist_names: ['주한솔', ' 김치료 ', '주한솔'],
      }
    );
    const nextSettings = { ...settings, monthly_settlement_settings };

    assert.deepEqual(
      monthly_settlement_settings['2026-08'].shockwave,
      { prescriptions: ['F2.5(신장분사)'] }
    );
    assert.deepEqual(
      getEffectiveShinjangSpraySettings(nextSettings, 2026, 10).prescription_incentive_percentages,
      {
        'F2.5(신장분사)': 7.5,
        '도수 40분(신장분사)': 11,
      }
    );
    assert.deepEqual(
      getEffectiveShinjangSpraySettings(nextSettings, 2026, 10).therapist_names,
      ['주한솔', '김치료']
    );
  });

  it('uses every available shinjang spray therapist until a monthly list is saved', () => {
    assert.equal(
      getEffectiveShinjangSpraySettings({}, 2026, 9).therapist_names,
      null
    );
  });

  it('keeps an explicitly emptied shinjang prescription list empty for the scheduler', () => {
    const monthly_settlement_settings = setMonthlyShinjangSpraySettings({}, 2026, 9, {
      prescriptions: [],
      therapist_names: ['주한솔'],
    });
    const settings = { monthly_settlement_settings };

    assert.deepEqual(getEffectiveShinjangSpraySettings(settings, 2026, 9).prescriptions, []);
    assert.deepEqual(
      getPrescriptionScheduleSettings(settings, 2026, 9).schedulerPrescriptions.shinjangSpray,
      []
    );
  });

  it('routes marker prescriptions to the independent shinjang spray group', () => {
    const settings = {
      prescriptions: ['F/R'],
      monthly_settlement_settings: {
        '2026-09': {
          shinjang_spray: {
            prescriptions: ['F3.0(신장분사DC)'],
            prescription_prices: { 'F3.0(신장분사DC)': 95000 },
          },
        },
      },
    };
    const effective = getEffectiveShinjangSpraySettings(settings, 2026, 9);
    const schedule = getPrescriptionScheduleSettings(settings, 2026, 9);

    assert.deepEqual(effective.prescriptions, ['F3.0(신장분사DC)']);
    assert.equal(effective.prescription_prices['F3.0(신장분사DC)'], 95000);
    assert.deepEqual(schedule.schedulerPrescriptions.shinjangSpray, ['F3.0(신장분사DC)']);
    assert.equal(schedule.schedulerPrescriptions.shockwave.includes('F3.0(신장분사DC)'), false);
    assert.equal(
      getScheduleItemTreatmentGroup({ prescription: 'F3.0(신장분사DC)' }, settings, 2026, 9),
      'shinjang_spray'
    );
  });

  it('stores an independent shinjang spray prescription, cryo price, color, and incentive', () => {
    const monthly_settlement_settings = setMonthlyShinjangSpraySettings({}, 2026, 9, {
      prescriptions: ['맞춤 신장분사'],
      prescription_prices: { '맞춤 신장분사': 80000 },
      cryo_prescriptions: ['맞춤 신장분사'],
      cryo_prices: { '맞춤 신장분사': 12000 },
      prescription_colors: { '맞춤 신장분사': '#123456' },
      prescription_incentive_percentages: { '맞춤 신장분사': 8.5 },
      shortcuts: { '맞춤 신장분사': 'A' },
      dose_tags: { '맞춤 신장분사': 'S' },
      duration_minutes: { '맞춤 신장분사': 30 },
      visit_line_break_prescriptions: ['맞춤 신장분사'],
      hidden_prescriptions: ['맞춤 신장분사'],
      therapist_names: ['주한솔'],
    });
    const effective = getEffectiveShinjangSpraySettings({ monthly_settlement_settings }, 2026, 10);

    assert.deepEqual(effective.prescriptions, ['맞춤 신장분사']);
    assert.equal(effective.prescription_prices['맞춤 신장분사'], 80000);
    assert.deepEqual(effective.cryo_prescriptions, ['맞춤 신장분사']);
    assert.equal(effective.cryo_prices['맞춤 신장분사'], 12000);
    assert.equal(effective.prescription_colors['맞춤 신장분사'], '#123456');
    assert.equal(effective.prescription_incentive_percentages['맞춤 신장분사'], 8.5);
    assert.equal(effective.shortcuts['맞춤 신장분사'], 'A');
    assert.equal(effective.dose_tags['맞춤 신장분사'], 'S');
    assert.equal(effective.duration_minutes['맞춤 신장분사'], 30);
    assert.deepEqual(effective.visit_line_break_prescriptions, ['맞춤 신장분사']);
    assert.deepEqual(effective.hidden_prescriptions, ['맞춤 신장분사']);
  });

  it('stores and inherits cryo selections and prices separately for each treatment type', () => {
    const settings = {
      prescriptions: ['F2.5', 'F4.0'],
      manual_therapy_prescriptions: ['40분', '60분'],
    };
    const shockwaveMonthlySettings = setMonthlySettlementSettings(
      settings,
      2026,
      9,
      'shockwave',
      {
        prescriptions: ['F2.5', 'F4.0'],
        cryo_prescriptions: ['F2.5'],
        cryo_prices: {
          'F2.5': 15000,
          'F4.0': 20000,
        },
      }
    );
    const monthly_settlement_settings = setMonthlySettlementSettings(
      { ...settings, monthly_settlement_settings: shockwaveMonthlySettings },
      2026,
      9,
      'manual_therapy',
      {
        prescriptions: ['40분', '60분'],
        cryo_prescriptions: ['60분'],
        cryo_prices: {
          '40분': 10000,
          '60분': 12000,
        },
      }
    );
    const nextSettings = { ...settings, monthly_settlement_settings };

    const shockwave = getEffectiveSettlementSettings(nextSettings, 2026, 10, 'shockwave');
    const manualTherapy = getEffectiveSettlementSettings(nextSettings, 2026, 10, 'manual_therapy');

    assert.deepEqual(shockwave.cryo_prescriptions, ['F2.5']);
    assert.deepEqual(shockwave.cryo_prices, { 'F2.5': 15000, 'F4.0': 20000 });
    assert.deepEqual(manualTherapy.cryo_prescriptions, ['60분']);
    assert.deepEqual(manualTherapy.cryo_prices, { '40분': 10000, '60분': 12000 });
  });

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

  it('excludes hidden manual therapy prescriptions from scheduler automation', () => {
    const settings = {
      manual_therapy_prescriptions: ['40분', '60분'],
      manual_therapy_dose_tags: {
        '40분': '40',
        '60분': '60',
      },
      manual_therapy_duration_minutes: {
        '40분': 40,
        '60분': 60,
      },
    };

    const monthly_settlement_settings = setMonthlySettlementSettings(settings, 2026, 7, 'manual_therapy', {
      prescriptions: ['30분'],
      hidden_prescriptions: ['40분', '60분'],
      dose_tags: {
        '30분': '30',
      },
      duration_minutes: {
        '30분': 30,
      },
    });

    const config = getPrescriptionScheduleSettings({
      ...settings,
      monthly_settlement_settings,
    }, 2026, 7);

    assert.deepEqual(config.manualTherapy.prescriptions, ['30분']);
    assert.deepEqual(config.manualTherapy.hidden_prescriptions, ['40분', '60분']);
    assert(config.schedulerPrescriptions.manualTherapy.includes('30분'));
    assert.equal(config.schedulerPrescriptions.manualTherapy.includes('40분'), false);
    assert.equal(config.schedulerPrescriptions.manualTherapy.includes('60분'), false);
    assert.equal(config.schedulerPrescriptions.all.includes('40분'), false);
    assert.equal(config.schedulerPrescriptions.all.includes('60분'), false);
    assert.deepEqual(config.doseTags, { '30분': '30' });
    assert.deepEqual(config.durationMinutesMap, { '30분': 30 });
  });

  it('routes configured manual therapy prescriptions away from shockwave stats', () => {
    const settings = {
      prescriptions: ['F/R'],
      manual_therapy_prescriptions: ['맞춤 도수'],
      manual_therapy_dose_tags: {
        '맞춤 도수': 'MT30',
      },
    };

    assert.equal(
      getScheduleItemTreatmentGroup({
        content: '12345/홍길동(2)',
        prescription: ' 맞춤-도수 ',
      }, settings, 2026, 7),
      'manual_therapy'
    );
    assert.equal(
      getScheduleItemTreatmentGroup({
        content: '12345/홍길동MT30(2)',
      }, settings, 2026, 7),
      'manual_therapy'
    );
    assert.equal(
      getScheduleItemTreatmentGroup({
        content: '12345/홍길동(2)',
        prescription: 'F/R',
      }, settings, 2026, 7),
      'shockwave'
    );
  });

  it('changes the stats sync signature when a target month prescription changes', () => {
    const baseSettings = {
      prescriptions: ['F2.5'],
      manual_therapy_prescriptions: ['이전도수'],
      manual_therapy_dose_tags: { 이전도수: 'OLD' },
    };
    const targets = [{ year: 2026, month: 9 }];
    const before = buildPrescriptionClassificationSignature(baseSettings, targets);
    const monthly_settlement_settings = setMonthlySettlementSettings(
      baseSettings,
      2026,
      9,
      'manual_therapy',
      {
        prescriptions: ['이번달도수'],
        dose_tags: { 이번달도수: 'NEW' },
      }
    );
    const after = buildPrescriptionClassificationSignature({
      ...baseSettings,
      monthly_settlement_settings,
    }, targets);

    assert.notEqual(after, before);
    assert.equal(
      buildPrescriptionClassificationSignature({
        ...baseSettings,
        device_settings: { browser: { rowHeight: 32 } },
      }, targets),
      before
    );
  });
});
