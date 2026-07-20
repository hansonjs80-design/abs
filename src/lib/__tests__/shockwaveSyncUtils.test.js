import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  formatStatsRowForScheduler,
  parseTherapyInfo,
  resolveShockwaveSchedulePrescriptionCount,
  shouldUseExistingShockwaveSchedulerLogForCopy,
} from '../shockwaveSyncUtils.js';

describe('shockwave scheduler/stat sync formatting', () => {
  it('keeps a new-patient marker when stats rows store the first visit as 1', () => {
    assert.equal(
      formatStatsRowForScheduler({
        chart_number: '12745',
        patient_name: '신금란*',
        visit_count: '1',
      }),
      '12745/신금란*'
    );
  });

  it('keeps a new-patient marker when stats rows keep it as the visit marker', () => {
    assert.equal(
      formatStatsRowForScheduler({
        chart_number: '12745',
        patient_name: '신금란*',
        visit_count: '*',
      }),
      '12745/신금란*'
    );
  });

  it('uses explicit later visit counts instead of leaving the new-patient marker', () => {
    assert.equal(
      formatStatsRowForScheduler({
        chart_number: '12745',
        patient_name: '신금란*',
        visit_count: '3',
      }),
      '12745/신금란(3)'
    );
  });

  it('parses scheduler new-patient cells into the stats representation used by sync', () => {
    assert.deepEqual(parseTherapyInfo('12745/신금란*'), {
      patient_name: '신금란*',
      chart_number: '12745',
      visit_count: '1',
      body_part: '',
      original: '12745/신금란*',
    });
  });

  it('counts each completed scheduler cell as one prescription even when old stats had larger counts', () => {
    assert.equal(
      resolveShockwaveSchedulePrescriptionCount({
        prescription: '',
        fallbackPrescription: 'F2.5',
        fallbackPrescriptionCount: 4,
      }),
      1
    );
    assert.equal(
      resolveShockwaveSchedulePrescriptionCount({
        prescription: 'F4.0',
        fallbackPrescription: 'F2.5',
        fallbackPrescriptionCount: 4,
      }),
      1
    );
  });

  it('does not copy prescription metadata from sheet/manual rows during scheduler sync', () => {
    assert.equal(shouldUseExistingShockwaveSchedulerLogForCopy({ source: 'sheet' }), false);
    assert.equal(shouldUseExistingShockwaveSchedulerLogForCopy({ source: 'manual' }), false);
    assert.equal(shouldUseExistingShockwaveSchedulerLogForCopy({ source: 'scheduler' }), true);
    assert.equal(
      shouldUseExistingShockwaveSchedulerLogForCopy({ source: 'manual', scheduler_cell_key: '2026:06:0:0:1:0' }),
      true
    );
  });
});
