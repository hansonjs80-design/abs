import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildShinjangSprayPrescriptions,
  buildShinjangSpraySettlementSummary,
  isShinjangSprayPrescription,
  mergeShinjangSprayLogs,
} from '../shinjangSprayStatsUtils.js';

describe('shinjang spray statistics', () => {
  it('recognizes the marker with normalized width and spaces', () => {
    assert.equal(isShinjangSprayPrescription('F2.5 (신장분사)'), true);
    assert.equal(isShinjangSprayPrescription('도수（신장분사）'), true);
    assert.equal(isShinjangSprayPrescription('F2.5'), false);
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
    });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].treatment_type, 'manual_therapy');
    assert.equal(rows[0].unit_price, 90000);
  });

  it('keeps configured order and applies different incentive rates by prescription', () => {
    const prescriptions = buildShinjangSprayPrescriptions({
      configuredPrescriptions: ['A(신장분사)', 'B(신장분사)', '일반처방'],
      rows: [{ prescription: 'C(신장분사)' }],
    });
    assert.deepEqual(prescriptions, ['A(신장분사)', 'B(신장분사)', 'C(신장분사)']);

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
});
