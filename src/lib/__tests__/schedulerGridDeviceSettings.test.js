import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSchedulerGridDeviceSettingsMap,
  normalizeSchedulerGridDeviceSettingsPatch,
  persistLocalSchedulerGridDeviceSettingsPatch,
  readLocalSchedulerGridDeviceSettings,
  resolveSchedulerGridDeviceSettingsPatch,
  SCHEDULER_GRID_DEVICE_SETTING_KEYS,
} from '../schedulerGridDeviceSettings.js';

function createStorage(entries = {}) {
  const values = new Map(Object.entries(entries));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

test('normalizes and persists every scheduler grid display field', () => {
  const storage = createStorage();
  const normalized = persistLocalSchedulerGridDeviceSettingsPatch({
    colRatios: [1.2, 0.1, '2'],
    dayColWidth: 184.4,
    rowHeight: 26.24,
    timeColWidth: 73,
  }, storage);

  assert.deepEqual(normalized, {
    colRatios: [1.2, 0.2, 2],
    dayColWidth: 184,
    rowHeight: 26,
    timeColWidth: 73,
  });
  assert.deepEqual(readLocalSchedulerGridDeviceSettings(storage).values, normalized);
});

test('ignores malformed local values instead of replacing valid defaults', () => {
  const storage = createStorage({
    [SCHEDULER_GRID_DEVICE_SETTING_KEYS.colRatios]: '{bad json',
    [SCHEDULER_GRID_DEVICE_SETTING_KEYS.rowHeight]: 'not-a-number',
    [SCHEDULER_GRID_DEVICE_SETTING_KEYS.dayColWidth]: '190',
  });

  const snapshot = readLocalSchedulerGridDeviceSettings(storage);
  assert.deepEqual(snapshot.values, { dayColWidth: 190 });
  assert.deepEqual(snapshot.present, { dayColWidth: true });
});

test('keeps local device values and restores only missing fields from the server profile', () => {
  const identity = { deviceId: 'device-new', legacyDeviceId: 'device-legacy' };
  const patch = resolveSchedulerGridDeviceSettingsPatch({
    monthlySettings: {
      device_settings: {
        'device-legacy': {
          colRatios: [2, 1],
          dayColWidth: 210,
          rowHeight: 34,
          timeColWidth: 88,
        },
      },
    },
    identity,
    localSnapshot: {
      present: { rowHeight: true, timeColWidth: true },
    },
  });

  assert.deepEqual(patch, {
    colRatios: [2, 1],
    dayColWidth: 210,
  });
});

test('merges partial changes with legacy values and preserves other device profiles', () => {
  const identity = { deviceId: 'device-new', legacyDeviceId: 'device-legacy' };
  const result = buildSchedulerGridDeviceSettingsMap({
    monthlySettings: {
      device_settings: {
        'device-legacy': { colRatios: [1, 2], rowHeight: 24 },
        other: { rowHeight: 45 },
      },
    },
    identity,
    patch: { rowHeight: 29.5 },
    updatedAt: '2026-08-08T00:00:00.000Z',
  });

  const expected = {
    colRatios: [1, 2],
    rowHeight: 29.5,
    updatedAt: '2026-08-08T00:00:00.000Z',
  };
  assert.deepEqual(result['device-new'], expected);
  assert.deepEqual(result['device-legacy'], expected);
  assert.deepEqual(result.other, { rowHeight: 45 });
});

test('clamps invalid scheduler grid patches at the persistence boundary', () => {
  assert.deepEqual(normalizeSchedulerGridDeviceSettingsPatch({
    rowHeight: 2,
    dayColWidth: -20,
    colRatios: [],
    timeColWidth: 'bad',
  }), {
    rowHeight: 5,
    dayColWidth: 0,
  });
});
