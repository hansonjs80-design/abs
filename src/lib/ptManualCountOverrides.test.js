import test from 'node:test';
import assert from 'node:assert/strict';
import { getPTCountDisplayMemo } from './ptStaffCalendarCounts.js';
import { loadPTManualCountOverrides, savePTManualCountOverride, PT_MANUAL_COUNT_PREFIX } from './ptManualCountOverrides.js';

function fixture() {
  const records = new Map(), writes = [];
  let failUpdate = false;
  const client = { from(table) {
    let action = 'read', payload, date, revision;
    const query = {
      select() { return query; }, gte() { return query; }, lte() { return query; },
      order() { return query; }, limit() { return query; }, abortSignal() { return query; },
      eq(key, value) { assert.equal(key, 'date'); date = value; return query; },
      contains(key, value) { assert.equal(key, 'rows_data'); revision = value[0].revision; return query; },
      upsert(value) { action = 'upsert'; payload = value; return query; },
      update(value) { action = 'update'; payload = value; return query; },
      then(resolve, reject) {
        return Promise.resolve().then(() => {
          if (action === 'read') return { data: structuredClone([...records.values()]), error: null };
          writes.push({ table, action, date, revision, payload });
          if (action === 'upsert') records.set(payload.date, structuredClone(payload));
          else if (failUpdate) return { error: new Error('offline') };
          else if (records.get(date)?.rows_data[0].revision === revision) records.set(date, { ...records.get(date), ...structuredClone(payload) });
          return { error: null };
        }).then(resolve, reject);
      },
    };
    return query;
  } };
  return { client, records, writes, setFail: value => { failUpdate = value; } };
}

test('manual edit persists across refresh; PT count change wins and old count cannot revive it', async () => {
  const f = fixture(), date = '2026-10-10', key = '2026-10-10-5';
  const memo = { content: '52', font_color: '#123456' };
  await savePTManualCountOverride(f.client, date, key, memo.content, 47);
  let loaded = await loadPTManualCountOverrides(f.client, date, date, { [date]: 47 });
  assert.equal(getPTCountDisplayMemo(memo, 47, loaded.overrides[date], key), memo);
  assert.equal(f.writes.length, 1);
  loaded = await loadPTManualCountOverrides(f.client, date, date, { [date]: 48 });
  assert.equal(getPTCountDisplayMemo(memo, 48, loaded.overrides[date], key).content, '48명');
  assert.equal(f.writes[1].revision, f.writes[0].payload.rows_data[0].revision);
  loaded = await loadPTManualCountOverrides(f.client, date, date, { [date]: 47 });
  assert.equal(getPTCountDisplayMemo(memo, 47, loaded.overrides[date], key).content, '47명');
  assert.equal(memo.content, '52');
  assert.equal(f.writes.every(write => write.table === 'pt_daily_records'), true);
  assert.equal(f.writes[0].payload.date, PT_MANUAL_COUNT_PREFIX + date);
});

test('failed original memo save or a different slot cannot expose a manual override', async () => {
  const f = fixture(), date = '2026-10-10', key = '2026-10-10-5';
  const override = await savePTManualCountOverride(f.client, date, key, '52', 47);
  assert.equal(getPTCountDisplayMemo({ content: 'old' }, 47, override, key).content, '47명');
  assert.equal(getPTCountDisplayMemo({ content: '52' }, 47, override, '2026-10-10-4').content, '47명');
  assert.equal(getPTCountDisplayMemo({ content: '52' }, null, override, key).content, '52');
});

test('invalidation failures retain the observed change and retry even if the PT count returns', async () => {
  const f = fixture(), date = '2026-10-10', key = '2026-10-10-5', invalidated = new Set();
  await savePTManualCountOverride(f.client, date, key, '', 47);
  f.setFail(true);
  let loaded = await loadPTManualCountOverrides(f.client, date, date, { [date]: 48 }, undefined, invalidated);
  assert.equal(loaded.delayed, true);
  assert.equal(loaded.overrides[date].active, false);
  f.setFail(false);
  loaded = await loadPTManualCountOverrides(f.client, date, date, { [date]: 47 }, undefined, invalidated);
  assert.equal(loaded.overrides[date].active, false);
  assert.equal(f.records.get(PT_MANUAL_COUNT_PREFIX + date).rows_data[0].active, false);
});

test('invalid baseline cannot write a manual metadata record', async () => {
  const f = fixture();
  await assert.rejects(savePTManualCountOverride(f.client, '2026-02-30', 'key', '52', 47), /Invalid/);
  await assert.rejects(savePTManualCountOverride(f.client, '2026-10-10', 'key', '52', -1), /Invalid/);
  assert.equal(f.writes.length, 0);
});
