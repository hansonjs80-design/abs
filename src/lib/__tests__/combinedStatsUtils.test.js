import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildCombinedStatsMonthSummary,
  buildCombinedStatsRecentBreakdown,
  buildCombinedStatsRecentTotal,
} from '../combinedStatsUtils.js';

const therapists = [
  { id: 'a', name: '주한솔', slot_index: 0 },
  { id: 'b', name: '신수민', slot_index: 1 },
];

const settings = {
  monthly_settlement_settings: {
    '2026-09': {
      shockwave: {
        prescriptions: ['F3.0', 'S7(신장분사)', 'S15(신장분사)'],
        prescription_prices: { 'F3.0': 100000 },
        cryo_prescriptions: ['F3.0'],
        cryo_prices: { 'F3.0': 20000 },
        hidden_prescriptions: [],
        incentive_percentage: 10,
        incentive_overridden: true,
      },
      manual_therapy: {
        prescriptions: ['40분'],
        prescription_prices: { '40분': 200000 },
        cryo_prescriptions: ['40분'],
        cryo_prices: { '40분': 50000 },
        hidden_prescriptions: [],
        incentive_percentage: 5,
        incentive_overridden: true,
      },
      shinjang_spray: {
        prescriptions: ['S7(신장분사)', 'S15(신장분사)'],
        prescription_prices: { 'S7(신장분사)': 300000, 'S15(신장분사)': 400000 },
        cryo_prescriptions: ['S7(신장분사)'],
        cryo_prices: { 'S7(신장분사)': 30000 },
        hidden_prescriptions: [],
        prescription_incentive_percentages: {
          'S7(신장분사)': 7,
          'S15(신장분사)': 15,
        },
        therapist_names: ['주한솔', '신수민'],
      },
    },
  },
};

const shockwaveRows = [
  { therapist_name: '주한솔', prescription: 'F3.0', prescription_count: 2 },
  { therapist_name: '주한솔', prescription: 'S7(신장분사)', prescription_count: 1 },
  { therapist_name: '신수민', prescription: 'S15(신장분사)', prescription_count: 1 },
];
const manualTherapyRows = [
  { therapist_name: '주한솔', prescription: '40분', prescription_count: 1 },
];

