const DURABLE_STORAGE_DATABASE_NAME = 'abs-browser-durable-storage-v1';
const DURABLE_STORAGE_STORE_NAME = 'settings';
const DURABLE_STORAGE_TIMEOUT_MS = 3000;

function getBrowserContext(browserArg) {
  if (browserArg) return browserArg;
  return typeof window === 'undefined' ? null : window;
}

function withTimeout(promise) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('브라우저 영구 저장소 응답 시간이 초과됐습니다.'));
    }, DURABLE_STORAGE_TIMEOUT_MS);
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

function openDurableStorageDatabase(browser) {
  const indexedDB = browser?.indexedDB;
  if (!indexedDB?.open) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DURABLE_STORAGE_DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(DURABLE_STORAGE_STORE_NAME)) {
        database.createObjectStore(DURABLE_STORAGE_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('브라우저 영구 저장소를 열지 못했습니다.'));
  });
}

export async function requestPersistentBrowserStorage(browserArg) {
  const browser = getBrowserContext(browserArg);
  const storageManager = browser?.navigator?.storage;
  if (!storageManager) return false;
  try {
    if (await storageManager.persisted?.()) return true;
    return Boolean(await storageManager.persist?.());
  } catch {
    return false;
  }
}

export async function readDurableBrowserValue(key, browserArg) {
  const browser = getBrowserContext(browserArg);
  if (!browser?.indexedDB?.open || !key) return null;
  let database = null;
  try {
    database = await withTimeout(openDurableStorageDatabase(browser));
    if (!database) return null;
    return await withTimeout(new Promise((resolve, reject) => {
      const transaction = database.transaction(DURABLE_STORAGE_STORE_NAME, 'readonly');
      const request = transaction.objectStore(DURABLE_STORAGE_STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error || new Error('브라우저 영구 설정을 읽지 못했습니다.'));
    }));
  } catch {
    return null;
  } finally {
    database?.close?.();
  }
}

export async function writeDurableBrowserValue(key, value, browserArg) {
  const browser = getBrowserContext(browserArg);
  if (!browser?.indexedDB?.open || !key) return false;
  let database = null;
  try {
    await requestPersistentBrowserStorage(browser);
    database = await withTimeout(openDurableStorageDatabase(browser));
    if (!database) return false;
    await withTimeout(new Promise((resolve, reject) => {
      const transaction = database.transaction(DURABLE_STORAGE_STORE_NAME, 'readwrite');
      transaction.objectStore(DURABLE_STORAGE_STORE_NAME).put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(
        transaction.error || new Error('브라우저 영구 설정을 저장하지 못했습니다.')
      );
      transaction.onabort = () => reject(
        transaction.error || new Error('브라우저 영구 설정 저장이 중단됐습니다.')
      );
    }));
    return true;
  } catch {
    return false;
  } finally {
    database?.close?.();
  }
}
