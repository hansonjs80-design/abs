import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canAccessPath, canAccessTab, getAllowedTabs } from '../authPermissions.js';
import {
  HIDDEN_TOP_TABS_SETTING_KEY,
  buildHiddenTopTabsSettingsPayload,
  getVisibleTabs,
  normalizeHiddenTopTabs,
  readHiddenTopTabsFromSettings,
  resolveEffectiveHiddenTopTabs,
} from '../topTabVisibilityUtils.js';

describe('topTabVisibilityUtils', () => {
  it('normalizes hidden tab keys, removes duplicates, and never hides settings', () => {
    const normalized = normalizeHiddenTopTabs([
      'shockwave_stats',
      'settings',
      'unknown_tab',
      'shockwave_stats',
      'pt_stats',
    ]);
    assert.deepEqual(normalized, ['shockwave_stats', 'pt_stats']);
  });

  it('hides selected tabs in UI without changing existing tab/path access permissions', () => {
    const adminUser = { isAdmin: true, app_role: 'admin' };
    const normalUser = {
      isAdmin: false,
      app_role: 'user',
      app_permissions: {
        staff_schedule: true,
        shockwave: true,
        combined_stats: true,
        shockwave_stats: true,
        c_arm_stats: false,
      },
    };

    const hiddenTabs = ['shockwave_stats', 'pt_stats', 'settings'];

    const adminVisible = getVisibleTabs(adminUser, hiddenTabs).map((t) => t.key);
    assert.equal(adminVisible.includes('shockwave_stats'), false);
    assert.equal(adminVisible.includes('pt_stats'), false);
    assert.equal(adminVisible.includes('settings'), true);
    assert.equal(adminVisible.includes('combined_stats'), true);

    const userVisible = getVisibleTabs(normalUser, hiddenTabs).map((t) => t.key);
    assert.equal(userVisible.includes('shockwave_stats'), false);
    assert.equal(userVisible.includes('pt_stats'), false);
    assert.equal(userVisible.includes('c_arm_stats'), false);
    assert.equal(userVisible.includes('settings'), false);
    assert.equal(userVisible.includes('staff_schedule'), true);

    // 기존 권한 및 라우트 접근 동작은 그대로 유지된다.
    assert.equal(getAllowedTabs(adminUser).some((t) => t.key === 'shockwave_stats'), true);
    assert.equal(canAccessTab(normalUser, 'shockwave_stats'), true);
    assert.equal(canAccessPath(normalUser, '/shockwave-stats'), true);
    assert.equal(canAccessTab(normalUser, 'c_arm_stats'), false);
  });

  it('preserves existing monthly_settlement_settings when building payload', () => {
    const current = {
      id: 'row-1',
      interval_minutes: 20,
      monthly_settlement_settings: {
        '2026-11': { cryo: true },
        __schedule_display: { time_label_interval_minutes: 30 },
      },
    };

    const next = buildHiddenTopTabsSettingsPayload(current, ['c_arm_stats', 'settings']);
    assert.deepEqual(next.monthly_settlement_settings['2026-11'], { cryo: true });
    assert.deepEqual(next.monthly_settlement_settings.__schedule_display, { time_label_interval_minutes: 30 });
    assert.deepEqual(next.monthly_settlement_settings[HIDDEN_TOP_TABS_SETTING_KEY], ['c_arm_stats']);
  });

  it('prefers loaded settings over localStorage cache when resolving effective hidden tabs', () => {
    const fakeStorage = {
      getItem: () => JSON.stringify(['pt_stats']),
    };

    // settings가 아직 없으면 캐시 사용
    assert.deepEqual(resolveEffectiveHiddenTopTabs(null, fakeStorage), ['pt_stats']);

    // settings에 빈 배열이 명시적으로 저장돼 있으면 캐시보다 settings 우선
    const loadedEmpty = {
      monthly_settlement_settings: {
        [HIDDEN_TOP_TABS_SETTING_KEY]: [],
      },
    };
    assert.deepEqual(readHiddenTopTabsFromSettings(loadedEmpty), []);
    assert.deepEqual(resolveEffectiveHiddenTopTabs(loadedEmpty, fakeStorage), []);
  });
});
