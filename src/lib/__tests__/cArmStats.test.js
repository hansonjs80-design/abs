import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { C_ARM_TABLE, cArmIncentive, cArmMonthTotal, cArmPersonTotals, createCArmMonth, daysInCArmMonth, loadCArmYear, saveCArmMonth, validateCArmMonth } from '../cArmStats.js';
import { APP_TABS, canAccessPath, canAccessTab, createDefaultPermissions, getAllowedTabs, normalizePermissions } from '../authPermissions.js';

const month = () => ({ incentive_rate: 2000, radiographers: [
  { id: 'one', name: '김태현', days: { 1: { first: 3, returning: 2 }, 2: { first: 1, returning: null } } },
  { id: 'two', name: '성기수', days: { 1: { first: 4, returning: 5 } } },
] });

function fakeClient(response) {
  const calls = [];
  const query = { then: (resolve, reject) => Promise.resolve(response).then(resolve, reject) };
  for (const key of ['select', 'insert', 'update', 'eq', 'order']) query[key] = (...args) => { calls.push([key, ...args]); return query; };
  return { calls, from: (name) => { calls.push(['from', name]); return query; } };
}

describe('independent C-Arm statistics', () => {
  it('adds both visit types per person and month and uses the editable rate', () => {
    const document = month();
    assert.deepEqual(cArmPersonTotals(document.radiographers[0]), { first: 4, returning: 2, total: 6 });
    assert.equal(cArmMonthTotal(document), 15);
    assert.equal(cArmIncentive(document.radiographers[0], 2000), 12000);
    assert.equal(cArmIncentive(document.radiographers[0], 3500), 21000);
    assert.equal(cArmIncentive(document.radiographers[1], 0), 0);
    assert.equal(cArmMonthTotal(null), 0);
  });
  it('copies the last roster and rate without carrying counts into another month', () => {
    const original = month();
    original.incentive_rate = 3500;
    const next = createCArmMonth(original);
    assert.equal(next.incentive_rate, 3500);
    assert.deepEqual(next.radiographers.map((person) => person.name), ['김태현', '성기수']);
    assert.equal(cArmMonthTotal(next), 0);
    next.radiographers[0].name = '변경';
    assert.equal(original.radiographers[0].name, '김태현');
    assert.deepEqual(createCArmMonth().radiographers, []);
  });
  it('supports leap years and rejects nonexistent days, invalid counts and duplicate names', () => {
    assert.equal(daysInCArmMonth(2028, 2), 29);
    assert.equal(daysInCArmMonth(2026, 2), 28);
    const document = month();
    document.radiographers[0].days[29] = { first: 1 };
    assert.doesNotThrow(() => validateCArmMonth(document, 2028, 2));
    assert.throws(() => validateCArmMonth(document, 2026, 2), /없는 날짜/);
    delete document.radiographers[0].days[29];
    for (const count of [-1, 1.5, 100001, '3', Infinity]) {
      document.radiographers[0].days[1].first = count;
      assert.throws(() => validateCArmMonth(document, 2026, 9), /건수/);
    }
    document.radiographers[0].days[1].first = 1;
    document.radiographers[1].name = '김태현';
    assert.throws(() => validateCArmMonth(document, 2026, 9), /중복/);
  });
  it('rejects invalid incentive rates without any persistence call', async () => {
    const client = fakeClient({ data: [], error: null });
    for (const rate of [-1, 1.5, 100000001]) {
      await assert.rejects(saveCArmMonth(client, { year: 2026, month: 9, revision: null, document: { ...month(), incentive_rate: rate } }), /인센티브/);
    }
    assert.deepEqual(client.calls, []);
  });
  it('only reads the dedicated C-Arm table and selected year', async () => {
    const client = fakeClient({ data: [{ year: 2026, month: 9 }], error: null });
    assert.equal((await loadCArmYear(client, 2026)).length, 1);
    assert.deepEqual(client.calls, [['from', C_ARM_TABLE], ['select', '*'], ['eq', 'year', 2026], ['order', 'month']]);
  });
  it('creates a new month without an upsert that could overwrite another device', async () => {
    const row = { year: 2026, month: 9, ...month(), revision: 1 };
    const client = fakeClient({ data: [row], error: null });
    assert.deepEqual(await saveCArmMonth(client, { year: 2026, month: 9, document: month(), revision: null }), row);
    assert.deepEqual(client.calls[1], ['insert', row]);
    const concurrent = fakeClient({ data: null, error: { code: '23505' } });
    await assert.rejects(saveCArmMonth(concurrent, { year: 2026, month: 9, document: month(), revision: null }), /다른 기기/);
  });
  it('updates only the same month and revision and preserves edits on conflicts/errors', async () => {
    const client = fakeClient({ data: [{ revision: 4 }], error: null });
    await saveCArmMonth(client, { year: 2026, month: 9, document: month(), revision: 3 });
    assert.equal(client.calls[1][1].revision, 4);
    assert.deepEqual(client.calls.slice(2, 5), [['eq', 'year', 2026], ['eq', 'month', 9], ['eq', 'revision', 3]]);
    const conflict = fakeClient({ data: [], error: null });
    await assert.rejects(saveCArmMonth(conflict, { year: 2026, month: 9, document: month(), revision: 3 }), /다른 기기/);
    const failure = fakeClient({ data: null, error: new Error('offline') });
    await assert.rejects(saveCArmMonth(failure, { year: 2026, month: 9, document: month(), revision: 3 }), /offline/);
  });
});

describe('C-Arm opt-in permission', () => {
  it('places C-Arm immediately after physical therapy statistics', () => {
    assert.equal(APP_TABS[APP_TABS.findIndex((tab) => tab.key === 'pt_stats') + 1].key, 'c_arm_stats');
  });
  it('hides the new tab and blocks its URL unless explicitly checked', () => {
    for (const value of [undefined, false, null, 1, 'true']) {
      const user = { app_permissions: { c_arm_stats: value } };
      assert.equal(canAccessTab(user, 'c_arm_stats'), false);
      assert.equal(canAccessPath(user, '/c-arm-stats'), false);
      assert.equal(getAllowedTabs(user).some((tab) => tab.key === 'c_arm_stats'), false);
    }
    assert.equal(canAccessTab({}, 'c_arm_stats'), false);
    assert.equal(createDefaultPermissions().c_arm_stats, false);
    assert.equal(canAccessPath({ app_permissions: { c_arm_stats: true } }, '/c-arm-stats'), true);
    assert.equal(canAccessTab({ app_metadata: { permissions: { c_arm_stats: true } } }, 'c_arm_stats'), true);
  });
  it('grants administrators access even with a missing or false stored flag', () => {
    const admin = { app_role: 'admin', app_permissions: { c_arm_stats: false } };
    assert.equal(canAccessTab(admin, 'c_arm_stats'), true);
    assert.equal(normalizePermissions(admin.app_permissions, admin).c_arm_stats, true);
    assert.equal(getAllowedTabs(admin).some((tab) => tab.key === 'c_arm_stats'), true);
  });
});
