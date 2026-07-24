import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
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
});
