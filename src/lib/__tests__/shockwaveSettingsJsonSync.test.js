import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { saveShockwaveSettingsJsonPatch } from '../shockwaveSettingsJsonSync.js';

function createSettingsClient({
  initialSettings = {},
  conflictOnce = false,
  updateError = null,
} = {}) {
  let row = {
    id: 'settings-1',
    monthly_settlement_settings: initialSettings,
    updated_at: '2026-07-24T00:00:00.000Z',
  };
  let shouldConflict = conflictOnce;
  const calls = [];

  return {
    calls,
    get row() {
      return row;
    },
    from() {
      return {
        select() {
          const selectBuilder = {
            order() { return selectBuilder; },
            limit() { return selectBuilder; },
            single() {
              calls.push({ operation: 'select', row: structuredClone(row) });
              return Promise.resolve({ data: structuredClone(row), error: null });
            },
          };
          return selectBuilder;
        },
        update(payload) {
          calls.push({ operation: 'update', payload });
          const filters = {};
          const updateBuilder = {
            eq(column, value) {
              filters[column] = value;
              return updateBuilder;
            },
            select() {
              if (updateError) return Promise.resolve({ data: null, error: updateError });
              if (shouldConflict) {
                shouldConflict = false;
                row = {
                  ...row,
                  monthly_settlement_settings: {
                    ...row.monthly_settlement_settings,
                    otherDevice: { rowHeight: 44 },
                  },
                  updated_at: '2026-07-24T00:00:01.000Z',
                };
                return Promise.resolve({ data: [], error: null });
              }
              if (filters.updated_at && filters.updated_at !== row.updated_at) {
                return Promise.resolve({ data: [], error: null });
              }
              row = { ...row, ...payload };
              return Promise.resolve({ data: [{ id: row.id, updated_at: row.updated_at }], error: null });
            },
          };
          return updateBuilder;
        },
      };
    },
  };
}

describe('shockwave settings JSON sync', () => {
  it('preserves unrelated JSON fields while applying a patch', async () => {
    const client = createSettingsClient({
      initialSettings: {
        settlement: { incentive: 7 },
        device_settings: { old: { rowHeight: 20 } },
      },
    });

    await saveShockwaveSettingsJsonPatch({
      supabaseClient: client,
      mutate: (current) => ({
        ...current,
        device_text_settings: { current: { font_size: 14 } },
      }),
    });

    assert.deepEqual(client.row.monthly_settlement_settings.settlement, { incentive: 7 });
    assert.deepEqual(client.row.monthly_settlement_settings.device_settings, {
      old: { rowHeight: 20 },
    });
  });

  it('reloads and merges again after an optimistic concurrency conflict', async () => {
    const client = createSettingsClient({
      initialSettings: { existing: true },
      conflictOnce: true,
    });

    await saveShockwaveSettingsJsonPatch({
      supabaseClient: client,
      mutate: (current) => ({
        ...current,
        device_text_settings: { current: { font_size: 14 } },
      }),
    });

    assert.deepEqual(client.row.monthly_settlement_settings.otherDevice, { rowHeight: 44 });
    assert.deepEqual(client.row.monthly_settlement_settings.device_text_settings, {
      current: { font_size: 14 },
    });
    assert.equal(client.calls.filter((call) => call.operation === 'update').length, 2);
  });

  it('surfaces update errors instead of reporting success', async () => {
    const client = createSettingsClient({
      updateError: new Error('network failure'),
    });

    await assert.rejects(
      saveShockwaveSettingsJsonPatch({
        supabaseClient: client,
        mutate: (current) => ({ ...current, changed: true }),
      }),
      /network failure/
    );
  });
});
