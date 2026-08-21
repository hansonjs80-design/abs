import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getPatientHistoryVisitSequenceColors,
  PATIENT_HISTORY_VISIT_SEQUENCE_COLORS,
} from '../patientHistoryVisitSequenceUtils.js';

const log = (visitCount, date = '2026-08-01') => ({
  date,
  visit_count: visitCount,
});

describe('patient history visit sequence colors', () => {
  it('uses the requested light red through violet palette order', () => {
    assert.deepEqual(PATIENT_HISTORY_VISIT_SEQUENCE_COLORS, [
      '#fee2e2',
      '#ffedd5',
      '#fef9c3',
      '#dcfce7',
      '#dbeafe',
      '#e0e7ff',
      '#f3e8ff',
    ]);
  });

  it('colors each descending consecutive run with the next light rainbow color', () => {
    const colors = getPatientHistoryVisitSequenceColors([
      log('6', '2026-08-06'),
      log('5', '2026-08-05'),
      log('4', '2026-08-04'),
      log('3', '2026-08-03'),
      log('2', '2026-08-02'),
      log('1', '2026-08-01'),
      log('-', '2026-07-31'),
      log('9', '2026-07-30'),
      log('8', '2026-07-29'),
    ]);

    assert.deepEqual(colors, [
      ...Array(6).fill(PATIENT_HISTORY_VISIT_SEQUENCE_COLORS[0]),
      null,
      ...Array(2).fill(PATIENT_HISTORY_VISIT_SEQUENCE_COLORS[1]),
    ]);
  });

  it('keeps same-date duplicate counts inside one consecutive run', () => {
    const colors = getPatientHistoryVisitSequenceColors([
      log('19', '2026-08-20'),
      log('18', '2026-08-19'),
      log('18', '2026-08-19'),
      log('17', '2026-08-10'),
    ]);

    assert.deepEqual(colors, Array(4).fill(PATIENT_HISTORY_VISIT_SEQUENCE_COLORS[0]));
  });

  it('treats a new-patient star after visit two as the first consecutive visit', () => {
    const colors = getPatientHistoryVisitSequenceColors([
      log('3', '2026-08-03'),
      log('2', '2026-08-02'),
      log('*', '2026-08-01'),
      log('*', '2026-08-01'),
    ]);

    assert.deepEqual(colors, Array(4).fill(PATIENT_HISTORY_VISIT_SEQUENCE_COLORS[0]));

    assert.deepEqual(
      getPatientHistoryVisitSequenceColors([
        log('2', '2026-08-02'),
        log('1', '2026-08-01'),
        log('*', '2026-08-01'),
      ]),
      Array(3).fill(PATIENT_HISTORY_VISIT_SEQUENCE_COLORS[0])
    );
  });

  it('splits equal counts on different dates into separate runs', () => {
    const colors = getPatientHistoryVisitSequenceColors([
      log('19', '2026-08-20'),
      log('18', '2026-08-19'),
      log('18', '2026-08-18'),
      log('17', '2026-08-17'),
    ]);

    assert.deepEqual(colors, [
      PATIENT_HISTORY_VISIT_SEQUENCE_COLORS[0],
      PATIENT_HISTORY_VISIT_SEQUENCE_COLORS[0],
      PATIENT_HISTORY_VISIT_SEQUENCE_COLORS[1],
      PATIENT_HISTORY_VISIT_SEQUENCE_COLORS[1],
    ]);
  });

  it('does not color duplicates without a descending numeric step', () => {
    assert.deepEqual(
      getPatientHistoryVisitSequenceColors([
        log('18', '2026-08-19'),
        log('18', '2026-08-19'),
        log('*', '2026-08-18'),
      ]),
      [null, null, null]
    );
  });
});
