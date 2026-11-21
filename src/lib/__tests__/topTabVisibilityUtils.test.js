import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canAccessPath, canAccessTab, getAllowedTabs } from '../authPermissions.js';
import { buildCombinedStatsMonthSummary } from '../combinedStatsUtils.js';
import {
  HIDDEN_COMBINED_STATS_TREATMENTS_KEY,
  HIDDEN_TOP_TABS_SETTING_KEY,
  INCLUDE_HIDDEN_TABS_IN_COMBINED_STATS_KEY,
  buildHiddenTopTabsSettingsPayload,
  getIncludedCombinedStatsTreatments,
  getVisibleTabs,
  normalizeHiddenCombinedStatsTreatments,
  normalizeHiddenTopTabs,
  readHiddenCombinedStatsTreatmentsFromSettings,
  readHiddenTopTabsFromSettings,
  resolveEffectiveHiddenCombinedStatsTreatments,
  resolveEffectiveHiddenTopTabs,
  resolveEffectiveIncludeHiddenTabsInCombinedStats,
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

    const next = buildHiddenTopTabsSettingsPayload(current, ['c_arm_stats', 'settings'], {
      includeHiddenTabsInCombinedStats: false,
    });
    assert.deepEqual(next.monthly_settlement_settings['2026-11'], { cryo: true });
    assert.deepEqual(next.monthly_settlement_settings.__schedule_display, { time_label_interval_minutes: 30 });
    assert.deepEqual(next.monthly_settlement_settings[HIDDEN_TOP_TABS_SETTING_KEY], ['c_arm_stats']);
    assert.equal(next.monthly_settlement_settings[INCLUDE_HIDDEN_TABS_IN_COMBINED_STATS_KEY], false);
  });

  it('prefers loaded settings over localStorage cache when resolving effective hidden tabs and combined inclusion', () => {
    const fakeStorage = {
      getItem: (key) => (key.includes('includeHiddenTabs') ? JSON.stringify(false) : JSON.stringify(['pt_stats'])),
    };

    // settings가 아직 없으면 캐시 사용
    assert.deepEqual(resolveEffectiveHiddenTopTabs(null, fakeStorage), ['pt_stats']);
    assert.equal(resolveEffectiveIncludeHiddenTabsInCombinedStats(null, fakeStorage), false);

    // settings에 명시적으로 저장돼 있으면 캐시보다 settings 우선
    const loaded = {
      monthly_settlement_settings: {
        [HIDDEN_TOP_TABS_SETTING_KEY]: [],
        [INCLUDE_HIDDEN_TABS_IN_COMBINED_STATS_KEY]: true,
      },
    };
    assert.deepEqual(readHiddenTopTabsFromSettings(loaded), []);
    assert.deepEqual(resolveEffectiveHiddenTopTabs(loaded, fakeStorage), []);
    assert.equal(resolveEffectiveIncludeHiddenTabsInCombinedStats(loaded, fakeStorage), true);
  });

  it('computes included combined-stats treatments based on includeHiddenTabs option', () => {
    const hidden = ['shockwave_stats', 'manual_therapy_stats'];

    assert.deepEqual(
      getIncludedCombinedStatsTreatments({ isAdmin: true, hiddenTabKeys: hidden, includeHiddenTabs: true }),
      { shockwave: true, shinjang_spray: true, manual_therapy: true }
    );

    assert.deepEqual(
      getIncludedCombinedStatsTreatments({ isAdmin: true, hiddenTabKeys: hidden, includeHiddenTabs: false }),
      { shockwave: false, shinjang_spray: true, manual_therapy: false }
    );

    assert.deepEqual(
      getIncludedCombinedStatsTreatments({ isAdmin: false, hiddenTabKeys: ['shinjang_spray_stats'], includeHiddenTabs: false }),
      { shockwave: true, shinjang_spray: false, manual_therapy: false }
    );

    // 명시적 통계 항목 체크박스 해제 시 해당 항목이 제외된다.
    assert.deepEqual(
      normalizeHiddenCombinedStatsTreatments(['manual_therapy', 'invalid', 'manual_therapy']),
      ['manual_therapy']
    );
    assert.deepEqual(
      getIncludedCombinedStatsTreatments({
        isAdmin: true,
        hiddenTabKeys: [],
        hiddenTreatments: ['manual_therapy'],
      }),
      { shockwave: true, shinjang_spray: true, manual_therapy: false }
    );
    const saved = buildHiddenTopTabsSettingsPayload({}, [], {
      hiddenCombinedStatsTreatments: ['manual_therapy'],
    });
    assert.deepEqual(saved.monthly_settlement_settings[HIDDEN_COMBINED_STATS_TREATMENTS_KEY], ['manual_therapy']);
    assert.deepEqual(readHiddenCombinedStatsTreatmentsFromSettings(saved), ['manual_therapy']);
    assert.deepEqual(resolveEffectiveHiddenCombinedStatsTreatments(saved), ['manual_therapy']);
  });

  it('excludes hidden treatments from buildCombinedStatsMonthSummary totals when configured', () => {
    const baseInput = {
      year: 2026,
      month: 11,
      isAdmin: true,
      shockwaveTherapists: [{ id: 't1', name: '주한솔' }],
      manualTherapists: [{ id: 't1', name: '주한솔' }],
      monthlyShockwaveTherapists: [{ slot_index: 0, therapist_name: '주한솔' }],
      monthlyManualTherapists: [{ slot_index: 0, therapist_name: '주한솔' }],
      shockwaveRows: [
        { date: '2026-11-02', therapist_name: '주한솔', patient_name: '홍길동', prescription: 'F1.5', prescription_count: 1 },
        { date: '2026-11-02', therapist_name: '주한솔', patient_name: '김영희', prescription: '신장분사 2.5', prescription_count: 1 },
      ],
      manualTherapyRows: [
        { date: '2026-11-02', therapist_name: '주한솔', patient_name: '이철수', prescription: '40분', prescription_count: 1 },
      ],
      settings: {
        prescriptions: ['F1.5'],
        prescription_prices: { 'F1.5': 50000, '40분': 100000 },
        incentive_percentage: 7,
        manual_therapy_prescriptions: ['40분'],
        manual_therapy_incentive_percentage: 15,
        monthly_settlement_settings: {
          '2026-11': {
            manual_therapy: {
              prescriptions: ['40분'],
              prescription_prices: { '40분': 100000 },
              incentive_percentage: 15,
              incentive_overridden: true,
            },
            shinjang_spray: {
              prescriptions: ['신장분사 2.5'],
              prescription_prices: { '신장분사 2.5': 80000 },
              prescription_incentive_percentages: { '신장분사 2.5': 7 },
            },
          },
        },
      },
    };

    const allIncluded = buildCombinedStatsMonthSummary(baseInput);
    assert.equal(allIncluded.total.count, 3);
    assert.equal(allIncluded.total.amount, 230000);

    const excludingManualAndShockwave = buildCombinedStatsMonthSummary({
      ...baseInput,
      includedTreatments: { shockwave: false, shinjang_spray: true, manual_therapy: false },
    });
    assert.equal(excludingManualAndShockwave.treatmentTotals.shockwave.count, 0);
    assert.equal(excludingManualAndShockwave.treatmentTotals.manual_therapy.count, 0);
    assert.equal(excludingManualAndShockwave.treatmentTotals.shinjang_spray.count, 1);
    assert.equal(excludingManualAndShockwave.total.count, 1);
    assert.equal(excludingManualAndShockwave.total.amount, 80000);
    assert.equal(excludingManualAndShockwave.recentTreatments.shockwave.count, 0);
    assert.equal(excludingManualAndShockwave.recentTreatments.manual_therapy.count, 0);
  });
});
