import assert from 'node:assert/strict';
import { test } from 'node:test';
import { C_ARM_RECENT_MONTHS_KEY, cArmRecentMonthRange, parseCArmRecentMonths, readCArmRecentMonths, saveCArmRecentMonths } from '../cArmRecentStats.js';

function storage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test('keeps the selected period after remounts and incomplete or invalid edits', () => {
  const local = storage();
  const document = { cookie: '' };
  assert.equal(readCArmRecentMonths(local, document), 12);
  assert.equal(saveCArmRecentMonths('18', local, document), 18);
  for (const input of ['', '0', '-1', '1.5', '121', '6e1']) {
    assert.equal(saveCArmRecentMonths(input, local, document), null);
    assert.equal(readCArmRecentMonths(local, document), 18);
  }
  assert.equal(saveCArmRecentMonths('1', local, document), 1);
  assert.equal(readCArmRecentMonths(local, document), 1);
});

test('restores the chosen number from cookie backup after local storage is lost', () => {
  const document = { cookie: '' };
  saveCArmRecentMonths(24, storage(), document);
  const restarted = storage();
  assert.equal(readCArmRecentMonths(restarted, document), 24);
  assert.equal(restarted.getItem(C_ARM_RECENT_MONTHS_KEY), '24');
  const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
  saveCArmRecentMonths(18, blocked, document);
  assert.equal(readCArmRecentMonths(blocked, document), 18);
});

test('includes the selected month and crosses year boundaries without future months', () => {
  assert.deepEqual(cArmRecentMonthRange(2026, 2, 3), [
    { year: 2025, month: 12 }, { year: 2026, month: 1 }, { year: 2026, month: 2 },
  ]);
  assert.deepEqual(cArmRecentMonthRange(2026, 9, 1), [{ year: 2026, month: 9 }]);
  const range = cArmRecentMonthRange(2026, 9, 18);
  assert.equal(range.length, 18);
  assert.deepEqual(range[0], { year: 2025, month: 4 });
  assert.deepEqual(range.at(-1), { year: 2026, month: 9 });
  assert.equal(parseCArmRecentMonths('120'), 120);
});
