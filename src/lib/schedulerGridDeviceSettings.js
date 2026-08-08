import { supabase } from './supabaseClient.js';
import {
  buildDeviceSettingsProfileMap,
  getDeviceSettingsForIdentity,
  getDeviceSettingsIdentity,
} from './deviceSettingsIdentity.js';
import {
  enqueueShockwaveSettingsJsonPatch,
  loadShockwaveSettingsJson,
} from './shockwaveSettingsJsonSync.js';
import { clampScheduleTimeColWidth } from './scheduleGridSizeUtils.js';
import {
  SHOCKWAVE_COL_RATIOS_KEY,
  SHOCKWAVE_DAY_COL_WIDTH_KEY,
  SHOCKWAVE_ROW_HEIGHT_KEY,
  SHOCKWAVE_TIME_COL_WIDTH_KEY,
} from './schedulerUtils.js';

export const SCHEDULER_GRID_DEVICE_SETTING_KEYS = {
  colRatios: SHOCKWAVE_COL_RATIOS_KEY,
  dayColWidth: SHOCKWAVE_DAY_COL_WIDTH_KEY,
  rowHeight: SHOCKWAVE_ROW_HEIGHT_KEY,
  timeColWidth: SHOCKWAVE_TIME_COL_WIDTH_KEY,
};

