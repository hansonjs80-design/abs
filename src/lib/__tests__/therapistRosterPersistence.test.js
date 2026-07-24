import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  normalizeTherapistRoster,
  saveTherapistRosterSafely,
} from '../therapistRosterPersistence.js';

function createSupabaseMock({
  existingRows = [],
  selectError = null,
  insertError = null,
  deactivateError = null,
} = {}) {
  const calls = [];
  return {
    calls,
    from(tableName) {
      calls.push({ operation: 'from', tableName });
      let operation = '';
      const builder = {
        select(columns) {
          if (operation === 'insert') {
            calls.push({ operation: 'insertSelect', columns });
          } else {
            operation = 'select';
            calls.push({ operation, columns });
          }
          return builder;
        },
        eq(column, value) {
          calls.push({ operation: 'eq', column, value });
          return builder;
        },
        order(column) {
          calls.push({ operation: 'order', column });
          if (operation === 'insert') {
            const insertedRows = calls.findLast((call) => call.operation === 'insert')?.rows || [];
            return Promise.resolve({ data: insertedRows, error: insertError });
          }
          return builder;
        },
        insert(rows) {
          operation = 'insert';
          calls.push({ operation, rows });
          return builder;
        },
        update(values) {
          operation = 'update';
          calls.push({ operation, values });
          return builder;
        },
        in(column, values) {
          calls.push({ operation: 'deactivateIds', column, values });
          return Promise.resolve({ error: deactivateError });
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

describe('therapist roster persistence', () => {
  it('rejects malformed and duplicate rosters before touching storage', () => {
    assert.throws(() => normalizeTherapistRoster(null), /목록이 올바르지 않습니다/);
    assert.throws(
      () => normalizeTherapistRoster(['주한솔', '주한솔']),
      /이름이 중복되었습니다/
    );
  });

  it('inserts the replacement roster before deactivating old rows', async () => {
    const client = createSupabaseMock({
      existingRows: [
        { id: 'old-1', name: '기존', slot_index: 0, is_active: true },
      ],
    });

    const savedRows = await saveTherapistRosterSafely({
      supabaseClient: client,
      tableName: 'shockwave_therapists',
      roster: ['주한솔', '신수민'],
    });

    const operations = client.calls.map((call) => call.operation);
    assert.ok(operations.indexOf('insert') < operations.indexOf('deactivateIds'));
    assert.deepEqual(savedRows.map((item) => item.name), ['주한솔', '신수민']);
  });

  it('does not deactivate existing therapists when replacement insert fails', async () => {
    const client = createSupabaseMock({
      existingRows: [
        { id: 'old-1', name: '기존', slot_index: 0, is_active: true },
      ],
      insertError: new Error('network failure'),
    });

    await assert.rejects(
      saveTherapistRosterSafely({
        supabaseClient: client,
        tableName: 'shockwave_therapists',
        roster: ['주한솔'],
      }),
      /network failure/
    );

    assert.equal(client.calls.some((call) => call.operation === 'deactivateIds'), false);
  });

  it('does not rewrite an unchanged roster', async () => {
    const client = createSupabaseMock({
      existingRows: [
        { id: 'keep-1', name: '주한솔', slot_index: 0, is_active: true },
      ],
    });

    const savedRows = await saveTherapistRosterSafely({
      supabaseClient: client,
      tableName: 'shockwave_therapists',
      roster: ['주한솔'],
    });

    assert.deepEqual(savedRows.map((item) => item.id), ['keep-1']);
    assert.equal(client.calls.some((call) => call.operation === 'insert'), false);
    assert.equal(client.calls.some((call) => call.operation === 'deactivateIds'), false);
  });
});
