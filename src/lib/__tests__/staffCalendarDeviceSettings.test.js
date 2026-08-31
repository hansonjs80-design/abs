import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STAFF_CALENDAR_DEVICE_SETTING_KEYS,
  STAFF_CALENDAR_DURABLE_PROFILE_KEY,
  STAFF_CALENDAR_PROFILE_STORAGE_KEY,
  buildStaffCalendarDeviceSettingsMap,
  mergeStaffCalendarDeviceSettingsForBackup,
  mergeStaffCalendarDeviceSettingsSources,
  normalizeStaffCalendarDeviceSettings,
  normalizeStaffCalendarDeviceSettingsPatch,
  parseDurableStaffCalendarDeviceProfile,
  persistLocalStaffCalendarDeviceSettingsPatch,
  readLocalStaffCalendarDeviceSettings,
} from '../staffCalendarDeviceSettings.js';

test('uses a newer durable profile after browser-local staff settings disappear', () => {
  const merged = mergeStaffCalendarDeviceSettingsSources({
    remoteSettings: {
      rowHeight: 132,
      memoFontSize: 14,
      updatedAt: '2026-08-30T09:00:00.000Z',
    },
    durableProfile: {
      values: {
        rowHeight: 148,
        dateFontSize: 18,
      },
      savedAt: '2026-08-31T09:00:00.000Z',
    },
    localSnapshot: {
      values: {},
      present: {},
    },
  });

  assert.deepEqual(merged, {
    rowHeight: 148,
    memoFontSize: 14,
    dateFontSize: 18,
  });
});

test('keeps current local staff settings authoritative over durable and remote backups', () => {
  const merged = mergeStaffCalendarDeviceSettingsSources({
    remoteSettings: {
      rowHeight: 132,
      dateFontWeight: 700,
      updatedAt: '2026-08-31T09:00:00.000Z',
    },
    durableProfile: {
      values: { rowHeight: 148, memoFontSize: 15 },
      savedAt: '2026-08-30T09:00:00.000Z',
    },
    localSnapshot: {
      values: { rowHeight: 156, dateFontWeight: 900 },
      present: { rowHeight: true, dateFontWeight: true },
    },
  });

  assert.deepEqual(merged, {
    rowHeight: 156,
    memoFontSize: 15,
    dateFontWeight: 900,
  });
});

test('parses only valid staff calendar values from the durable backup envelope', () => {
  const parsed = parseDurableStaffCalendarDeviceProfile(JSON.stringify({
    values: { rowHeight: 144, dateFontSize: 18, memoFontSize: 'invalid' },
    savedAt: '2026-08-31T09:00:00.000Z',
  }));

  assert.equal(STAFF_CALENDAR_DURABLE_PROFILE_KEY, 'staff-calendar-device-profile-v2');
  assert.deepEqual(parsed, {
    values: { rowHeight: 144, dateFontSize: 18 },
    savedAt: '2026-08-31T09:00:00.000Z',
  });
});