describe('combined statistics', () => {
  it('uses cryo-adjusted totals and hides 15 percent shinjang and manual rows from non-admin settlements', () => {
    const summary = buildCombinedStatsMonthSummary({
      year: 2026,
      month: 9,
      shockwaveRows,
      manualTherapyRows,
      shockwaveTherapists: therapists,
      manualTherapists: therapists,
      settings,
      isAdmin: false,
    });

    const primary = summary.therapists.find((item) => item.therapist.name === '주한솔');
    const hidden = summary.therapists.find((item) => item.therapist.name === '신수민');
    assert.deepEqual(primary.treatments.shockwave, { count: 2, amount: 160000, incentive: 16000 });
    assert.deepEqual(primary.treatments.shinjang_spray, { count: 1, amount: 270000, incentive: 18900 });
    assert.deepEqual(primary.treatments.manual_therapy, { count: 0, amount: 0, incentive: 0 });
    assert.deepEqual(primary.incentiveRates, {
      shockwave: [10],
      shinjang_spray: [7],
      manual_therapy: [],
    });
    assert.deepEqual(primary.shinjangIncentiveGroups, [
      { rate: 7, count: 1, amount: 270000, incentive: 18900 },
    ]);
    assert.deepEqual(summary.treatmentTotals, {
      shockwave: { count: 2, amount: 160000, incentive: 16000 },
      shinjang_spray: { count: 1, amount: 270000, incentive: 18900 },
      manual_therapy: { count: 0, amount: 0, incentive: 0 },
    });
    assert.deepEqual(summary.shinjangIncentiveGroups, [
      { rate: 7, count: 1, amount: 270000, incentive: 18900 },
    ]);
    assert.deepEqual(primary.total, { count: 3, amount: 430000, incentive: 34900 });
    assert.deepEqual(hidden.total, { count: 0, amount: 0, incentive: 0 });
    assert.equal(summary.totalCount, 3);
    assert.equal(summary.amount, 430000);
    assert.equal(summary.incentive, 34900);
  });

  it('includes 15 percent shinjang rows for administrators', () => {
    const summary = buildCombinedStatsMonthSummary({
      year: 2026,
      month: 9,
      shockwaveRows,
      manualTherapyRows,
      shockwaveTherapists: therapists,
      manualTherapists: therapists,
      settings,
      isAdmin: true,
    });

    const secondary = summary.therapists.find((item) => item.therapist.name === '신수민');
    assert.deepEqual(secondary.treatments.shinjang_spray, {
      count: 1,
      amount: 400000,
      incentive: 60000,
    });
    assert.deepEqual(secondary.incentiveRates.shinjang_spray, [15]);
    assert.deepEqual(summary.shinjangIncentiveGroups, [
      { rate: 7, count: 1, amount: 270000, incentive: 18900 },
      { rate: 15, count: 1, amount: 400000, incentive: 60000 },
    ]);
    assert.equal(summary.totalCount, 5);
    assert.equal(summary.amount, 980000);
    assert.equal(summary.incentive, 102400);
  });

  it('adds recent month counts, settlement amounts, and incentives', () => {
    assert.deepEqual(buildCombinedStatsRecentTotal([
      { totalCount: 4, amount: 580000, incentive: 42400 },
      { totalCount: 5, amount: 720000, incentive: 61000 },
    ]), {
      count: 9,
      amount: 1300000,
      incentive: 103400,
    });
  });

  it('adds recent treatment totals and keeps dynamic shinjang incentive groups separate', () => {
    const september = buildCombinedStatsMonthSummary({
      year: 2026,
      month: 9,
      shockwaveRows,
      manualTherapyRows,
      shockwaveTherapists: therapists,
      manualTherapists: therapists,
      settings,
      isAdmin: true,
    });
    const octoberSettings = structuredClone(settings);
    octoberSettings.monthly_settlement_settings['2026-10'] = structuredClone(
      octoberSettings.monthly_settlement_settings['2026-09']
    );
    const octoberShinjang = octoberSettings.monthly_settlement_settings['2026-10'].shinjang_spray;
    octoberShinjang.prescriptions = ['S12(신장분사)'];
    octoberShinjang.prescription_incentive_percentages = { 'S12(신장분사)': 12 };
    const october = buildCombinedStatsMonthSummary({
      year: 2026,
      month: 10,
      shockwaveRows: [
        { therapist_name: '주한솔', prescription: 'S12(신장분사)', prescription_count: 2 },
      ],
      shockwaveTherapists: therapists,
      manualTherapists: therapists,
      settings: octoberSettings,
      isAdmin: true,
    });

    const recent = buildCombinedStatsRecentBreakdown([september, october]);
    assert.deepEqual(recent.treatmentTotals, {
      shockwave: { count: 2, amount: 160000, incentive: 16000 },
      shinjang_spray: { count: 4, amount: 670000, incentive: 78900 },
      manual_therapy: { count: 1, amount: 150000, incentive: 7500 },
    });
    assert.deepEqual(recent.shinjangIncentiveGroups, [
      { rate: 7, count: 1, amount: 270000, incentive: 18900 },
      { rate: 12, count: 2, amount: 0, incentive: 0 },
      { rate: 15, count: 1, amount: 400000, incentive: 60000 },
    ]);
    assert.deepEqual(recent.total, { count: 7, amount: 980000, incentive: 102400 });
  });

  it('matches the shockwave tab by rounding incentives per prescription', () => {
    const decimalSettings = {
      monthly_settlement_settings: {
        '2026-09': {
          shockwave: {
            prescriptions: ['A', 'B'],
            prescription_prices: { A: 5, B: 5 },
            cryo_prescriptions: [],
            cryo_prices: {},
            hidden_prescriptions: [],
            incentive_percentage: 10,
            incentive_overridden: true,
          },
        },
      },
    };
    const summary = buildCombinedStatsMonthSummary({
      year: 2026,
      month: 9,
      shockwaveRows: [
        { therapist_name: '주한솔', prescription: 'A', prescription_count: 1 },
        { therapist_name: '주한솔', prescription: 'B', prescription_count: 1 },
      ],
      shockwaveTherapists: therapists.slice(0, 1),
      settings: decimalSettings,
      isAdmin: true,
    });

    assert.equal(summary.incentive, 2);
  });

  it('does not create a therapist from a stale standard-treatment log', () => {
    const summary = buildCombinedStatsMonthSummary({
      year: 2026,
      month: 9,
      shockwaveRows: [
        { therapist_name: '과거치료사', prescription: 'F3.0', prescription_count: 1 },
      ],
      shockwaveTherapists: therapists,
      manualTherapists: therapists,
      settings,
      isAdmin: true,
    });

    assert.equal(
      summary.therapists.some((item) => item.therapist.name === '과거치료사'),
      false
    );
  });

  it('updates the displayed shinjang incentive rates from the active prescription list', () => {
    const dynamicSettings = structuredClone(settings);
    const shinjangSettings = dynamicSettings.monthly_settlement_settings['2026-09'].shinjang_spray;
    shinjangSettings.prescriptions = ['S7(신장분사)', 'S12(신장분사)'];
    shinjangSettings.prescription_incentive_percentages = {
      'S7(신장분사)': 7,
      'S12(신장분사)': 12,
    };
    shinjangSettings.hidden_prescriptions = ['S15(신장분사)'];

    const summary = buildCombinedStatsMonthSummary({
      year: 2026,
      month: 9,
      shockwaveRows: [
        ...shockwaveRows,
        { therapist_name: '주한솔', prescription: 'S12(신장분사)', prescription_count: 1 },
      ],
      manualTherapyRows,
      shockwaveTherapists: therapists,
      manualTherapists: therapists,
      settings: dynamicSettings,
      isAdmin: true,
    });

    assert.deepEqual(summary.therapists[0].incentiveRates.shinjang_spray, [7, 12]);
  });

  it('stacks every distinct shinjang incentive rate completed by one therapist', () => {
    const summary = buildCombinedStatsMonthSummary({
      year: 2026,
      month: 9,
      shockwaveRows: [
        ...shockwaveRows,
        { therapist_name: '주한솔', prescription: 'S15(신장분사)', prescription_count: 1 },
      ],
      manualTherapyRows,
      shockwaveTherapists: therapists,
      manualTherapists: therapists,
      settings,
      isAdmin: true,
    });

    const primary = summary.therapists.find((item) => item.therapist.name === '주한솔');
    assert.deepEqual(primary.incentiveRates.shinjang_spray, [7, 15]);
    assert.deepEqual(primary.shinjangIncentiveGroups, [
      { rate: 7, count: 1, amount: 270000, incentive: 18900 },
      { rate: 15, count: 1, amount: 400000, incentive: 60000 },
    ]);
  });
});
