import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRecentTreatmentSummary } from '../recentTreatmentSummary.js';

test('recent treatment totals equal detail rows and count starred visits once, regardless of quantity', () => {
  const summary = buildRecentTreatmentSummary([
    { prescription: 'F2.0', prescription_count: 2, patient_name: '테스트*' },
    { prescription: 'F3.0', prescription_count: 1, patient_name: '테스트' },
    { prescription: '숨김', prescription_count: 9, patient_name: '테스트*' },
  ], ['F2.0', 'F3.0'], { 'F2.0': 70000, 'F3.0': 100000 });
  assert.equal(summary.count, 3);
  assert.equal(summary.amount, 240000);
  assert.equal(summary.newPatientCount, 1);
  assert.equal(summary.details.length, 2);
  for (const metric of ['count', 'amount', 'newPatientCount']) {
    assert.equal(summary[metric], summary.details.reduce((sum, row) => sum + row[metric], 0));
  }
});

test('Shinjang uses merged source prices and only permitted prescriptions', () => {
  const summary = buildRecentTreatmentSummary([
    { prescription: '신장분사 2.5', prescription_count: 1, unit_price: 90000, patient_name: '가상*' },
    { prescription: '신장분사 1', prescription_count: 1, unit_price: 100000 },
  ], ['신장분사 2.5'], {}, true);
  assert.equal(summary.amount, 90000);
  assert.equal(summary.details[0].label, '신장 2.5');
  assert.equal(summary.newPatientCount, 1);
});
