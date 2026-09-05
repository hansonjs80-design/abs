import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildCryoAdjustedPrescriptionPrices,
  buildManualTherapySettlementSummary,
  buildShockwaveSettlementPrintColumnWidths,
  buildStatsDisplayPrescriptions,
  buildTherapistPrescriptionDisplayGroups,
  buildShockwaveCountSummaries,
  normalizePrescriptionKey,
  statsPrescriptionsMatch,
  toStatsPrescriptionCount,
} from '../shockwaveStatsCountUtils.js';

describe('shockwave stats count utilities', () => {
  it('subtracts cryo prices only from selected prescriptions before incentive calculation', () => {
    const adjustedPrices = buildCryoAdjustedPrescriptionPrices({
      prescriptionPrices: {
        'F2.5': 70000,
        'F4.0': 90000,
        'F1.0': 10000,
      },
      cryoPrescriptions: [' F 2.5 ', 'F1.0'],
      cryoPrices: {
        'F2.5': 15000,
        'F4.0': 20000,
        'F1.0': 12000,
      },
    });

    assert.deepEqual(adjustedPrices, {
      'F2.5': 55000,
      'F4.0': 90000,
      'F1.0': 0,
    });

    const summary = buildManualTherapySettlementSummary({
      prescriptions: ['F2.5', 'F4.0'],
      therapists: [{ name: '주한솔' }],
      prescriptionPrices: adjustedPrices,
      incentivePercentage: 10,
      rows: [
        { therapist_name: '주한솔', prescription: 'F2.5', prescription_count: 2 },
        { therapist_name: '주한솔', prescription: 'F4.0', prescription_count: 1 },
      ],
    });

    assert.equal(summary.grandAmount, 200000);
    assert.equal(summary.grandIncentive, 20000);
  });

  it('counts missing scheduler prescription_count as one completed cell', () => {
    assert.equal(toStatsPrescriptionCount(null), 1);
    assert.equal(toStatsPrescriptionCount(''), 1);
    assert.equal(toStatsPrescriptionCount('2'), 2);
  });

  it('keeps Korean parenthetical qualifiers distinct while ignoring visual punctuation', () => {
    assert.equal(normalizePrescriptionKey('F2.5'), 'f25');
    assert.equal(normalizePrescriptionKey(' F 2.5 (본인) '), 'f25본인');
    assert.equal(statsPrescriptionsMatch('F2.5', 'F2.5(본인)'), false);
    assert.equal(statsPrescriptionsMatch('F 2.5 (본인)', 'f2.5본인'), true);
  });

  it('counts only the current Korean manual prescriptions without merging old labels', () => {
    const summary = buildManualTherapySettlementSummary({
      prescriptions: ['일반도수', '본인도수'],
      therapists: [{ name: '주한솔' }],
      prescriptionPrices: {
        일반도수: 10000,
        본인도수: 20000,
        작년도수: 90000,
      },
      incentivePercentage: 10,
      rows: [
        { therapist_name: '주한솔', prescription: '작년도수', prescription_count: 7 },
        { therapist_name: '주한솔', prescription: '일반도수', prescription_count: 2 },
        { therapist_name: '주한솔', prescription: '본인도수', prescription_count: 1 },
      ],
    });

    assert.deepEqual(summary.summaryByTherapist[0].countsByPrescription, {
      일반도수: 2,
      본인도수: 1,
    });
    assert.equal(summary.grandTotalCount, 3);
    assert.equal(summary.grandAmount, 40000);
    assert.equal(summary.grandIncentive, 4000);
  });

  it('allocates wider print columns to long prescription labels', () => {
    const columns = buildShockwaveSettlementPrintColumnWidths([
      { prescriptions: ['F2.5(본인)', 'F2.0'] },
    ]);

    assert.equal(columns.length, 2);
    assert.equal(columns[0].prescription, 'F2.5(본인)');
    assert.ok(columns[0].widthPercent > columns[1].widthPercent);
    assert.equal(
      Math.round(columns.reduce((sum, column) => sum + column.widthPercent, 0)),
      81,
    );
    assert.equal(
      Math.round((columns[0].widthPercent / columns[1].widthPercent) * 100),
      122,
    );
  });

  it('reserves enough print width for a therapist with one prescription', () => {
    const columns = buildShockwaveSettlementPrintColumnWidths([
      { prescriptions: ['F2.0', 'F2.5'] },
      { prescriptions: ['F2.5'] },
    ]);

    assert.equal(columns[2].isSingleTherapistColumn, true);
    assert.ok(columns[2].widthPercent > columns[0].widthPercent);
    assert.equal(
      Math.round(columns.reduce((sum, column) => sum + column.widthPercent, 0)),
      81,
    );
  });

  it('counts base and qualified prescriptions in separate current and settlement columns', () => {
    const prescriptions = ['F2.5', 'F2.5(본인)'];
    const therapists = [{ name: '주한솔' }];
    const rows = [
      { date: '2026-08-18', therapist_name: '주한솔', prescription: 'F2.5', prescription_count: 2 },
      { date: '2026-08-18', therapist_name: '주한솔', prescription: 'F2.5(본인)', prescription_count: 1 },
    ];
    const summary = buildShockwaveCountSummaries({ prescriptions, therapists, rows });
    const displayGroups = buildTherapistPrescriptionDisplayGroups({
      prescriptions,
      therapists,
      rows,
      sharedPrescriptionLimit: 0,
    });

    assert.deepEqual(summary.dateSummaries.get('2026-08-18').byPrescription, {
      'F2.5': 2,
      'F2.5(본인)': 1,
    });
    assert.deepEqual(summary.therapistTotals[0].byPres, {
      'F2.5': 2,
      'F2.5(본인)': 1,
    });
    assert.deepEqual(displayGroups[0].prescriptions, prescriptions);
  });

  it('uses the current configured label and order instead of stale completed-row labels', () => {
    const rows = [
      {
        date: '2026-08-17',
        therapist_name: '주한솔',
        patient_name: '이전환자',
        prescription: 'F2.5(본인부담)',
        prescription_count: 1,
      },
      {
        date: '2026-08-18',
        therapist_name: '주한솔',
        patient_name: '신규환자*',
        prescription: 'F2.5(본인)',
        prescription_count: null,
      },
    ];
    const prescriptions = buildStatsDisplayPrescriptions({
      configuredPrescriptions: ['F2.5(본인)', 'F2.5'],
      rows,
    });
    const summary = buildShockwaveCountSummaries({
      prescriptions,
      therapists: [{ name: '주한솔' }],
      rows,
    });

    assert.deepEqual(prescriptions, ['F2.5(본인)', 'F2.5']);
    assert.equal(summary.dateSummaries.get('2026-08-17').total, 0);
    assert.equal(summary.dateSummaries.get('2026-08-18').byPrescription['F2.5(본인)'], 1);
    assert.equal(summary.newPatientTotal, 1);
    assert.deepEqual(summary.dateSummaries.get('2026-08-18').newPatientNamesByTherapist, {
      주한솔: ['신규환자*'],
    });
  });

  it('falls back to completed-row prescriptions only when no configured list is available', () => {
    assert.deepEqual(buildStatsDisplayPrescriptions({
      configuredPrescriptions: [],
      rows: [
        { prescription: 'F2.5(본인)' },
        { prescription: 'F2.5' },
      ],
    }), ['F2.5(본인)', 'F2.5']);
  });

  it('keeps hidden completed prescriptions out of the display list', () => {
    assert.deepEqual(buildStatsDisplayPrescriptions({
      configuredPrescriptions: ['F2.5', 'F2.5(본인)'],
      rows: [{ prescription: ' F 2.5 (본인) ' }],
      hiddenPrescriptions: ['f2.5본인'],
    }), ['F2.5']);
  });

  it('uses the same visible therapist and prescription filters for totals', () => {
    const summary = buildShockwaveCountSummaries({
      prescriptions: ['F2.5', 'F/R'],
      therapists: [{ name: '주한솔' }, { name: '신수민' }],
      rows: [
        { date: '2026-06-01', therapist_name: '주한솔', patient_name: '환자*', prescription: 'F2.5', prescription_count: null },
        { date: '2026-06-01', therapist_name: '주한솔', patient_name: '두번째 환자', prescription: 'F/R', prescription_count: '2' },
        { date: '2026-06-01', therapist_name: '숨김', prescription: 'F2.5', prescription_count: '10' },
        { date: '2026-06-01', therapist_name: '주한솔', prescription: '숨김처방', prescription_count: '10' },
      ],
    });

    const dateSummary = summary.dateSummaries.get('2026-06-01');
    assert.equal(summary.grandTotal, 3);
    assert.equal(dateSummary.total, 3);
    assert.deepEqual(dateSummary.byPrescription, { 'F2.5': 1, 'F/R': 2 });
    assert.equal(dateSummary.newPatient, 1);
    assert.deepEqual(dateSummary.newPatientByTherapist, { 주한솔: 1, 신수민: 0 });
    assert.deepEqual(dateSummary.newPatientNamesByTherapist, {
      주한솔: ['환자*'],
      신수민: [],
    });
    assert.deepEqual(dateSummary.patientNamesByPrescription, {
      'F2.5': ['환자*'],
      'F/R': ['두번째 환자'],
    });
    assert.deepEqual(dateSummary.patientNamesByTherapistPrescription, {
      주한솔: { 'F2.5': ['환자*'], 'F/R': ['두번째 환자'] },
      신수민: { 'F2.5': [], 'F/R': [] },
    });
    assert.deepEqual(summary.therapistTotals[0].byPres, { 'F2.5': 1, 'F/R': 2 });
    assert.deepEqual(summary.therapistTotals[1].byPres, { 'F2.5': 0, 'F/R': 0 });
  });

  it('keeps the shared prescription list when four or fewer columns are visible', () => {
    const groups = buildTherapistPrescriptionDisplayGroups({
      prescriptions: ['F2.0', 'F2.5', 'F3.0', 'F4.0'],
      therapists: [{ name: '주한솔' }, { name: '신수민' }],
      rows: [
        { therapist_name: '주한솔', prescription: 'F2.5', prescription_count: 2 },
      ],
    });

    assert.deepEqual(groups.map((group) => group.prescriptions), [
      ['F2.0', 'F2.5', 'F3.0', 'F4.0'],
      ['F2.0', 'F2.5', 'F3.0', 'F4.0'],
    ]);
  });

  it('shows only prescriptions used by each therapist when more than four are visible', () => {
    const groups = buildTherapistPrescriptionDisplayGroups({
      prescriptions: ['F2.0', 'F2.5', 'F3.0', 'F4.0', 'F4.0 DC'],
      therapists: [{ name: '주한솔' }, { name: '신수민' }],
      rows: [
        { therapist_name: '주한솔', prescription: 'F2.0', prescription_count: 2 },
        { therapist_name: '주한솔', prescription: 'F4.0', prescription_count: 1 },
        { therapist_name: '신수민', prescription: 'F2.5', prescription_count: 4 },
        { therapist_name: '신수민', prescription: 'F4.0 DC', prescription_count: 1 },
      ],
    });

    assert.deepEqual(groups.map((group) => group.prescriptions), [
      ['F2.0', 'F4.0'],
      ['F2.5', 'F4.0 DC'],
    ]);
  });

  it('can always filter prescriptions per therapist for the horizontal settlement view', () => {
    const groups = buildTherapistPrescriptionDisplayGroups({
      prescriptions: ['F2.0', 'F2.5', 'F3.0', 'F4.0'],
      therapists: [{ name: '주한솔' }, { name: '신수민' }],
      rows: [
        { therapist_name: '주한솔', prescription: 'F2.5', prescription_count: 2 },
        { therapist_name: '신수민', prescription: 'F4.0', prescription_count: 1 },
      ],
      sharedPrescriptionLimit: 0,
    });

    assert.deepEqual(groups.map((group) => group.prescriptions), [
      ['F2.5'],
      ['F4.0'],
    ]);
  });

  it('uses the three most common prescriptions for a therapist with no treatments', () => {
    const groups = buildTherapistPrescriptionDisplayGroups({
      prescriptions: ['F2.0', 'F2.5', 'F3.0', 'F4.0', 'F4.0 DC'],
      therapists: [{ name: '주한솔' }, { name: '미실적' }],
      rows: [
        { therapist_name: '주한솔', prescription: 'F2.0', prescription_count: 2 },
        { therapist_name: '주한솔', prescription: 'F2.5', prescription_count: 8 },
        { therapist_name: '주한솔', prescription: 'F3.0', prescription_count: 4 },
        { therapist_name: '주한솔', prescription: 'F4.0', prescription_count: 1 },
      ],
    });

    assert.deepEqual(groups[1].prescriptions, ['F2.5', 'F3.0', 'F2.0']);
  });
});
