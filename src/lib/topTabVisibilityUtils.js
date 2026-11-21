import { APP_TABS, getAllowedTabs } from './authPermissions.js';

export const HIDDEN_TOP_TABS_SETTING_KEY = '__hidden_top_tabs';
export const HIDDEN_TOP_TABS_STORAGE_KEY = 'abs.hiddenTopTabs.v1';
export const INCLUDE_HIDDEN_TABS_IN_COMBINED_STATS_KEY = '__include_hidden_tabs_in_combined_stats';
export const INCLUDE_HIDDEN_TABS_IN_COMBINED_STATS_STORAGE_KEY = 'abs.includeHiddenTabsInCombinedStats.v1';

export const HIDEABLE_TOP_TABS = APP_TABS.filter((tab) => tab.key !== 'settings');

export const COMBINED_STATS_TAB_TREATMENT_MAP = Object.freeze({
  shockwave_stats: 'shockwave',
  shinjang_spray_stats: 'shinjang_spray',
  manual_therapy_stats: 'manual_therapy',
});

const HIDEABLE_KEY_SET = new Set(HIDEABLE_TOP_TABS.map((tab) => tab.key));

/**
 * 유효한 숨김 탭 key 배열로 정규화한다.
 * 'settings' 탭과 알 수 없는 키는 제외하고 중복을 제거한다.
 */
export function normalizeHiddenTopTabs(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const result = [];
  raw.forEach((key) => {
    const normalized = String(key || '').trim();
    if (!HIDEABLE_KEY_SET.has(normalized) || seen.has(normalized)) return;
    seen.add(normalized);
    result.push(normalized);
  });
  return result;
}

export function readHiddenTopTabsFromSettings(shockwaveSettings) {
  const monthlySettings = shockwaveSettings?.monthly_settlement_settings;
  if (!monthlySettings || typeof monthlySettings !== 'object') return null;
  if (!(HIDDEN_TOP_TABS_SETTING_KEY in monthlySettings)) return null;
  return normalizeHiddenTopTabs(monthlySettings[HIDDEN_TOP_TABS_SETTING_KEY]);
}

export function readIncludeHiddenTabsInCombinedStatsFromSettings(shockwaveSettings) {
  const monthlySettings = shockwaveSettings?.monthly_settlement_settings;
  if (!monthlySettings || typeof monthlySettings !== 'object') return null;
  if (!(INCLUDE_HIDDEN_TABS_IN_COMBINED_STATS_KEY in monthlySettings)) return null;
  return monthlySettings[INCLUDE_HIDDEN_TABS_IN_COMBINED_STATS_KEY] !== false;
}

export function readCachedHiddenTopTabs(storage = typeof window !== 'undefined' ? window.localStorage : null) {
  if (!storage) return [];
  try {
    const raw = storage.getItem(HIDDEN_TOP_TABS_STORAGE_KEY);
    if (!raw) return [];
    return normalizeHiddenTopTabs(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function writeCachedHiddenTopTabs(hiddenTabKeys, storage = typeof window !== 'undefined' ? window.localStorage : null) {
  const normalized = normalizeHiddenTopTabs(hiddenTabKeys);
  if (!storage) return normalized;
  try {
    storage.setItem(HIDDEN_TOP_TABS_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Ignore storage quota or private browsing failures.
  }
  return normalized;
}

export function readCachedIncludeHiddenTabsInCombinedStats(storage = typeof window !== 'undefined' ? window.localStorage : null) {
  if (!storage) return true;
  try {
    const raw = storage.getItem(INCLUDE_HIDDEN_TABS_IN_COMBINED_STATS_STORAGE_KEY);
    if (raw === null || raw === undefined || raw === '') return true;
    return JSON.parse(raw) !== false;
  } catch {
    return true;
  }
}

export function writeCachedIncludeHiddenTabsInCombinedStats(include, storage = typeof window !== 'undefined' ? window.localStorage : null) {
  const normalized = include !== false;
  if (!storage) return normalized;
  try {
    storage.setItem(INCLUDE_HIDDEN_TABS_IN_COMBINED_STATS_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Ignore storage quota or private browsing failures.
  }
  return normalized;
}

export function resolveEffectiveHiddenTopTabs(shockwaveSettings, storage) {
  const fromSettings = readHiddenTopTabsFromSettings(shockwaveSettings);
  if (fromSettings !== null) return fromSettings;
  return readCachedHiddenTopTabs(storage);
}

export function resolveEffectiveIncludeHiddenTabsInCombinedStats(shockwaveSettings, storage) {
  const fromSettings = readIncludeHiddenTabsInCombinedStatsFromSettings(shockwaveSettings);
  if (fromSettings !== null) return fromSettings;
  return readCachedIncludeHiddenTabsInCombinedStats(storage);
}

/**
 * 권한이 허용된 탭 목록(getAllowedTabs) 중 상단/네비게이션에 표시할 탭만 걸러낸다.
 * 탭 숨김은 화면 표시만 숨기며, 기존 라우트/권한/데이터 동작에는 영향을 주지 않는다.
 */
export function getVisibleTabs(user, hiddenTabKeys = []) {
  const allowedTabs = getAllowedTabs(user);
  const hiddenSet = new Set(normalizeHiddenTopTabs(hiddenTabKeys));
  if (hiddenSet.size === 0) return allowedTabs;
  return allowedTabs.filter((tab) => tab.key === 'settings' || !hiddenSet.has(tab.key));
}

/**
 * 전체 통계에서 집계할 치료 항목(충격파/신장분사/도수치료) 포함 여부를 계산한다.
 * includeHiddenTabs가 false일 때만 숨김 처리된 대응 탭의 치료 항목을 전체 통계에서 제외한다.
 */
export function getIncludedCombinedStatsTreatments({
  isAdmin = false,
  hiddenTabKeys = [],
  includeHiddenTabs = true,
} = {}) {
  const hiddenSet = new Set(normalizeHiddenTopTabs(hiddenTabKeys));
  const shouldExclude = includeHiddenTabs === false;

  return {
    shockwave: !(shouldExclude && hiddenSet.has('shockwave_stats')),
    shinjang_spray: !(shouldExclude && hiddenSet.has('shinjang_spray_stats')),
    manual_therapy: Boolean(isAdmin) && !(shouldExclude && hiddenSet.has('manual_therapy_stats')),
  };
}

export function buildHiddenTopTabsSettingsPayload(currentSettings, nextHiddenTabKeys, options = {}) {
  const baseSettings = currentSettings && typeof currentSettings === 'object' ? currentSettings : {};
  const baseMonthly = baseSettings.monthly_settlement_settings && typeof baseSettings.monthly_settlement_settings === 'object'
    ? baseSettings.monthly_settlement_settings
    : {};
  const nextMonthly = {
    ...baseMonthly,
    [HIDDEN_TOP_TABS_SETTING_KEY]: normalizeHiddenTopTabs(nextHiddenTabKeys),
  };
  if (typeof options.includeHiddenTabsInCombinedStats === 'boolean') {
    nextMonthly[INCLUDE_HIDDEN_TABS_IN_COMBINED_STATS_KEY] = options.includeHiddenTabsInCombinedStats;
  }
  return {
    ...baseSettings,
    monthly_settlement_settings: nextMonthly,
  };
}
