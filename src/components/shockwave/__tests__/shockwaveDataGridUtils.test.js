import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  filterRowsByTherapistPrescription,
  isSameTherapistPrescriptionFilter,
} from '../shockwaveDataGridUtils.js';

describe('shockwave data grid prescription patient filter', () => {
  const rows = [
    { id: 1, therapist_name: '주한솔', prescription: 'F2.5', patient_name: '환자1' },
    { id: 2, therapist_name: '주한솔', prescription: 'F4.0', patient_name: '환자2' },
    { id: 3, therapist_name: '신수민', prescription: 'F 2.5', patient_name: '환자3' },
  ];

  it('shows only rows matching both therapist and normalized prescription', () => {
    const filtered = filterRowsByTherapistPrescription(rows, {
      therapistName: '신수민',
      prescription: 'F2.5',
    });

    assert.deepEqual(filtered.map((row) => row.id), [3]);
  });

  it('returns the original row list when no filter is active', () => {
    assert.equal(filterRowsByTherapistPrescription(rows, null), rows);
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
  });
});
