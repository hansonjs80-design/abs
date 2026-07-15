import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STAFF_CALENDAR_DEVICE_SETTING_KEYS,
  normalizeStaffCalendarDeviceSettings,
  normalizeStaffCalendarDeviceSettingsPatch,
  readLocalStaffCalendarDeviceSettings,
} from '../staffCalendarDeviceSettings.js';

function createStorage(entries = {}) {
  const map = new Map(Object.entries(entries));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
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
    lastRowFontWeight: 750,
    memoFontSize: 'abc',
  });

  assert.equal(normalized.colWidth, 0);
  assert.equal(normalized.rowHeight, 28);
  assert.equal(normalized.dateFontWeight, 700);
  assert.equal(normalized.lastRowFontWeight, 700);
  assert.equal(normalized.memoFontSize, 13);
});

test('reads only existing staff calendar local storage keys', () => {
  const storage = createStorage({
    [STAFF_CALENDAR_DEVICE_SETTING_KEYS.colWidth]: '144',
    [STAFF_CALENDAR_DEVICE_SETTING_KEYS.rowHeight]: '126.5',
    [STAFF_CALENDAR_DEVICE_SETTING_KEYS.dateFontWeight]: '900',
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
    weekdayRowHeight: 38,
    lastRowFontSize: 14.5,
    lastRowFontWeight: 800,
  });
  assert.deepEqual(snapshot.present, {
    colWidth: true,
    rowHeight: true,
    dateFontWeight: true,
    weekdayRowHeight: true,
    lastRowFontSize: true,
    lastRowFontWeight: true,
  });
});
