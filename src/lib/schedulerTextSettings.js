import { supabase } from './supabaseClient.js';
import {
  readStorageValueWithCookieBackup,
  writeStorageValueWithCookieBackup,
} from './browserStorageBackup.js';
import {
  buildDeviceSettingsProfileMap,
  getDeviceSettingsForIdentity,
  getDeviceSettingsIdentity,
} from './deviceSettingsIdentity.js';
import {
  enqueueShockwaveSettingsJsonPatch,
  loadShockwaveSettingsJson,
} from './shockwaveSettingsJsonSync.js';

export const DEFAULT_SCHEDULER_TEXT_SETTINGS = {
  font_size: 13,
  font_weight: 700,
  time_font_size: 12,
  time_font_weight: 700,
  header_font_size: 16,
  header_font_weight: 700,
  header_height: 32,
  therapist_font_size: 14,
  therapist_font_weight: 700,
  therapist_height: 29,
};

export const SCHEDULER_TEXT_SETTINGS_KEY = 'shockwave-scheduler-text-settings';
export const SCHEDULER_TEXT_SETTINGS_EVENT = 'scheduler-text-settings-changed';

const DEVICE_SETTINGS_FIELD = 'device_text_settings';
const REMOTE_SAVE_DEBOUNCE_MS = 300;

function normalizeFontSize(value) {
  const nextValue = Number(value);
  if (!Number.isFinite(nextValue)) return DEFAULT_SCHEDULER_TEXT_SETTINGS.font_size;
  const clamped = Math.min(18, Math.max(9, nextValue));
  return Math.round(clamped * 2) / 2;
}

function normalizeHeaderFontSize(value, defaultValue) {
  const nextValue = Number(value);
  if (!Number.isFinite(nextValue)) return defaultValue;
  const clamped = Math.min(24, Math.max(10, nextValue));
  return Math.round(clamped * 2) / 2;
}

function normalizeTimeFontSize(value) {
  const nextValue = Number(value);
  if (!Number.isFinite(nextValue)) return DEFAULT_SCHEDULER_TEXT_SETTINGS.time_font_size;
  const clamped = Math.min(16, Math.max(8, nextValue));
  return Math.round(clamped * 2) / 2;
}

function normalizeFontWeight(value, defaultValue = 700) {
  const nextValue = Number(value);
  if (!Number.isFinite(nextValue)) return defaultValue;
  const allowed = [500, 600, 700, 800, 900];
  return allowed.includes(nextValue) ? nextValue : defaultValue;
}

function normalizeHeaderHeight(value, defaultValue) {
  const nextValue = Number(value);
  if (!Number.isFinite(nextValue)) return defaultValue;
  return Math.min(80, Math.max(10, Math.round(nextValue)));
}

export function normalizeSchedulerTextSettings(settings = {}) {
  return {
    font_size: normalizeFontSize(settings.font_size),
    font_weight: normalizeFontWeight(
      settings.font_weight,
      DEFAULT_SCHEDULER_TEXT_SETTINGS.font_weight
    ),
    time_font_size: normalizeTimeFontSize(settings.time_font_size),
    time_font_weight: normalizeFontWeight(
      settings.time_font_weight,
      DEFAULT_SCHEDULER_TEXT_SETTINGS.time_font_weight
    ),
    header_font_size: normalizeHeaderFontSize(
      settings.header_font_size,
      DEFAULT_SCHEDULER_TEXT_SETTINGS.header_font_size
    ),
    header_font_weight: normalizeFontWeight(
      settings.header_font_weight,
      DEFAULT_SCHEDULER_TEXT_SETTINGS.header_font_weight
    ),
    header_height: normalizeHeaderHeight(
      settings.header_height,
      DEFAULT_SCHEDULER_TEXT_SETTINGS.header_height
    ),
    therapist_font_size: normalizeHeaderFontSize(
      settings.therapist_font_size,
      DEFAULT_SCHEDULER_TEXT_SETTINGS.therapist_font_size
    ),
    therapist_font_weight: normalizeFontWeight(
      settings.therapist_font_weight,
      DEFAULT_SCHEDULER_TEXT_SETTINGS.therapist_font_weight
    ),
    therapist_height: normalizeHeaderHeight(
      settings.therapist_height,
      DEFAULT_SCHEDULER_TEXT_SETTINGS.therapist_height
    ),
  };
}

