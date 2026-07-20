import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildScheduleStatsSyncMutation,
  shouldOverwriteExistingStatsForScheduleSync,
} from '../scheduleStatsSyncUtils.js';

describe('schedule stats sync utilities', () => {
  it('treats previous months as schedule-authoritative during automatic sync', () => {
    const today = new Date('2026-07-20T00:00:00+09:00');

    assert.equal(
      shouldOverwriteExistingStatsForScheduleSync({ year: 2026, month: 6, today }),
      true
    );
    assert.equal(
      shouldOverwriteExistingStatsForScheduleSync({ year: 2026, month: 7, today }),
      false
    );
    assert.equal(
      shouldOverwriteExistingStatsForScheduleSync({ year: 2026, month: 8, today }),
      false
    );
  });

  it('can treat the current month as schedule-authoritative when requested', () => {
    assert.equal(
      shouldOverwriteExistingStatsForScheduleSync({
        year: 2026,
        month: 7,
        scheduleAuthoritative: true,
        today: new Date('2026-07-20T00:00:00+09:00'),
      }),
      true
    );
  });

  it('always overwrites existing stats when explicitly requested', () => {
    assert.equal(
      shouldOverwriteExistingStatsForScheduleSync({
        year: 2026,
        month: 7,
        overwriteManual: true,
        today: new Date('2026-07-20T00:00:00+09:00'),
      }),
      true
    );
  });

  it('deletes stale or unkeyed rows when schedule is the source of truth', () => {
    const result = buildScheduleStatsSyncMutation({
      overwriteExistingStats: true,
      existingRows: [
        { id: 'old-manual-1', source: 'manual', scheduler_cell_key: '' },
        { id: 'old-scheduler-1', source: 'scheduler', scheduler_cell_key: '2026:06:0:0:1:0' },
        { id: 'old-duplicate-1', source: 'manual', scheduler_cell_key: '2026:06:0:0:2:0' },
        { id: 'old-stale-1', source: 'scheduler', scheduler_cell_key: '2026:06:0:0:9:0' },
      ],
      rebuiltRows: [
        { scheduler_cell_key: '2026:06:0:0:1:0', patient_name: '임태용' },
        { scheduler_cell_key: '2026:06:0:0:2:0', patient_name: '임태용' },
      ],
    });

    assert.deepEqual(result.toDeleteIds, ['old-manual-1', 'old-stale-1']);
    assert.equal(result.rowsToUpsert.length, 2);
  });

  it('preserves manual rows during current-month non-overwrite sync', () => {
    const result = buildScheduleStatsSyncMutation({
      overwriteExistingStats: false,
      existingRows: [
        { id: 'manual-extra', source: 'manual', scheduler_cell_key: '' },
        { id: 'stale-scheduler', source: 'scheduler', scheduler_cell_key: 'old-key' },
        { id: 'same-scheduler', source: 'scheduler', scheduler_cell_key: 'new-key', patient_name: '임태용' },
      ],
      rebuiltRows: [
        { scheduler_cell_key: 'new-key', patient_name: '임태용' },
      ],
      isSameRow: (existing, next) => existing.patient_name === next.patient_name,
    });

    assert.deepEqual(result.toDeleteIds, ['stale-scheduler']);
    assert.deepEqual(result.rowsToUpsert, []);
  });
});
