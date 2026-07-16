import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_SCHEDULER_TEXT_SETTINGS,
  getEffectiveSchedulerTextSettings,
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
