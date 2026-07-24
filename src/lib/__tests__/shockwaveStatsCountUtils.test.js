import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildTherapistPrescriptionDisplayGroups,
  buildShockwaveCountSummaries,
  toStatsPrescriptionCount,
} from '../shockwaveStatsCountUtils.js';

describe('shockwave stats count utilities', () => {
  it('counts missing scheduler prescription_count as one completed cell', () => {
    assert.equal(toStatsPrescriptionCount(null), 1);
    assert.equal(toStatsPrescriptionCount(''), 1);
    assert.equal(toStatsPrescriptionCount('2'), 2);
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
      주한솔: ['환자'],
      신수민: [],
    });
    assert.deepEqual(dateSummary.patientNamesByPrescription, {
      'F2.5': ['환자'],
      'F/R': ['두번째 환자'],
    });
    assert.deepEqual(dateSummary.patientNamesByTherapistPrescription, {
      주한솔: { 'F2.5': ['환자'], 'F/R': ['두번째 환자'] },
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
