import {
  readStorageValueWithCookieBackup,
  writeStorageValueWithCookieBackup,
} from './browserStorageBackup.js';

export const DEVICE_SETTINGS_ID_STORAGE_KEY = 'abs-device-settings-id-v1';
export const DEVICE_SETTINGS_ID_DATABASE_NAME = 'abs-device-settings-v1';

const DEVICE_SETTINGS_ID_STORE_NAME = 'identity';
const DEVICE_SETTINGS_ID_RECORD_KEY = 'device-settings-id';
const DURABLE_IDENTITY_TIMEOUT_MS = 3000;

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

function getBrowserFamily(userAgent) {
  if (/Edg(?:A|iOS)?\//i.test(userAgent)) return 'edge';
  if (/OPR\//i.test(userAgent)) return 'opera';
  if (/(?:Chrome|CriOS)\//i.test(userAgent)) return 'chrome';
  if (/(?:Firefox|FxiOS)\//i.test(userAgent)) return 'firefox';
  if (/Safari\//i.test(userAgent) && /Version\//i.test(userAgent)) return 'safari';
  return 'other';
}

function getPlatformFamily(browser, userAgent) {
  const explicitPlatform = String(
    browser?.navigator?.userAgentData?.platform || browser?.navigator?.platform || ''
  ).trim().toLowerCase();
  if (explicitPlatform) return explicitPlatform;
  if (/Windows/i.test(userAgent)) return 'windows';
  if (/Mac OS|Macintosh/i.test(userAgent)) return 'macos';
  if (/Android/i.test(userAgent)) return 'android';
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'ios';
  if (/Linux/i.test(userAgent)) return 'linux';
  return 'unknown';
}

export function getStableRecoveryDeviceFingerprint(browserArg) {
  const browser = getBrowserContext(browserArg);
  if (!browser) return 'default-device';
  try {
    const userAgent = String(browser.navigator?.userAgent || '');
    const screenInfo = `${browser.screen.width}x${browser.screen.height}x${browser.screen.colorDepth}`;
    const browserFamily = getBrowserFamily(userAgent);
    const platformFamily = getPlatformFamily(browser, userAgent);
    const hardwareInfo = `${browser.navigator?.hardwareConcurrency || 0}x${browser.navigator?.deviceMemory || 0}`;
    return `dev_stable_${hashText(`${screenInfo}-${browserFamily}-${platformFamily}-${hardwareInfo}`)}`;
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

function persistDeviceSettingsId(deviceId, browser, storage) {
  if (!isStoredDeviceSettingsId(deviceId)) return false;
  writeStorageValueWithCookieBackup(
    DEVICE_SETTINGS_ID_STORAGE_KEY,
    deviceId,
    storage,
    browser?.document
  );
  return true;
}

function openDeviceIdentityDatabase(browser) {
  const indexedDB = browser?.indexedDB;
  if (!indexedDB?.open) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DEVICE_SETTINGS_ID_DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(DEVICE_SETTINGS_ID_STORE_NAME)) {
        database.createObjectStore(DEVICE_SETTINGS_ID_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('기기 식별자 저장소를 열지 못했습니다.'));
  });
}

function createIndexedDbDeviceIdentityStore(browser) {
  if (!browser?.indexedDB?.open) return null;
  return {
    async read() {
      const database = await openDeviceIdentityDatabase(browser);
      if (!database) return null;
      try {
        return await new Promise((resolve, reject) => {
          const transaction = database.transaction(DEVICE_SETTINGS_ID_STORE_NAME, 'readonly');
          const request = transaction.objectStore(DEVICE_SETTINGS_ID_STORE_NAME).get(
            DEVICE_SETTINGS_ID_RECORD_KEY
          );
          request.onsuccess = () => resolve(request.result || null);
          request.onerror = () => reject(request.error || new Error('기기 식별자를 읽지 못했습니다.'));
        });
      } finally {
        database.close();
      }
    },
    async write(deviceId) {
      const database = await openDeviceIdentityDatabase(browser);
      if (!database) return;
      try {
        await new Promise((resolve, reject) => {
          const transaction = database.transaction(DEVICE_SETTINGS_ID_STORE_NAME, 'readwrite');
          transaction.objectStore(DEVICE_SETTINGS_ID_STORE_NAME).put(
            deviceId,
            DEVICE_SETTINGS_ID_RECORD_KEY
          );
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(
            transaction.error || new Error('기기 식별자를 저장하지 못했습니다.')
          );
          transaction.onabort = () => reject(
            transaction.error || new Error('기기 식별자 저장이 중단됐습니다.')
          );
        });
      } finally {
        database.close();
      }
    },
  };
}

async function requestPersistentBrowserStorage(browser) {
  try {
    await browser?.navigator?.storage?.persist?.();
  } catch {
    // The redundant identity copy still works when persistence cannot be granted.
  }
}

function withDurableIdentityTimeout(promise) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('기기 식별자 복구 시간이 초과됐습니다.'));
    }, DURABLE_IDENTITY_TIMEOUT_MS);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      }
    );
  });
}

