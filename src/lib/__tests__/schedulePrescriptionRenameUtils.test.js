import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildSchedulePrescriptionRenamePlan,
  normalizeSchedulePrescriptionRenames,
  renameSchedulePrescriptionsForMonth,
} from '../schedulePrescriptionRenameUtils.js';

describe('schedule prescription rename migration', () => {
  it('normalizes unique changes and builds an id-based non-cascading plan', () => {
    const renames = normalizeSchedulePrescriptionRenames([
      { from: ' 기존A ', to: '변경B' },
      { from: '기존C', to: '기존A' },
      { from: '기존A', to: '무시' },
      { from: '같음', to: '같음' },
    ]);

    assert.deepEqual(renames, [
      { from: '기존A', to: '변경B' },
      { from: '기존C', to: '기존A' },
    ]);
    assert.deepEqual(buildSchedulePrescriptionRenamePlan([
      { id: 'row-a', prescription: '기존A' },
      { id: 'row-c', prescription: '기존C' },
      { id: 'row-x', prescription: '무관' },
    ], renames), [
      { id: 'row-a', from: '기존A', to: '변경B' },
      { id: 'row-c', from: '기존C', to: '기존A' },
    ]);
  });

  it('loads only the target month and updates each snapshot row by id', async () => {
    const selections = [];
    const updates = [];
    const rows = [
      { id: 'row-a', prescription: '기존A' },
      { id: 'row-c', prescription: '기존C' },
    ];
    const client = {
      from(table) {
        assert.equal(table, 'shockwave_schedules');
        return {
          select(fields) {
            assert.equal(fields, 'id,prescription');
            const filters = {};
            const query = {
              eq(field, value) {
                filters[field] = value;
                return query;
              },
              in(field, values) {
                filters[field] = values;
                return query;
              },
              async range(from, to) {
                selections.push({ ...filters, from, to });
                return { data: from === 0 ? rows : [], error: null };
              },
            };
            return query;
          },
          update(payload) {
            return {
              async in(field, ids) {
                updates.push({ payload, field, ids });
                return { error: null };
              },
            };
          },
        };
      },
    };

    const result = await renameSchedulePrescriptionsForMonth({
      supabaseClient: client,
      year: 2026,
      month: 9,
      renames: [
        { from: '기존A', to: '변경B' },
        { from: '기존C', to: '기존A' },
      ],
      pageSize: 1000,
    });

    assert.equal(result.updatedCount, 2);
    assert.deepEqual(selections, [{
      year: 2026,
      month: 9,
      prescription: ['기존A', '기존C'],
      from: 0,
      to: 999,
    }]);
    assert.deepEqual(updates.map(({ payload, field, ids }) => ({
      prescription: payload.prescription,
      field,
      ids,
    })), [
      { prescription: '변경B', field: 'id', ids: ['row-a'] },
      { prescription: '기존A', field: 'id', ids: ['row-c'] },
    ]);
  });
});
