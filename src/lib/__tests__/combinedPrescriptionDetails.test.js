import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCombinedPrescriptionDetails, buildCombinedRateTotals } from '../combinedPrescriptionDetails.js';

const summary = { therapists: [
  { prescriptionGroups: {
    shockwave: [{ prescription: 'F1.5', rate: 7, count: 2, amount: 101, incentive: 7 }],
    shinjang_spray: [
      { prescription: '신장분사 2.5', rate: 7, count: 1, amount: 100, incentive: 7 },
      { prescription: '신장분사 1', rate: 15, count: 2, amount: 200, incentive: 30 },
      { prescription: '신장분사 C', rate: 7, count: 0, amount: 0, incentive: 0 },
    ],
    manual_therapy: [{ prescription: '도수 30', rate: 15, count: 1, amount: 100, incentive: 15 }],
  } },
  { prescriptionGroups: {
    shockwave: [{ prescription: 'F1.5', rate: 7, count: 1, amount: 101, incentive: 7 }],
    shinjang_spray: [{ prescription: '신장분사 2.5', rate: 7, count: 3, amount: 300, incentive: 21 }],
  } },
] };

test('combines therapists without rerounding settled incentives', () => {
  const rows = buildCombinedPrescriptionDetails(summary, 'shockwave');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].label, 'F1.5');
  assert.equal(rows[0].count, 3);
  assert.equal(rows[0].amount, 202);
  assert.equal(rows[0].incentive, 14);
});

test('separates Shinjang rates, shortens names, and excludes uncounted prescriptions', () => {
  const rows = buildCombinedPrescriptionDetails(summary, 'shinjang_spray', 7, true);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].label, '신장 2.5');
  assert.equal(rows[0].count, 4);
  assert.equal(rows[0].amount, 400);
  assert.equal(rows[0].incentive, 28);
  assert.equal(buildCombinedPrescriptionDetails(summary, 'shinjang_spray', 15, true)[0].label, '신장 1');
});

test('preserves administrator-only visibility and handles empty summaries', () => {
  assert.deepEqual(buildCombinedPrescriptionDetails(summary, 'shinjang_spray', 15), []);
  assert.deepEqual(buildCombinedPrescriptionDetails(summary, 'manual_therapy'), []);
  assert.equal(buildCombinedPrescriptionDetails(summary, 'manual_therapy', undefined, true).length, 1);
  assert.deepEqual(buildCombinedPrescriptionDetails(null, 'shockwave'), []);
});


test('rate subtotals sum category totals once and retain settled rounding', () => {
  const data = {
    treatmentTotals: {
      shockwave: { count: 55, amount: 5110000, incentive: 357700 },
      manual_therapy: { count: 13, amount: 541541, incentive: 81231 },
    },
    shinjangIncentiveGroups: [
      { rate: '7', count: 16, amount: 1515000, incentive: 106050 },
      { rate: 15, count: 9, amount: 1000000, incentive: 150000 },
    ],
    therapists: summary.therapists,
  };
  const totals = buildCombinedRateTotals(data, true);
  assert.deepEqual(totals, [
    { rate: 7, count: 71, amount: 6625000, incentive: 463750 },
    { rate: 15, count: 22, amount: 1541541, incentive: 231231 },
  ]);
  assert.equal(totals.reduce((sum, row) => sum + row.count, 0), 93);
  assert.equal(totals.reduce((sum, row) => sum + row.amount, 0), 8166541);
  assert.equal(totals.reduce((sum, row) => sum + row.incentive, 0), 694981);
  assert.deepEqual(buildCombinedRateTotals(data, false), [totals[0]]);
});

test('empty rate subtotals stay visible with zero values', () => {
  assert.deepEqual(buildCombinedRateTotals(null, true), [
    { rate: 7, count: 0, amount: 0, incentive: 0 },
    { rate: 15, count: 0, amount: 0, incentive: 0 },
  ]);
});

test('summary follows the named therapist in each layout even if ordering changes', async () => {
  const { getCombinedSummaryAnchorIndex } = await import('../combinedPrescriptionDetails.js');
  const therapists = ['신수민', '김세령', '주한솔'].map((name) => ({ therapist: { name } }));
  assert.equal(getCombinedSummaryAnchorIndex(therapists, 'horizontal'), 1);
  assert.equal(getCombinedSummaryAnchorIndex(therapists, 'vertical'), 2);
  assert.equal(getCombinedSummaryAnchorIndex(therapists.slice(0, 1), 'horizontal'), 0);
  assert.equal(getCombinedSummaryAnchorIndex(therapists.slice(0, 1), 'vertical'), 0);
});
