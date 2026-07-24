import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildMonthlyTherapistSavePlan,
  normalizeMonthlyTherapistConfigs,
  saveMonthlyTherapistConfigs,
} from '../monthlyTherapistPersistence.js';

function createSupabaseMock({
  existingRows = [],
  selectError = null,
  upsertError = null,
  deleteError = null,
} = {}) {
  const calls = [];
  return {
    calls,
    from(tableName) {
      calls.push({ operation: 'from', tableName });
      let operation = '';
      const builder = {
        select(columns) {
          operation = 'select';
          calls.push({ operation, columns });
          return builder;
        },
        eq(column, value) {
          calls.push({ operation: 'eq', column, value });
          return builder;
        },
        upsert(rows, options) {
          calls.push({ operation: 'upsert', rows, options });
          return Promise.resolve({ error: upsertError });
        },
        delete() {
          operation = 'delete';
          calls.push({ operation });
          return builder;
        },
        in(column, values) {
          calls.push({ operation: 'deleteIds', column, values });
          return Promise.resolve({ error: deleteError });
        },
        then(resolve, reject) {
          if (operation !== 'select') {
            return Promise.reject(new Error('Unexpected awaited operation')).then(resolve, reject);
          }
          return Promise.resolve({ data: existingRows, error: selectError }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

describe('monthly therapist persistence', () => {
  it('rejects malformed input instead of treating it as an empty delete request', () => {
    assert.throws(
      () => normalizeMonthlyTherapistConfigs({
        year: 2026,
        month: 7,
        configs: null,
      }),
      /목록이 올바르지 않습니다/
    );
  });

  it('builds upserts and only marks rows absent from the next settings as stale', () => {
    const normalizedConfigs = normalizeMonthlyTherapistConfigs({
      year: 2026,
      month: 7,
      configs: [
        { slot_index: 0, therapist_name: '주한솔', start_day: 1, end_day: 31 },
        { slot_index: 1, therapist_name: '신수민', start_day: 15, end_day: 31 },
      ],
    });
    const plan = buildMonthlyTherapistSavePlan({
      existingRows: [
        { id: 'keep', year: 2026, month: 7, slot_index: 0, start_day: 1, type: 'shockwave' },
        { id: 'stale', year: 2026, month: 7, slot_index: 1, start_day: 1, type: 'shockwave' },
      ],
      normalizedConfigs,
    });

    assert.equal(plan.rowsToUpsert.length, 2);
    assert.deepEqual(plan.staleIds, ['stale']);
  });

  it('upserts the new settings before deleting stale row ids', async () => {
    const client = createSupabaseMock({
      existingRows: [
        { id: 'old-range', year: 2026, month: 7, slot_index: 0, start_day: 1, type: 'shockwave' },
      ],
    });

    await saveMonthlyTherapistConfigs({
      supabaseClient: client,
      year: 2026,
      month: 7,
      configs: [
        { slot_index: 0, therapist_name: '주한솔', start_day: 8, end_day: 31 },
      ],
    });

    const operations = client.calls.map((call) => call.operation);
    assert.ok(operations.indexOf('upsert') < operations.indexOf('deleteIds'));
  });

  it('does not delete existing settings when the upsert fails', async () => {
    const client = createSupabaseMock({
      existingRows: [
        { id: 'old-range', year: 2026, month: 7, slot_index: 0, start_day: 1, type: 'shockwave' },
      ],
      upsertError: new Error('network failure'),
    });

    await assert.rejects(
      saveMonthlyTherapistConfigs({
        supabaseClient: client,
        year: 2026,
        month: 7,
        configs: [
          { slot_index: 0, therapist_name: '주한솔', start_day: 8, end_day: 31 },
        ],
      }),
      /network failure/
    );

    assert.equal(client.calls.some((call) => call.operation === 'deleteIds'), false);
  });
});
