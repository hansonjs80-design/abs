import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  applyMonthlyShinjangSprayTherapists,
  buildShinjangSprayDefaultTherapists,
  buildShinjangSprayPrescriptions,
  buildShinjangSprayRecentMonthlySummaries,
  buildShinjangSpraySettlementSummary,
  isShinjangSprayPrescription,
  isWholeNumberShinjangSprayPrescription,
  mergeShinjangSprayLogs,
} from '../shinjangSprayStatsUtils.js';

describe('shinjang spray statistics', () => {
  it('builds the default shinjang roster by scheduler column', () => {
    assert.deepEqual(
      buildShinjangSprayDefaultTherapists({
        shockwaveTherapists: [
          { id: 's0', slot_index: 0, name: '충격파1' },
          { id: 's2', slot_index: 2, name: '충격파3' },
        ],
        manualTherapists: [
          { id: 'm0', slot_index: 0, name: '도수1' },
          { id: 'm1', slot_index: 1, name: '도수2' },
        ],
      }).map((therapist) => [therapist.slot_index, therapist.name]),
      [[0, '충격파1'], [1, '도수2'], [2, '충격파3']]
    );
  });

  it('reassigns scheduler-linked rows with the shinjang monthly therapist ranges', () => {
    const legacyRow = {
      id: 'legacy',
      date: '2026-09-12',
      therapist_name: '수동치료사',
      prescription: '수동(신장분사)',
    };
    const rows = applyMonthlyShinjangSprayTherapists([
      {
        id: 'first-half',
        date: '2026-09-12',
        therapist_name: '기존치료사',
        scheduler_cell_key: '2026:09:1:5:3:1',
      },
      {
        id: 'second-half',
        date: '2026-09-20',
        therapist_name: '기존치료사',
        scheduler_cell_key: '2026:09:2:6:3:1',
      },
      {
        id: 'inactive',
        date: '2026-09-20',
        therapist_name: '기존치료사',
        scheduler_cell_key: '2026:09:2:6:3:2',
      },
      legacyRow,
    ], [
      { slot_index: 1, therapist_name: '신장전반', start_day: 1, end_day: 15 },
      { slot_index: 1, therapist_name: '신장후반', start_day: 16, end_day: 30 },
      { slot_index: 2, therapist_name: '', start_day: 1, end_day: 30 },
    ]);

    assert.deepEqual(rows.map((row) => row.therapist_name), [
      '신장전반',
      '신장후반',
      '',
      '수동치료사',
    ]);
    assert.strictEqual(rows[3], legacyRow);
  });

  it('recognizes the marker with normalized width and spaces', () => {
    assert.equal(isShinjangSprayPrescription('F2.5 (신장분사)'), true);
    assert.equal(isShinjangSprayPrescription('도수（신장분사）'), true);
    assert.equal(isShinjangSprayPrescription('F3.0(신장분사DC)'), true);
    assert.equal(isShinjangSprayPrescription('특수 신장분사 처방'), true);
    assert.equal(isShinjangSprayPrescription('F2.5'), false);
  });

  it('distinguishes whole-number shinjang prescriptions from decimal prescriptions', () => {
    assert.equal(isWholeNumberShinjangSprayPrescription('신장분사 1'), true);
    assert.equal(isWholeNumberShinjangSprayPrescription('신장분사2'), true);
    assert.equal(isWholeNumberShinjangSprayPrescription('신장분사 2.0'), false);
    assert.equal(isWholeNumberShinjangSprayPrescription('신장분사 2.5'), false);
    assert.equal(isWholeNumberShinjangSprayPrescription('신장분사 3.0 DC'), false);
    assert.equal(isWholeNumberShinjangSprayPrescription('F3.0(신장분사DC)'), false);
  });

  it('combines both treatment logs and deduplicates the same scheduler cell', () => {
    const rows = mergeShinjangSprayLogs({
      shockwaveRows: [{
        id: 1,
        date: '2026-09-03',
        therapist_name: '주한솔',
        prescription: 'F2.5(신장분사)',
        scheduler_cell_key: '2026:9:0:1:2:3',
        created_at: '2026-09-03T01:00:00Z',
      }],
      manualTherapyRows: [
        {
          id: 2,
          date: '2026-09-03',
          therapist_name: '주한솔',
          prescription: '도수40(신장분사)',
          scheduler_cell_key: '2026:9:0:1:2:3',
          created_at: '2026-09-03T02:00:00Z',
        },
        {
          id: 3,
          date: '2026-09-04',
          therapist_name: '김치료',
          prescription: '일반도수',
        },
      ],
      shockwavePrescriptionPrices: { 'F2.5(신장분사)': 70000 },
      manualTherapyPrescriptionPrices: { '도수40(신장분사)': 90000 },
      manualTherapyCryoPrescriptions: ['도수40(신장분사)'],
      manualTherapyCryoPrices: { '도수40(신장분사)': 15000 },
    });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].treatment_type, 'manual_therapy');
    assert.equal(rows[0].unit_price, 90000);
    assert.equal(rows[0].cryo_price, 15000);
    assert.equal(rows[0].cryo_adjusted_unit_price, 75000);
  });

  it('keeps real log prescription names and uses a generic fallback before the first treatment', () => {
    const prescriptions = buildShinjangSprayPrescriptions({
      configuredPrescriptions: ['A(신장분사)', 'B(신장분사)', '일반처방'],
      rows: [
        { prescription: 'B(신장분사)' },
        { prescription: 'F3.0(신장분사DC)' },
      ],
    });
    assert.deepEqual(prescriptions, ['B(신장분사)', 'F3.0(신장분사DC)']);
    assert.deepEqual(buildShinjangSprayPrescriptions({ rows: [] }), ['신장분사']);
  });

  it('applies different incentive rates by prescription', () => {
    const prescriptions = ['A(신장분사)', 'B(신장분사)'];

    const summary = buildShinjangSpraySettlementSummary({
      rows: [
        { therapist_name: '주한솔', prescription: 'A(신장분사)', prescription_count: 2, unit_price: 50000 },
        { therapist_name: '주한솔', prescription: 'B(신장분사)', prescription_count: 1, unit_price: 80000 },
      ],
      prescriptions,
      therapists: [{ name: '주한솔' }],
      incentivePercentages: {
        'A(신장분사)': 5,
        'B(신장분사)': 12.5,
      },
    });

    assert.equal(summary.grandTotalCount, 3);
    assert.equal(summary.grandAmount, 180000);
    assert.equal(summary.grandIncentive, 15000);
    assert.deepEqual(
      summary.detailRows.map((row) => [row.prescription, row.incentive]),
      [['A(신장분사)', 5000], ['B(신장분사)', 10000]]
    );
  });

  it('subtracts source cryo prices before applying each prescription incentive', () => {
    const rows = mergeShinjangSprayLogs({
      shockwaveRows: [
        { therapist_name: '주한솔', prescription: 'A(신장분사)', prescription_count: 2 },
      ],
      manualTherapyRows: [
        { therapist_name: '주한솔', prescription: 'B(신장분사)', prescription_count: 1 },
      ],
      shockwavePrescriptionPrices: { 'A(신장분사)': 70000 },
      manualTherapyPrescriptionPrices: { 'B(신장분사)': 90000 },
      shockwaveCryoPrescriptions: ['A(신장분사)'],
      shockwaveCryoPrices: { 'A(신장분사)': 15000 },
      manualTherapyCryoPrescriptions: ['B(신장분사)'],
      manualTherapyCryoPrices: { 'B(신장분사)': 10000 },
    });
    const summary = buildShinjangSpraySettlementSummary({
      rows,
      prescriptions: ['A(신장분사)', 'B(신장분사)'],
      therapists: [{ name: '주한솔' }],
      incentivePercentages: {
        'A(신장분사)': 10,
        'B(신장분사)': 5,
      },
      isCryoAdjusted: true,
    });

    assert.equal(summary.grandBaseAmount, 230000);
    assert.equal(summary.grandCryoDeduction, 40000);
    assert.equal(summary.grandAmount, 190000);
    assert.equal(summary.grandIncentive, 15000);
  });

  it('builds recent monthly summaries with each month settings and restricted incentives', () => {
    const summaries = buildShinjangSprayRecentMonthlySummaries({
      monthTargets: [
        { year: 2026, month: 8 },
        { year: 2026, month: 9 },
      ],
      currentMonthKey: '2026-09',
      currentMonthRows: [
        {
          date: '2026-09-03',
          patient_name: '현재신환*',
          therapist_name: '주한솔',
          prescription: '신장분사 1',
          prescription_count: 1,
          unit_price: 100000,
          is_cryo: true,
          cryo_adjusted_unit_price: 90000,
        },
        {
          date: '2026-09-04',
          patient_name: '제한처방',
          therapist_name: '주한솔',
          prescription: '신장분사 2',
          prescription_count: 2,
          unit_price: 150000,
        },
      ],
      shockwaveRows: [
        {
          date: '2026-08-10',
          patient_name: '이전신환*',
          therapist_name: '이전이름',
          prescription: '신장분사 1',
          prescription_count: 2,
          scheduler_cell_key: '2026:08:0:1:0:0',
        },
      ],
      monthlySettingsByMonth: {
        '2026-08': {
          prescriptions: ['신장분사 1'],
          prescription_prices: { '신장분사 1': 80000 },
          cryo_prescriptions: ['신장분사 1'],
          cryo_prices: { '신장분사 1': 10000 },
          prescription_incentive_percentages: { '신장분사 1': 7 },
          therapist_names: ['과거치료사'],
        },
        '2026-09': {
          prescriptions: ['신장분사 1', '신장분사 2'],
          prescription_incentive_percentages: {
            '신장분사 1': 7,
            '신장분사 2': 15,
          },
        },
      },
      monthlyTherapistsByMonth: {
        '2026-08': [
          { slot_index: 0, therapist_name: '과거치료사', start_day: 1, end_day: 31 },
        ],
      },
      hiddenIncentivePercentages: [15],
    });

    assert.deepEqual(summaries, [
      {
        monthKey: '2026-09',
        label: '2026년 09월',
        totalCount: 1,
        amount: 100000,
        cryoAdjustedAmount: 90000,
        newPatientCount: 1,
      },
      {
        monthKey: '2026-08',
        label: '2026년 08월',
        totalCount: 2,
        amount: 160000,
        cryoAdjustedAmount: 140000,
        newPatientCount: 1,
      },
    ]);
  });
});
