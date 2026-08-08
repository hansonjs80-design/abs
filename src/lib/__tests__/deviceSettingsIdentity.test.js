import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildDeviceSettingsProfileMap,
  DEVICE_SETTINGS_ID_STORAGE_KEY,
  getDeviceSettingsForIdentity,
  getDeviceSettingsIdentity,
  getLegacyDeviceFingerprint,
} from '../deviceSettingsIdentity.js';

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

function createCookieDocument() {
  const values = new Map();
  return {
    get cookie() {
      return Array.from(values, ([key, value]) => `${key}=${value}`).join('; ');
    },
    set cookie(serialized) {
      const [pair] = String(serialized).split(';');
      const separator = pair.indexOf('=');
      values.set(pair.slice(0, separator), pair.slice(separator + 1));
    },
  };
}

const browser = {
  screen: { width: 1920, height: 1080, colorDepth: 24 },
  navigator: { userAgent: 'test-browser' },
  crypto: { randomUUID: () => '12345678-1234-1234-1234-123456789abc' },
};

describe('device settings identity', () => {
  it('creates and reuses a browser-installation-specific identifier', () => {
    const storage = createStorage();
    const first = getDeviceSettingsIdentity({ browser, storage });
    const second = getDeviceSettingsIdentity({ browser, storage });

    assert.equal(first.deviceId, second.deviceId);
    assert.match(first.deviceId, /^dev_\d+_12345678123412341234$/);
    assert.equal(first.legacyDeviceId, getLegacyDeviceFingerprint(browser));
  });

  it('uses an existing stored identifier without replacing it', () => {
    const storage = createStorage({
      [DEVICE_SETTINGS_ID_STORAGE_KEY]: 'dev_existing_installation',
    });

    assert.equal(
      getDeviceSettingsIdentity({ browser, storage }).deviceId,
      'dev_existing_installation'
    );
  });

  it('falls back to legacy settings so existing device preferences are preserved', () => {
    const identity = {
      deviceId: 'dev_new_installation',
      legacyDeviceId: 'dev_legacy',
    };

    assert.deepEqual(
      getDeviceSettingsForIdentity({
        dev_legacy: { dateFontSize: 17 },
      }, identity),
      { dateFontSize: 17 }
    );
  });

  it('merges a legacy profile into both stable device aliases without touching other devices', () => {
    const identity = {
      deviceId: 'dev_new_installation',
      legacyDeviceId: 'dev_legacy',
    };
    const result = buildDeviceSettingsProfileMap({
      settingsMap: {
        dev_legacy: { rowHeight: 28, dayColWidth: 180 },
        other_device: { rowHeight: 42 },
      },
      identity,
      patch: { rowHeight: 31 },
      updatedAt: '2026-08-08T00:00:00.000Z',
    });

    const expected = {
      rowHeight: 31,
      dayColWidth: 180,
      updatedAt: '2026-08-08T00:00:00.000Z',
    };
    assert.deepEqual(result.dev_new_installation, expected);
    assert.deepEqual(result.dev_legacy, expected);
    assert.deepEqual(result.other_device, { rowHeight: 42 });
  });

  for (const [browserName, userAgent] of [
    ['Chrome', 'Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36'],
    ['Edge', 'Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0'],
  ]) {
    it(`restores the same ${browserName} device id after app restart clears local storage`, () => {
      const document = createCookieDocument();
      const browserContext = { ...browser, navigator: { userAgent }, document };
      const first = getDeviceSettingsIdentity({
        browser: browserContext,
        storage: createStorage(),
      });
      const restartedStorage = createStorage();
      const restored = getDeviceSettingsIdentity({
        browser: browserContext,
        storage: restartedStorage,
      });

      assert.equal(restored.deviceId, first.deviceId);
      assert.equal(
        restartedStorage.getItem(DEVICE_SETTINGS_ID_STORAGE_KEY),
        first.deviceId
      );
    });
  }
});
