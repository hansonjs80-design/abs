import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LEGACY_SERVICE_WORKER_RELOAD_KEY,
  cleanupLegacyServiceWorkerAndCaches,
} from '../legacyServiceWorkerCleanup.js';

function createSessionStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

test('removes every legacy app cache and reloads a controlled page only once', async () => {
  const deletedCaches = [];
  let reloadCount = 0;
  const sessionStorage = createSessionStorage();
  const browser = {
    navigator: {
      serviceWorker: {
        controller: { state: 'activated' },
        async getRegistrations() {
          return [{ async unregister() { return true; } }];
        },
      },
    },
    caches: {
      async keys() { return ['workbox-old', 'custom-old-shell']; },
      async delete(name) {
        deletedCaches.push(name);
        return true;
      },
    },
    sessionStorage,
    location: {
      reload() { reloadCount += 1; },
    },
  };

  const first = await cleanupLegacyServiceWorkerAndCaches(browser);
  const second = await cleanupLegacyServiceWorkerAndCaches(browser);

  assert.deepEqual(deletedCaches.slice(0, 2), ['workbox-old', 'custom-old-shell']);
  assert.equal(first.reloaded, true);
  assert.equal(second.reloaded, false);
  assert.equal(reloadCount, 1);
  assert.equal(sessionStorage.getItem(LEGACY_SERVICE_WORKER_RELOAD_KEY), '1');
});

test('clears the reload guard after the page is no longer service-worker controlled', async () => {
  const sessionStorage = createSessionStorage();
  sessionStorage.setItem(LEGACY_SERVICE_WORKER_RELOAD_KEY, '1');
  const browser = {
    navigator: {
      serviceWorker: {
        controller: null,
        async getRegistrations() { return []; },
      },
    },
    caches: {
      async keys() { return []; },
      async delete() { return false; },
    },
    sessionStorage,
    location: { reload() {} },
  };

  const result = await cleanupLegacyServiceWorkerAndCaches(browser);

  assert.equal(result.reloaded, false);
  assert.equal(sessionStorage.getItem(LEGACY_SERVICE_WORKER_RELOAD_KEY), null);
});
