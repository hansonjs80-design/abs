import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildPatientViewRows,
  filterRowsByPatientView,
  isSameNewPatientFilter,
  isSameTherapistPrescriptionFilter,
} from '../shockwaveDataGridUtils.js';

describe('shockwave data grid prescription patient filter', () => {
  const rows = [
    { id: 1, date: '2026-07-02', therapist_name: '주한솔', prescription: 'F2.5', patient_name: '환자1*' },
    { id: 2, date: '2026-07-02', therapist_name: '주한솔', prescription: 'F4.0', patient_name: '환자2' },
    { id: 3, date: '2026-07-03', therapist_name: '신수민', prescription: 'F 2.5', patient_name: '환자3*' },
  ];

  it('shows only rows matching both therapist and normalized prescription', () => {
    const filtered = filterRowsByPatientView(rows, {
      therapistName: '신수민',
      prescription: 'F2.5',
    });

    assert.deepEqual(filtered.map((row) => row.id), [3]);
  });

  it('shows the matching prescription across all therapists when therapist is omitted', () => {
    const filtered = filterRowsByPatientView(rows, {
      therapistName: null,
      prescription: 'F2.5',
    });

    assert.deepEqual(filtered.map((row) => row.id), [1, 3]);
  });

  it('shows every prescription for one therapist when prescription is omitted', () => {
    const filtered = filterRowsByPatientView(rows, {
      therapistName: '주한솔',
      prescription: null,
    });

    assert.deepEqual(filtered.map((row) => row.id), [1, 2]);
  });

  it('returns the original row list when no filter is active', () => {
    assert.equal(filterRowsByPatientView(rows, null), rows);
  });

  it('shows all new patients in the month or only new patients on one date', () => {
    assert.deepEqual(
      filterRowsByPatientView(rows, { newPatientOnly: true }).map((row) => row.id),
      [1, 3]
    );
    assert.deepEqual(
      filterRowsByPatientView(rows, {
        newPatientOnly: true,
        date: '2026-07-03',
      }).map((row) => row.id),
      [3]
    );
  });

  it('counts every filtered new-patient row as one prescription treatment', () => {
    const viewRows = buildPatientViewRows(
      [
        ...rows,
        {
          id: 4,
          date: '2026-07-03',
          therapist_name: '신수민',
          prescription: 'F4.0',
          prescription_count: 4,
          patient_name: '환자4*',
        },
      ],
      { newPatientOnly: true }
    );

    assert.deepEqual(
      viewRows.map((row) => [row.id, row.prescription_count]),
      [[1, 1], [3, 1], [4, 1]]
    );
  });

  it('recognizes the same header filter for toggle-off behavior', () => {
    assert.equal(
      isSameTherapistPrescriptionFilter(
        { therapistName: '주한솔', prescription: 'F 2.5' },
        '주한솔',
        'F2.5'
      ),
      true
    );
    assert.equal(
      isSameTherapistPrescriptionFilter(
        { therapistName: '주한솔', prescription: 'F2.5' },
        '신수민',
        'F2.5'
      ),
      false
    );
    assert.equal(
      isSameTherapistPrescriptionFilter(
        { therapistName: null, prescription: 'F 2.5' },
        null,
        'F2.5'
      ),
      true
    );
    assert.equal(
      isSameTherapistPrescriptionFilter(
        { therapistName: '주한솔', prescription: null },
        '주한솔',
        null
      ),
      true
    );
  });

  it('recognizes monthly and date new-patient filters independently', () => {
    assert.equal(
      isSameNewPatientFilter({ newPatientOnly: true, date: null }, null),
      true
    );
    assert.equal(
      isSameNewPatientFilter(
        { newPatientOnly: true, date: '2026-07-02' },
        '2026-07-02'
      ),
      true
    );
    assert.equal(
      isSameNewPatientFilter(
        { newPatientOnly: true, date: '2026-07-02' },
        null
      ),
      false
    );
  });
});