const DEVICE_SETTINGS_FIELD = 'device_settings';
const DEVICE_SETTING_FIELDS = Object.keys(SCHEDULER_GRID_DEVICE_SETTING_KEYS);
const MIN_COL_RATIO = 0.2;
const MIN_ROW_HEIGHT = 5;
const ROW_HEIGHT_PRECISION = 0.5;
const REMOTE_SAVE_DEBOUNCE_MS = 300;

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function getStorage(storageArg) {
  if (storageArg) return storageArg;
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

function normalizeColRatios(value) {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const normalized = value.map((ratio) => {
    const numeric = Number(ratio);
    return Number.isFinite(numeric) && numeric > 0
      ? Math.max(MIN_COL_RATIO, numeric)
      : 1;
  });
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeNumber(value, minimum, precision = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  return Math.max(minimum, Math.round(numeric / precision) * precision);
}

export function normalizeSchedulerGridDeviceSettingsPatch(settings = {}) {
  const normalized = {};
  if (hasOwn(settings, 'colRatios')) {
    const colRatios = normalizeColRatios(settings.colRatios);
    if (colRatios) normalized.colRatios = colRatios;
  }
  if (hasOwn(settings, 'dayColWidth')) {
    const dayColWidth = normalizeNumber(settings.dayColWidth, 0);
    if (dayColWidth !== undefined) normalized.dayColWidth = dayColWidth;
  }
  if (hasOwn(settings, 'rowHeight')) {
    const rowHeight = normalizeNumber(settings.rowHeight, MIN_ROW_HEIGHT, ROW_HEIGHT_PRECISION);
    if (rowHeight !== undefined) normalized.rowHeight = rowHeight;
  }
  if (hasOwn(settings, 'timeColWidth')) {
    const numeric = Number(settings.timeColWidth);
    if (Number.isFinite(numeric)) {
      normalized.timeColWidth = clampScheduleTimeColWidth(numeric);
    }
  }
  return normalized;
}

export function readLocalSchedulerGridDeviceSettings(storageArg) {
  const storage = getStorage(storageArg);
  const values = {};
  const present = {};
  if (!storage) return { values, present, hasAny: false };

  DEVICE_SETTING_FIELDS.forEach((field) => {
    const key = SCHEDULER_GRID_DEVICE_SETTING_KEYS[field];
    let raw = null;
    try {
      raw = storage.getItem(key);
    } catch {
      raw = null;
    }
    if (raw === null || raw === '') return;

    let value = raw;
    if (field === 'colRatios') {
      try {
        value = JSON.parse(raw);
      } catch {
        return;
      }
    }
    const normalized = normalizeSchedulerGridDeviceSettingsPatch({ [field]: value });
    if (!hasOwn(normalized, field)) return;
    values[field] = normalized[field];
    present[field] = true;
  });

  return {
    values,
    present,
    hasAny: Object.keys(values).length > 0,
  };
}

export function persistLocalSchedulerGridDeviceSettingsPatch(settings, storageArg) {
  const storage = getStorage(storageArg);
  const normalized = normalizeSchedulerGridDeviceSettingsPatch(settings);
  if (!storage) return normalized;

  DEVICE_SETTING_FIELDS.forEach((field) => {
    if (!hasOwn(normalized, field)) return;
    const value = field === 'colRatios'
      ? JSON.stringify(normalized[field])
      : String(normalized[field]);
    try {
      storage.setItem(SCHEDULER_GRID_DEVICE_SETTING_KEYS[field], value);
    } catch {
      // The in-memory UI state remains usable if browser storage is restricted.
    }
  });
  return normalized;
}

function getDeviceSettingsMap(monthlySettings) {
  const map = monthlySettings?.[DEVICE_SETTINGS_FIELD];
  return map && typeof map === 'object' && !Array.isArray(map) ? map : {};
}

export function buildSchedulerGridDeviceSettingsMap({
  monthlySettings,
  identity,
  patch,
  updatedAt,
}) {
  return buildDeviceSettingsProfileMap({
    settingsMap: getDeviceSettingsMap(monthlySettings),
    identity,
    patch: normalizeSchedulerGridDeviceSettingsPatch(patch),
    updatedAt,
  });
}

export function resolveSchedulerGridDeviceSettingsPatch({
  monthlySettings,
  identity,
  localSnapshot,
}) {
  const remoteProfile = getDeviceSettingsForIdentity(
    getDeviceSettingsMap(monthlySettings),
    identity
  );
  if (!remoteProfile) return {};

  const normalizedRemote = normalizeSchedulerGridDeviceSettingsPatch(remoteProfile);
  const patch = {};
  DEVICE_SETTING_FIELDS.forEach((field) => {
    if (localSnapshot?.present?.[field]) return;
    if (hasOwn(normalizedRemote, field)) patch[field] = normalizedRemote[field];
  });
  return patch;
}

export async function syncLoadSchedulerGridDeviceSettings({
  localSnapshot,
  applySettings,
} = {}) {
  try {
    const monthlySettings = await loadShockwaveSettingsJson({ supabaseClient: supabase });
    const identity = getDeviceSettingsIdentity();
    const patch = resolveSchedulerGridDeviceSettingsPatch({
      monthlySettings,
      identity,
      localSnapshot,
    });
    if (Object.keys(patch).length > 0) applySettings?.(patch);
    return patch;
  } catch (error) {
    console.error('Failed to load scheduler grid device settings:', error);
    return null;
  }
}

let backupTimeout = null;
let pendingPatch = {};

export function syncSaveSchedulerGridDeviceSettings(patch) {
  const normalizedPatch = persistLocalSchedulerGridDeviceSettingsPatch(patch);
  if (Object.keys(normalizedPatch).length === 0) return;
  pendingPatch = {
    ...pendingPatch,
    ...normalizedPatch,
  };
  if (backupTimeout) clearTimeout(backupTimeout);

  backupTimeout = setTimeout(async () => {
    const patchToSave = pendingPatch;
    pendingPatch = {};
    try {
      const identity = getDeviceSettingsIdentity();
      await enqueueShockwaveSettingsJsonPatch({
        supabaseClient: supabase,
        scope: 'scheduler-grid-device-settings',
        mutate: (monthlySettings) => ({
          ...monthlySettings,
          [DEVICE_SETTINGS_FIELD]: buildSchedulerGridDeviceSettingsMap({
            monthlySettings,
            identity,
            patch: patchToSave,
            updatedAt: new Date().toISOString(),
          }),
        }),
      });
    } catch (error) {
      console.error('Failed to save scheduler grid device settings:', error);
    }
  }, REMOTE_SAVE_DEBOUNCE_MS);
}
