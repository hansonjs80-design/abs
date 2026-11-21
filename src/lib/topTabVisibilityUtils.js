import { APP_TABS, getAllowedTabs } from './authPermissions.js';

export const HIDDEN_TOP_TABS_SETTING_KEY = '__hidden_top_tabs';
export const HIDDEN_TOP_TABS_STORAGE_KEY = 'abs.hiddenTopTabs.v1';

export const HIDEABLE_TOP_TABS = APP_TABS.filter((tab) => tab.key !== 'settings');

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

export function resolveEffectiveHiddenTopTabs(shockwaveSettings, storage) {
  const fromSettings = readHiddenTopTabsFromSettings(shockwaveSettings);
  if (fromSettings !== null) return fromSettings;
  return readCachedHiddenTopTabs(storage);
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

export function buildHiddenTopTabsSettingsPayload(currentSettings, nextHiddenTabKeys) {
  const baseSettings = currentSettings && typeof currentSettings === 'object' ? currentSettings : {};
  const baseMonthly = baseSettings.monthly_settlement_settings && typeof baseSettings.monthly_settlement_settings === 'object'
    ? baseSettings.monthly_settlement_settings
    : {};
  return {
    ...baseSettings,
    monthly_settlement_settings: {
      ...baseMonthly,
      [HIDDEN_TOP_TABS_SETTING_KEY]: normalizeHiddenTopTabs(nextHiddenTabKeys),
    },
  };
}