function createStorage(entries = {}) {
  const map = new Map(Object.entries(entries));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
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

test('normalizes staff calendar device settings without dropping existing large values', () => {
  const normalized = normalizeStaffCalendarDeviceSettingsPatch({
    colWidth: 520,
    rowHeight: 310,
    dateRowHeight: 72,
    memoFontSize: 21.5,
    dateFontSize: 19.5,
    weekdayFontSize: 20.5,
    weekdayFontWeight: 900,
    weekdayRowHeight: 82,
    lastRowFontSize: 22.5,
    dateFontWeight: 800,
    lastRowFontWeight: 900,
  });

  assert.deepEqual(normalized, {
    colWidth: 520,
    rowHeight: 310,
    dateRowHeight: 72,
    memoFontSize: 21.5,
    dateFontSize: 19.5,
    weekdayFontSize: 20.5,
    weekdayFontWeight: 900,
    weekdayRowHeight: 82,
    lastRowFontSize: 22.5,
    dateFontWeight: 800,
    lastRowFontWeight: 900,
  });
});

test('ignores invalid staff calendar values and keeps defaults for full settings', () => {
  const normalized = normalizeStaffCalendarDeviceSettings({
    rowHeight: 12,
    dateFontWeight: 750,
    weekdayFontWeight: 750,
    lastRowFontWeight: 750,
    memoFontSize: 'abc',
    weekdayRowHeight: 6,
  });

  assert.equal(normalized.colWidth, 0);
  assert.equal(normalized.rowHeight, 28);
  assert.equal(normalized.dateFontWeight, 700);
  assert.equal(normalized.weekdayFontWeight, 800);
  assert.equal(normalized.lastRowFontWeight, 700);
  assert.equal(normalized.memoFontSize, 13);
  assert.equal(normalized.weekdayRowHeight, 12);
});

test('reads only existing staff calendar local storage keys', () => {
  const storage = createStorage({
    [STAFF_CALENDAR_DEVICE_SETTING_KEYS.colWidth]: '144',
    [STAFF_CALENDAR_DEVICE_SETTING_KEYS.rowHeight]: '126.5',
    [STAFF_CALENDAR_DEVICE_SETTING_KEYS.dateFontWeight]: '900',
    [STAFF_CALENDAR_DEVICE_SETTING_KEYS.weekdayFontWeight]: '800',
    [STAFF_CALENDAR_DEVICE_SETTING_KEYS.weekdayRowHeight]: '38',
    [STAFF_CALENDAR_DEVICE_SETTING_KEYS.lastRowFontSize]: '14.5',
    [STAFF_CALENDAR_DEVICE_SETTING_KEYS.lastRowFontWeight]: '800',
    [STAFF_CALENDAR_DEVICE_SETTING_KEYS.memoFontSize]: '',
  });

  const snapshot = readLocalStaffCalendarDeviceSettings(storage);

  assert.equal(snapshot.hasAny, true);
  assert.deepEqual(snapshot.values, {
    colWidth: 144,
    rowHeight: 126.5,
    dateFontWeight: 900,
    weekdayFontWeight: 800,
    weekdayRowHeight: 38,
    lastRowFontSize: 14.5,
    lastRowFontWeight: 800,
  });
  assert.deepEqual(snapshot.present, {
    colWidth: true,
    rowHeight: true,
    dateFontWeight: true,
    weekdayFontWeight: true,
    weekdayRowHeight: true,
    lastRowFontSize: true,
    lastRowFontWeight: true,
  });
});

test('persists every desktop table and font-weight setting locally', () => {
  const storage = createStorage();

  const normalized = persistLocalStaffCalendarDeviceSettingsPatch({
    colWidth: 188,
    rowHeight: 144,
    dateRowHeight: 34,
    memoFontSize: 14.5,
    dateFontSize: 17,
    dateFontWeight: 900,
    weekdayFontSize: 18,
    weekdayFontWeight: 800,
    weekdayRowHeight: 38,
    lastRowFontSize: 15,
    lastRowFontWeight: 900,
  }, storage);

  assert.deepEqual(readLocalStaffCalendarDeviceSettings(storage).values, normalized);
  assert.ok(storage.getItem(STAFF_CALENDAR_PROFILE_STORAGE_KEY));
});

test('backs up a complete restored profile while keeping newer local fields authoritative', () => {
  const merged = mergeStaffCalendarDeviceSettingsForBackup(
    {
      colWidth: 184,
      rowHeight: 132,
      dateFontSize: 16,
      weekdayFontWeight: 800,
      updatedAt: '2026-08-21T12:00:00.000Z',
    },
    {
      values: {
        rowHeight: 148,
        dateFontSize: 18,
      },
    }
  );

  assert.deepEqual(merged, {
    colWidth: 184,
    rowHeight: 148,
    dateFontSize: 18,
    weekdayFontWeight: 800,
  });
});

test('restores the complete staff calendar profile after storage is unavailable and the app restarts', () => {
  const unavailableStorage = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
  };
  const restartedStorage = createStorage();
  const document = createCookieDocument();
  const expected = {
    colWidth: 196,
    rowHeight: 148,
    dateRowHeight: 36,
    memoFontSize: 15,
    dateFontSize: 17,
    dateFontWeight: 900,
    weekdayFontSize: 18,
    weekdayFontWeight: 800,
    weekdayRowHeight: 40,
    lastRowFontSize: 16,
    lastRowFontWeight: 900,
  };

  persistLocalStaffCalendarDeviceSettingsPatch(expected, unavailableStorage, document);
  const restored = readLocalStaffCalendarDeviceSettings(restartedStorage, document);

  assert.deepEqual(restored.values, expected);
  assert.equal(restored.hasAny, true);
  assert.ok(restartedStorage.getItem(STAFF_CALENDAR_PROFILE_STORAGE_KEY));
});

