import {
  readStorageValueWithCookieBackup,
  writeStorageValueWithCookieBackup,
} from './browserStorageBackup.js';

export const DEVICE_SETTINGS_ID_STORAGE_KEY = 'abs-device-settings-id-v1';

function hashText(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function getBrowserContext(browserArg) {
  if (browserArg) return browserArg;
  return typeof window === 'undefined' ? null : window;
}

export function getLegacyDeviceFingerprint(browserArg) {
  const browser = getBrowserContext(browserArg);
  if (!browser) return 'default-device';
  try {
    const screenInfo = `${browser.screen.width}x${browser.screen.height}x${browser.screen.colorDepth}`;
    return `dev_${hashText(`${screenInfo}-${browser.navigator.userAgent}`)}`;
  } catch {
    return 'default-device';
  }
}

function createDeviceSettingsId(legacyDeviceId, browser) {
  try {
    const randomId = browser?.crypto?.randomUUID?.().replaceAll('-', '');
    if (randomId) return `${legacyDeviceId}_${randomId.slice(0, 20)}`;
  } catch {
    // Fall through to a short random identifier for older browsers.
  }
  const seed = `${Date.now()}-${Math.random()}-${legacyDeviceId}`;
  return `${legacyDeviceId}_${hashText(seed).toString(36)}`;
}

function isStoredDeviceSettingsId(value) {
  return (
    typeof value === 'string' &&
    value.length >= 8 &&
    value.length <= 96 &&
    /^[a-zA-Z0-9_-]+$/.test(value)
  );
}

export function getDeviceSettingsIdentity({ browser: browserArg, storage: storageArg } = {}) {
  const browser = getBrowserContext(browserArg);
  const legacyDeviceId = getLegacyDeviceFingerprint(browser);
  const storage = storageArg || browser?.localStorage;
  if (!browser) {
    return { deviceId: legacyDeviceId, legacyDeviceId };
  }

  const storedId = readStorageValueWithCookieBackup(
    DEVICE_SETTINGS_ID_STORAGE_KEY,
    storage,
    browser.document
  );
  if (isStoredDeviceSettingsId(storedId)) {
    writeStorageValueWithCookieBackup(
      DEVICE_SETTINGS_ID_STORAGE_KEY,
      storedId,
      storage,
      browser.document
    );
    return { deviceId: storedId, legacyDeviceId };
  }

  const deviceId = createDeviceSettingsId(legacyDeviceId, browser);
  writeStorageValueWithCookieBackup(
    DEVICE_SETTINGS_ID_STORAGE_KEY,
    deviceId,
    storage,
    browser.document
  );
  return { deviceId, legacyDeviceId };
}

export function getDeviceSettingsForIdentity(settingsMap, identity = getDeviceSettingsIdentity()) {
  if (!settingsMap || typeof settingsMap !== 'object' || Array.isArray(settingsMap)) return null;
  return settingsMap[identity.deviceId] || settingsMap[identity.legacyDeviceId] || null;
}

/**
 * 기기별 설정 프로필을 안전하게 갱신합니다.
 *
 * 새 설치 ID가 만들어진 뒤에도 예전 지문 프로필의 나머지 값을 이어받고,
 * 복구용 지문 별칭도 함께 갱신합니다. 각 화면에서 이 병합 규칙을 다시
 * 구현하지 않도록 기기 설정의 공통 경계에 둡니다.
 */
export function buildDeviceSettingsProfileMap({
  settingsMap,
  identity = getDeviceSettingsIdentity(),
  patch = {},
  updatedAt,
} = {}) {
  const currentMap = (
    settingsMap && typeof settingsMap === 'object' && !Array.isArray(settingsMap)
  )
    ? settingsMap
    : {};
  const currentProfile = getDeviceSettingsForIdentity(currentMap, identity) || {};
  const nextProfile = {
    ...currentProfile,
    ...patch,
    ...(updatedAt ? { updatedAt } : {}),
  };
  const nextMap = {
    ...currentMap,
    [identity.deviceId]: nextProfile,
  };

  if (identity.legacyDeviceId && identity.legacyDeviceId !== identity.deviceId) {
    nextMap[identity.legacyDeviceId] = nextProfile;
  }

  return nextMap;
}
