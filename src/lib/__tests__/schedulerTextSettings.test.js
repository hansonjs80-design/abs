import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSchedulerTextSettingsMap,
  DEFAULT_SCHEDULER_TEXT_SETTINGS,
  getEffectiveSchedulerTextSettings,
  persistLocalSchedulerTextSettings,
  readLocalSchedulerTextSettings,
  setMonthlySchedulerTextSettings,
  SCHEDULER_TEXT_SETTINGS_KEY,
} from '../schedulerTextSettings.js';

function withLocalStorage(fn) {
  const store = new Map();
  const previousWindow = globalThis.window;
  const previousSetTimeout = globalThis.setTimeout;
  const previousClearTimeout = globalThis.clearTimeout;
  globalThis.window = {
    localStorage: {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, String(value)),
    },
    dispatchEvent: () => {},
  };
  globalThis.setTimeout = () => 1;
  globalThis.clearTimeout = () => {};
  try {
    return fn(store);
  } finally {
    if (previousWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }
    globalThis.setTimeout = previousSetTimeout;
    globalThis.clearTimeout = previousClearTimeout;
  }
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

test('scheduler text settings keeps old device text settings while defaulting time font weight', () => {
  withLocalStorage((store) => {
    store.set(SCHEDULER_TEXT_SETTINGS_KEY, JSON.stringify({
      font_size: 14,
      font_weight: 800,
      time_font_size: 13,
    }));

    const effective = getEffectiveSchedulerTextSettings();
    assert.equal(effective.font_size, 14);
    assert.equal(effective.font_weight, 800);
    assert.equal(effective.time_font_size, 13);
    assert.equal(effective.time_font_weight, DEFAULT_SCHEDULER_TEXT_SETTINGS.time_font_weight);
  });
});

test('scheduler text settings saves time font weight with the existing device text settings payload', () => {
  withLocalStorage((store) => {
    setMonthlySchedulerTextSettings({}, 2026, 7, {
      font_size: 14,
      font_weight: 700,
      time_font_size: 13,
      time_font_weight: 600,
    });

    const saved = JSON.parse(store.get(SCHEDULER_TEXT_SETTINGS_KEY));
    assert.equal(saved.time_font_size, 13);
    assert.equal(saved.time_font_weight, 600);
  });
});

test('scheduler text settings local snapshot remains the device source of truth', () => {
  const storage = {
    values: new Map(),
    getItem(key) { return this.values.get(key) ?? null; },
    setItem(key, value) { this.values.set(key, String(value)); },
  };
  persistLocalSchedulerTextSettings({
    ...DEFAULT_SCHEDULER_TEXT_SETTINGS,
    font_size: 15.5,
    header_height: 41,
  }, storage);

  const snapshot = readLocalSchedulerTextSettings(storage);
  assert.equal(snapshot.hasValue, true);
  assert.equal(snapshot.settings.font_size, 15.5);
  assert.equal(snapshot.settings.header_height, 41);
});

test('scheduler text settings preserves legacy and other device profiles when saving', () => {
  const identity = { deviceId: 'device-new', legacyDeviceId: 'device-legacy' };
  const result = buildSchedulerTextSettingsMap({
    monthlySettings: {
      device_text_settings: {
        'device-legacy': { font_size: 14, header_height: 38 },
        other: { font_size: 11 },
      },
    },
    identity,
    settings: {
      ...DEFAULT_SCHEDULER_TEXT_SETTINGS,
      font_size: 16,
    },
    updatedAt: '2026-08-08T00:00:00.000Z',
  });

  assert.equal(result['device-new'].font_size, 16);
  assert.equal(result['device-new'].updatedAt, '2026-08-08T00:00:00.000Z');
  assert.deepEqual(result['device-legacy'], result['device-new']);
  assert.deepEqual(result.other, { font_size: 11 });
});

test('scheduler text settings survives a Chrome or Edge app restart with empty local storage', () => {
  const document = createCookieDocument();
  const firstStorage = {
    values: new Map(),
    getItem(key) { return this.values.get(key) ?? null; },
    setItem(key, value) { this.values.set(key, String(value)); },
  };
  persistLocalSchedulerTextSettings({
    ...DEFAULT_SCHEDULER_TEXT_SETTINGS,
    font_size: 16,
    font_weight: 900,
    header_height: 44,
    therapist_height: 36,
  }, firstStorage, document);

  const restartedStorage = {
    values: new Map(),
    getItem(key) { return this.values.get(key) ?? null; },
    setItem(key, value) { this.values.set(key, String(value)); },
  };
  const restored = readLocalSchedulerTextSettings(restartedStorage, document);

  assert.equal(restored.hasValue, true);
  assert.equal(restored.settings.font_size, 16);
  assert.equal(restored.settings.font_weight, 900);
  assert.equal(restored.settings.header_height, 44);
  assert.equal(restored.settings.therapist_height, 36);
  assert.ok(restartedStorage.getItem(SCHEDULER_TEXT_SETTINGS_KEY));
});
