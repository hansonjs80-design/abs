import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchPTCalendarCounts, getPTCalendarCount, getPTCountDisplayMemo, normalizePTCountSettings, PT_STAFF_COUNT_SETTINGS_RECORD } from './ptStaffCalendarCounts.js';

test('PT calendar scope preserves an anchored start date, all dates, and explicit zero counts', () => {
  const counts = { '2026-10-09': 51, '2026-10-10': 0, '2026-10-11': 47 };
  for (const scope of ['today', 'from']) {
    const settings = { scope, startDate: '2026-10-10' };
    assert.equal(getPTCalendarCount(counts, settings, '2026-10-09'), null);
    assert.equal(getPTCalendarCount(counts, settings, '2026-10-10'), 0);
    assert.equal(getPTCalendarCount(counts, settings, '2026-10-11'), 47);
    assert.equal(getPTCalendarCount(counts, settings, '2026-10-12'), null);
  }
  assert.equal(getPTCalendarCount(counts, { scope: 'all' }, '2026-10-09'), 51);
  assert.equal(normalizePTCountSettings({ scope: 'from', startDate: '2026-02-30' }), null);
  assert.equal(getPTCalendarCount(counts, null, '2026-10-10'), null);
});

test('PT count overlay retains original memo and style without mutating it', () => {
  const memo = { content: '수동 메모', font_color: '#123456', bg_color: '#ffffff' };
  assert.equal(getPTCountDisplayMemo(memo, null), memo);
  assert.deepEqual(getPTCountDisplayMemo(memo, 47), { ...memo, content: '47명' });
  assert.equal(memo.content, '수동 메모');
});

test('calendar queries only counts and its reserved settings record, with bounded dates', async () => {
  const calls = [];
  const client = { from(table) {
    const query = { table };
    const chain = {
      select(value) { query.select = value; return chain; },
      eq(key, value) { query.eq = [key, value]; return chain; },
      gte(key, value) { query.gte = [key, value]; return chain; },
      lte(key, value) { query.lte = [key, value]; return chain; },
      order() { return chain; }, limit() { return chain; }, abortSignal() { return chain; },
      then(resolve, reject) {
        calls.push(query);
        return Promise.resolve({ error: null, data: query.eq
          ? [{ rows_data: [{ staffCalendarCounts: { scope: 'all' } }] }]
          : [{ date: '2026-10-10', total_count: 47 }, { date: '2026-10-11', total_count: -1 }] }).then(resolve, reject);
      },
    };
    return chain;
  } };
  const result = await fetchPTCalendarCounts(client, '2026-09-27', '2026-10-31');
  assert.deepEqual(result, { settings: { scope: 'all', startDate: null }, counts: { '2026-10-10': 47 } });
  assert.deepEqual(calls[0].eq, ['date', PT_STAFF_COUNT_SETTINGS_RECORD]);
  assert.equal(calls[1].select, 'date,total_count');
  assert.deepEqual(calls[1].gte, ['date', '2026-09-27']);
  assert.deepEqual(calls[1].lte, ['date', '2026-10-31']);
});

test('failed count reads do not masquerade as an empty day', async () => {
  const chain = new Proxy({}, { get(_, key) {
    if (key === 'then') return (resolve) => resolve({ error: new Error('offline') });
    return () => chain;
  } });
  await assert.rejects(fetchPTCalendarCounts({ from: () => chain }, '2026-10-01', '2026-10-31'), /offline/);
});
