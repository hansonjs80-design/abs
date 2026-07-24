import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  applyScheduleStatsMutation,
  buildScheduleStatsSyncMutation,
  shouldOverwriteExistingStatsForScheduleSync,
} from '../scheduleStatsSyncUtils.js';

function createStatsSupabaseMock({
  upsertError = null,
  insertError = null,
  deleteError = null,
} = {}) {
  const calls = [];
  return {
    calls,
    from(tableName) {
      calls.push({ operation: 'from', tableName });
      const builder = {
        upsert(rows, options) {
          calls.push({ operation: 'upsert', rows, options });
          return Promise.resolve({ error: upsertError });
        },
        insert(rows) {
          calls.push({ operation: 'insert', rows });
          return Promise.resolve({ error: insertError });
        },
        delete() {
          calls.push({ operation: 'delete' });
          return builder;
        },
        in(column, values) {
          calls.push({ operation: 'deleteIds', column, values });
          return Promise.resolve({ error: deleteError });
        },
      };
      return builder;
    },
  };
}

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
        { id: 'old-scheduler-duplicate-1', source: 'scheduler', scheduler_cell_key: '2026:06:0:0:1:0' },
        { id: 'old-duplicate-1', source: 'manual', scheduler_cell_key: '2026:06:0:0:2:0' },
        { id: 'old-stale-1', source: 'scheduler', scheduler_cell_key: '2026:06:0:0:9:0' },
      ],
      rebuiltRows: [
        { scheduler_cell_key: '2026:06:0:0:1:0', patient_name: '임태용' },
        { scheduler_cell_key: '2026:06:0:0:2:0', patient_name: '임태용' },
      ],
    });

    assert.deepEqual(result.toDeleteIds, ['old-manual-1', 'old-scheduler-duplicate-1', 'old-stale-1']);
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

  it('keeps a manual row authoritative when it shares a scheduler cell key', () => {
    const result = buildScheduleStatsSyncMutation({
      overwriteExistingStats: false,
      existingRows: [
        { id: 'manual', source: 'manual', scheduler_cell_key: 'same-key', patient_name: '수동 입력' },
        { id: 'scheduler-duplicate', source: 'scheduler', scheduler_cell_key: 'same-key', patient_name: '이전 동기화' },
      ],
      rebuiltRows: [
        { scheduler_cell_key: 'same-key', patient_name: '스케줄 입력' },
      ],
      isSameRow: (existing, next) => existing.patient_name === next.patient_name,
    });

    assert.deepEqual(result.toDeleteIds, ['scheduler-duplicate']);
    assert.deepEqual(result.rowsToUpsert, []);
  });

  it('saves changed rows before deleting stale ids', async () => {
    const client = createStatsSupabaseMock();

    await applyScheduleStatsMutation({
      supabaseClient: client,
      tableName: 'shockwave_patient_logs',
      existingRows: [{ id: 'stale', source: 'scheduler' }],
      toDeleteIds: ['stale'],
      rowsToUpsert: [{ scheduler_cell_key: 'new-key', patient_name: '환자' }],
    });

    const operations = client.calls.map((call) => call.operation);
    assert.ok(operations.indexOf('upsert') < operations.indexOf('deleteIds'));
  });

  it('does not delete stale rows when saving changed rows fails', async () => {
    const client = createStatsSupabaseMock({
      upsertError: new Error('network failure'),
    });

    await assert.rejects(
      applyScheduleStatsMutation({
        supabaseClient: client,
        tableName: 'shockwave_patient_logs',
        existingRows: [{ id: 'stale', source: 'scheduler' }],
        toDeleteIds: ['stale'],
        rowsToUpsert: [{ scheduler_cell_key: 'new-key', patient_name: '환자' }],
      }),
      /network failure/
    );

    assert.equal(client.calls.some((call) => call.operation === 'deleteIds'), false);
  });

  it('inserts fallback rows before cleaning up replaceable legacy rows', async () => {
    const unsupportedError = Object.assign(new Error('missing scheduler_cell_key'), { code: '42703' });
    const client = createStatsSupabaseMock({ upsertError: unsupportedError });

    const result = await applyScheduleStatsMutation({
      supabaseClient: client,
      tableName: 'shockwave_patient_logs',
      existingRows: [
        { id: 'scheduler-old', source: 'scheduler' },
        { id: 'manual-keep', source: 'manual' },
      ],
      toDeleteIds: ['scheduler-old'],
      rowsToUpsert: [{ scheduler_cell_key: 'new-key', patient_name: '환자' }],
      isFallbackUpsertError: (error) => error?.code === '42703',
      mapFallbackRow: (row) => {
        const fallbackRow = { ...row };
        delete fallbackRow.scheduler_cell_key;
        return fallbackRow;
      },
    });

    const operations = client.calls.map((call) => call.operation);
    assert.ok(operations.indexOf('insert') < operations.indexOf('deleteIds'));
    assert.deepEqual(
      client.calls.find((call) => call.operation === 'deleteIds')?.values,
      ['scheduler-old']
    );
    assert.equal(result.usedFallback, true);
  });
});
