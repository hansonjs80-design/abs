import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  isUnmarkedSameDaySchedulerLog,
  shouldUseScheduleContentForPatientHistory,
} from '../schedulerHistoryCandidateUtils.js';

describe('scheduler history candidate filtering', () => {
  it('does not treat an unmarked schedule name as confirmed patient history', () => {
    assert.equal(shouldUseScheduleContentForPatientHistory('신지숙'), false);
    assert.equal(shouldUseScheduleContentForPatientHistory('12745/신지숙'), false);
  });

  it('uses schedule cells with explicit visit markers as patient history', () => {
    assert.equal(shouldUseScheduleContentForPatientHistory('신지숙*'), true);
    assert.equal(shouldUseScheduleContentForPatientHistory('12745/신지숙(2)'), true);
    assert.equal(shouldUseScheduleContentForPatientHistory('12745/신지숙(-)'), true);
  });

  it('ignores same-day scheduler logs that were synced before the new-patient marker was added', () => {
    assert.equal(
      isUnmarkedSameDaySchedulerLog({
        date: '2026-07-02',
        patient_name: '신지숙',
        visit_count: '1',
        source: 'scheduler',
        scheduler_cell_key: '2026:07:0:4:2:0',
      }, '2026-07-02'),
      true
    );
  });

  it('keeps marked or older scheduler logs available as history', () => {
    assert.equal(
      isUnmarkedSameDaySchedulerLog({
        date: '2026-07-02',
        patient_name: '신지숙*',
        visit_count: '1',
        source: 'scheduler',
      }, '2026-07-02'),
      false
    );
    assert.equal(
      isUnmarkedSameDaySchedulerLog({
        date: '2026-07-01',
        patient_name: '신지숙',
        visit_count: '1',
        source: 'scheduler',
      }, '2026-07-02'),
      false
    );
  });
});