test('prefers and repairs the complete profile when abrupt shutdown leaves stale date field mirrors', () => {
  const expectedDateSettings = {
    dateRowHeight: 42,
    dateFontSize: 18.5,
    dateFontWeight: 900,
  };
  const storage = createStorage({
    [STAFF_CALENDAR_PROFILE_STORAGE_KEY]: JSON.stringify({
      rowHeight: 152,
      ...expectedDateSettings,
    }),
    [STAFF_CALENDAR_DEVICE_SETTING_KEYS.dateRowHeight]: '28',
    [STAFF_CALENDAR_DEVICE_SETTING_KEYS.dateFontSize]: '15',
    [STAFF_CALENDAR_DEVICE_SETTING_KEYS.dateFontWeight]: '700',
  });
  const document = createCookieDocument();

  const restored = readLocalStaffCalendarDeviceSettings(storage, document);

  assert.deepEqual(restored.values, {
    rowHeight: 152,
    ...expectedDateSettings,
  });
  Object.entries(expectedDateSettings).forEach(([field, value]) => {
    assert.equal(
      storage.getItem(STAFF_CALENDAR_DEVICE_SETTING_KEYS[field]),
      String(value)
    );
  });
});

test('backs up one desktop profile under installation and stable device ids', () => {
  const identity = {
    deviceId: 'desktop-installation-id',
    legacyDeviceId: 'desktop-stable-id',
    recoveryDeviceId: 'desktop-versionless-recovery-id',
    recoveryDeviceIds: [
      'desktop-versionless-recovery-id',
      'desktop-legacy-recovery-id',
    ],
  };
  const nextMap = buildStaffCalendarDeviceSettingsMap({
    monthlySettings: {
      staff_calendar_device_settings: {
        anotherDevice: { rowHeight: 90 },
        'desktop-stable-id': {
          colWidth: 164,
          dateFontWeight: 800,
        },
      },
    },
    identity,
    patch: {
      rowHeight: 138,
      weekdayFontWeight: 900,
      lastRowFontWeight: 800,
    },
    updatedAt: '2026-07-29T00:00:00.000Z',
  });

  const expectedDeviceSettings = {
    colWidth: 164,
    rowHeight: 138,
    dateFontWeight: 800,
    weekdayFontWeight: 900,
    lastRowFontWeight: 800,
    updatedAt: '2026-07-29T00:00:00.000Z',
  };
  assert.deepEqual(nextMap['desktop-installation-id'], expectedDeviceSettings);
  assert.deepEqual(nextMap['desktop-stable-id'], expectedDeviceSettings);
  assert.deepEqual(nextMap['desktop-versionless-recovery-id'], expectedDeviceSettings);
  assert.deepEqual(nextMap['desktop-legacy-recovery-id'], expectedDeviceSettings);
  assert.deepEqual(nextMap.anotherDevice, { rowHeight: 90 });
});
