import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseConfiguredManualTherapyEntry } from '../manualTherapyEntryUtils.js';

describe('manual therapy scheduler/stat sync parsing', () => {
  it('uses the configured manual therapy prescription without requiring a numeric text tag', () => {
    assert.deepEqual(
      parseConfiguredManualTherapyEntry('12345/홍길동(2)', '김치료', '맞춤 도수'),
      {
        patientName: '홍길동',
        therapistName: '김치료',
        durationMinutes: '',
        durationLabel: '맞춤 도수',
        chartNumber: '12345',
        visitCount: '2',
      }
    );
  });

  it('removes a configured dose tag while preserving the new-patient marker', () => {
    assert.deepEqual(
      parseConfiguredManualTherapyEntry('12345/홍길동MT30*', '김치료', '맞춤 도수', 'MT30'),
      {
        patientName: '홍길동*',
        therapistName: '김치료',
        durationMinutes: '',
        durationLabel: '맞춤 도수',
        chartNumber: '12345',
        visitCount: '1',
      }
    );
  });

  it('removes a single-letter configured dose tag from the patient name', () => {
    assert.equal(
      parseConfiguredManualTherapyEntry('12345/주한솔M(2)', '김치료', '도수 M', 'M')?.patientName,
      '주한솔'
    );
  });
});
