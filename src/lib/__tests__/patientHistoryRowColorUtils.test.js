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

test('derives soft background tint from visit sequence cell color and darkens for current cell', () => {
  const textColorHex = '#2563eb';
  const normalBg = getPatientHistoryPrescriptionRowColor('F2.5', textColorHex, false);
  const currentBg = getPatientHistoryPrescriptionRowColor('F2.5', textColorHex, true);

  assert.equal(normalBg, 'rgba(37, 99, 235, 0.35)');
  assert.equal(currentBg, 'rgba(37, 99, 235, 0.75)');
});