export function getDeviceSettingsIdentity({ browser: browserArg, storage: storageArg } = {}) {
  const browser = getBrowserContext(browserArg);
  const legacyDeviceId = getLegacyDeviceFingerprint(browser);
  const recoveryDeviceId = getStableRecoveryDeviceFingerprint(browser);
  const storage = storageArg || browser?.localStorage;
  if (!browser) {
    return { deviceId: legacyDeviceId, legacyDeviceId, recoveryDeviceId };
  }

  const storedId = readStorageValueWithCookieBackup(
    DEVICE_SETTINGS_ID_STORAGE_KEY,
    storage,
    browser.document
  );
  if (isStoredDeviceSettingsId(storedId)) {
    persistDeviceSettingsId(storedId, browser, storage);
    return { deviceId: storedId, legacyDeviceId, recoveryDeviceId };
  }

  const deviceId = createDeviceSettingsId(legacyDeviceId, browser);
  persistDeviceSettingsId(deviceId, browser, storage);
  return { deviceId, legacyDeviceId, recoveryDeviceId };
}

/**
 * localStorage와 cookie가 시작 시점에 비어 있어도 IndexedDB에 남은 설치 ID를
 * 먼저 복구합니다. 동일한 화면/브라우저 지문을 가진 여러 데스크톱이 공용
 * fallback 프로필을 덮어쓰지 않도록 원격 설정을 읽고 쓰기 전에 호출합니다.
 */
export async function getDurableDeviceSettingsIdentity({
  browser: browserArg,
  storage: storageArg,
  durableStore: durableStoreArg,
} = {}) {
  const browser = getBrowserContext(browserArg);
  const storage = storageArg || browser?.localStorage;
  const currentIdentity = getDeviceSettingsIdentity({ browser, storage });
  if (!browser) return currentIdentity;

  const durableStore = durableStoreArg || createIndexedDbDeviceIdentityStore(browser);
  if (!durableStore) return currentIdentity;

  try {
    const durableId = await withDurableIdentityTimeout(durableStore.read());
    if (isStoredDeviceSettingsId(durableId)) {
      persistDeviceSettingsId(durableId, browser, storage);
      await requestPersistentBrowserStorage(browser);
      return {
        ...currentIdentity,
        deviceId: durableId,
      };
    }

    await withDurableIdentityTimeout(durableStore.write(currentIdentity.deviceId));
    await requestPersistentBrowserStorage(browser);
  } catch {
    // Continue with the localStorage/cookie identity when IndexedDB is unavailable.
  }
  return currentIdentity;
}

export function getDeviceSettingsForIdentity(settingsMap, identity = getDeviceSettingsIdentity()) {
  if (!settingsMap || typeof settingsMap !== 'object' || Array.isArray(settingsMap)) return null;
  return settingsMap[identity.deviceId]
    || settingsMap[identity.legacyDeviceId]
    || settingsMap[identity.recoveryDeviceId]
    || null;
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
  if (
    identity.recoveryDeviceId &&
    identity.recoveryDeviceId !== identity.deviceId &&
    identity.recoveryDeviceId !== identity.legacyDeviceId
  ) {
    nextMap[identity.recoveryDeviceId] = nextProfile;
  }

  return nextMap;
}
