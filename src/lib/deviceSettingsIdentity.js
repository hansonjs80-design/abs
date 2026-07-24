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
  if (!storage) {
    return { deviceId: legacyDeviceId, legacyDeviceId };
  }

  try {
    const storedId = storage.getItem(DEVICE_SETTINGS_ID_STORAGE_KEY);
    if (isStoredDeviceSettingsId(storedId)) {
      return { deviceId: storedId, legacyDeviceId };
    }

    const deviceId = createDeviceSettingsId(legacyDeviceId, browser);
    storage.setItem(DEVICE_SETTINGS_ID_STORAGE_KEY, deviceId);
    return { deviceId, legacyDeviceId };
  } catch {
    return { deviceId: legacyDeviceId, legacyDeviceId };
  }
}

export function getDeviceSettingsForIdentity(settingsMap, identity = getDeviceSettingsIdentity()) {
  if (!settingsMap || typeof settingsMap !== 'object' || Array.isArray(settingsMap)) return null;
  return settingsMap[identity.deviceId] || settingsMap[identity.legacyDeviceId] || null;
}
