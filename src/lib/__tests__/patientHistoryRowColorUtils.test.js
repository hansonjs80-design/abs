import test from 'node:test';
import assert from 'node:assert/strict';
import { getPatientHistoryPrescriptionRowColor } from '../patientHistoryRowColorUtils.js';

test('prescription row colors stay stable across ordering and whitespace', () => {
  const labels = ['30분', '60분', 'F2.5', 'F3.0', 'F2.5(본인)', '신장분사 3.0'];
  const colors = new Map(labels.map(label => [label, getPatientHistoryPrescriptionRowColor(label)]));
  for (const label of labels.reverse()) {
    assert.equal(getPatientHistoryPrescriptionRowColor(` ${label} `), colors.get(label));
  }
  assert.equal(new Set(colors.values()).size, colors.size);
});

test('missing prescriptions use a neutral row background', () => {
  for (const value of [null, undefined, '', '  ']) {
    assert.equal(getPatientHistoryPrescriptionRowColor(value), '#f8fafc');
  }
});