function getStorage(storageArg) {
  if (storageArg) return storageArg;
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

function dispatchTextSettingsChanged() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(SCHEDULER_TEXT_SETTINGS_EVENT));
}

export function readLocalSchedulerTextSettings(storageArg, documentArg) {
  const storage = getStorage(storageArg);
  try {
    const raw = readStorageValueWithCookieBackup(
      SCHEDULER_TEXT_SETTINGS_KEY,
      storage,
      documentArg
    );
    if (!raw) {
      return { settings: DEFAULT_SCHEDULER_TEXT_SETTINGS, hasValue: false };
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { settings: DEFAULT_SCHEDULER_TEXT_SETTINGS, hasValue: false };
    }
    return { settings: normalizeSchedulerTextSettings(parsed), hasValue: true };
  } catch {
    return { settings: DEFAULT_SCHEDULER_TEXT_SETTINGS, hasValue: false };
  }
}

export function persistLocalSchedulerTextSettings(settings, storageArg, documentArg) {
  const normalized = normalizeSchedulerTextSettings(settings);
  const storage = getStorage(storageArg);
  writeStorageValueWithCookieBackup(
    SCHEDULER_TEXT_SETTINGS_KEY,
    JSON.stringify(normalized),
    storage,
    documentArg
  );
  return normalized;
}

export function getEffectiveSchedulerTextSettings() {
  return readLocalSchedulerTextSettings().settings;
}

export function buildSchedulerTextSettingsMap({
  monthlySettings,
  identity,
  settings,
  updatedAt,
}) {
  const currentMap = monthlySettings?.[DEVICE_SETTINGS_FIELD];
  return buildDeviceSettingsProfileMap({
    settingsMap: currentMap,
    identity,
    patch: normalizeSchedulerTextSettings(settings),
    updatedAt,
  });
}

export function saveSchedulerTextSettings(nextConfig) {
  const current = getEffectiveSchedulerTextSettings();
  const normalized = persistLocalSchedulerTextSettings({
    ...current,
    ...(nextConfig || {}),
  });
  dispatchTextSettingsChanged();
  syncSaveTextSettings(normalized);
  return normalized;
}

// Legacy callers still receive the untouched shared settings JSON. Display
// settings are device-only and are persisted through the isolated path above.
export function setMonthlySchedulerTextSettings(settings, _year, _month, nextConfig) {
  saveSchedulerTextSettings(nextConfig);
  return settings?.monthly_settlement_settings || {};
}

export async function syncLoadTextSettings({ localSnapshot } = {}) {
  const local = localSnapshot || readLocalSchedulerTextSettings();
  if (local.hasValue) return local.settings;

  try {
    const monthlySettings = await loadShockwaveSettingsJson({ supabaseClient: supabase });
    const deviceTextSettings = monthlySettings?.[DEVICE_SETTINGS_FIELD];
    const remoteSettings = getDeviceSettingsForIdentity(
      deviceTextSettings,
      getDeviceSettingsIdentity()
    );
    if (!remoteSettings) return null;

    const normalized = persistLocalSchedulerTextSettings(remoteSettings);
    dispatchTextSettingsChanged();
    return normalized;
  } catch (error) {
    console.error('Failed to load device text settings from DB:', error);
    return null;
  }
}

let textBackupTimeout = null;
let pendingTextSettings = null;

export function syncSaveTextSettings(textSettings) {
  pendingTextSettings = normalizeSchedulerTextSettings(textSettings);
  if (textBackupTimeout) clearTimeout(textBackupTimeout);

  textBackupTimeout = setTimeout(async () => {
    const settingsToSave = pendingTextSettings;
    pendingTextSettings = null;
    try {
      const identity = getDeviceSettingsIdentity();
      await enqueueShockwaveSettingsJsonPatch({
        supabaseClient: supabase,
        scope: 'scheduler-text-device-settings',
        mutate: (monthlySettings) => ({
          ...monthlySettings,
          [DEVICE_SETTINGS_FIELD]: buildSchedulerTextSettingsMap({
            monthlySettings,
            identity,
            settings: settingsToSave,
            updatedAt: new Date().toISOString(),
          }),
        }),
      });
    } catch (error) {
      console.error('Failed to save device text settings to DB:', error);
    }
  }, REMOTE_SAVE_DEBOUNCE_MS);
}
