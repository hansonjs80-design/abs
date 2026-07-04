import test from 'node:test';
import assert from 'node:assert/strict';

// mock window & localStorage
const mockStorage = new Map();
global.window = {
  localStorage: {
    setItem(key, value) {
      mockStorage.set(key, value);
    },
    getItem(key) {
      return mockStorage.get(key);
    },
  },
  __lastShockwaveSettingsBackup: null,
};

const SHOCKWAVE_SETTINGS_BACKUP_KEY = 'abs.shockwaveSettingsBackup.v1';

// GeneralSettings.jsx의 백업 함수 로직 복제 테스트
function testBackupCurrentScheduleBeforeSettingsSave({
  currentYear,
  currentMonth,
  swSettings,
  shockwaveMemos,
}) {
  if (typeof window === 'undefined') return true;
  try {
    const snapshot = {
      created_at: new Date().toISOString(),
      year: currentYear,
      month: currentMonth,
      settings: swSettings,
      schedule_memos: shockwaveMemos || {},
    };
    window.localStorage.setItem(SHOCKWAVE_SETTINGS_BACKUP_KEY, JSON.stringify(snapshot));
    window.__lastShockwaveSettingsBackup = snapshot;
    return true;
  } catch (error) {
    console.error('Failed to create shockwave settings backup:', error);
    return false;
  }
}

test('backupCurrentScheduleBeforeSettingsSave stores correct snapshot', () => {
  mockStorage.clear();
  window.__lastShockwaveSettingsBackup = null;

  const testParams = {
    currentYear: 2026,
    currentMonth: 7,
    swSettings: { interval_minutes: 15 },
    shockwaveMemos: { '2026-07-04-1-1-1': '테스트 메모' },
  };

  const success = testBackupCurrentScheduleBeforeSettingsSave(testParams);
  assert.equal(success, true);

  const stored = JSON.parse(mockStorage.get(SHOCKWAVE_SETTINGS_BACKUP_KEY));
  assert.equal(stored.year, 2026);
  assert.equal(stored.month, 7);
  assert.deepEqual(stored.settings, { interval_minutes: 15 });
  assert.deepEqual(stored.schedule_memos, { '2026-07-04-1-1-1': '테스트 메모' });
  assert.ok(stored.created_at);

  assert.deepEqual(window.__lastShockwaveSettingsBackup, stored);
});
