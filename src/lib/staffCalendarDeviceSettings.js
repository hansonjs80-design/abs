import { supabase } from './supabaseClient.js';

export const STAFF_CALENDAR_DEVICE_SETTING_KEYS = {
  colWidth: 'staff-calendar-col-width',
  rowHeight: 'staff-calendar-row-height',
  dateRowHeight: 'staff-calendar-date-row-height',
  memoFontSize: 'staff-calendar-memo-font-size',
  dateFontSize: 'staff-calendar-date-font-size',
  dateFontWeight: 'staff-calendar-date-font-weight',
  weekdayFontSize: 'staff-calendar-weekday-font-size',
  weekdayRowHeight: 'staff-calendar-weekday-row-height',
  lastRowFontSize: 'staff-calendar-last-row-font-size',
  lastRowFontWeight: 'staff-calendar-last-row-font-weight',
};

const SETTINGS_ROW_ID = '00000000-0000-0000-0000-000000000000';
const DEVICE_SETTINGS_FIELD = 'staff_calendar_device_settings';

const DEFAULTS = {
  colWidth: 0,
  rowHeight: 120,
  dateRowHeight: 28,
  memoFontSize: 13,
  dateFontSize: 15,
  dateFontWeight: 700,
  weekdayFontSize: 16,
  weekdayRowHeight: 32,
  lastRowFontSize: 13,
  lastRowFontWeight: 700,
};

const LIMITS = {
  colWidth: { min: 0 },
  rowHeight: { min: 28 },
  dateRowHeight: { min: 16 },
  memoFontSize: { min: 10 },
  dateFontSize: { min: 8 },
  weekdayFontSize: { min: 8 },
  weekdayRowHeight: { min: 20 },
  lastRowFontSize: { min: 8 },
};

const STAFF_CALENDAR_DEVICE_FIELDS = Object.keys(STAFF_CALENDAR_DEVICE_SETTING_KEYS);
const FONT_WEIGHT_FIELDS = new Set(['dateFontWeight', 'lastRowFontWeight']);
const FONT_WEIGHT_OPTIONS = new Set([500, 600, 700, 800, 900]);

function getStorage(storage) {
  if (storage) return storage;
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function clampNumber(value, field) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  if (FONT_WEIGHT_FIELDS.has(field)) {
    return FONT_WEIGHT_OPTIONS.has(numeric) ? numeric : undefined;
  }
  const limit = LIMITS[field];
  if (!limit) return undefined;
  const clamped = Math.max(limit.min, numeric);
  return Math.round(clamped * 2) / 2;
}

export function normalizeStaffCalendarDeviceSettingsPatch(settings = {}) {
  const normalized = {};
  STAFF_CALENDAR_DEVICE_FIELDS.forEach((field) => {
    if (!hasOwn(settings, field)) return;
    const value = clampNumber(settings[field], field);
    if (value !== undefined) normalized[field] = value;
  });
  return normalized;
}

export function normalizeStaffCalendarDeviceSettings(settings = {}) {
  return {
    ...DEFAULTS,
    ...normalizeStaffCalendarDeviceSettingsPatch(settings),
  };
}

export function getStaffCalendarDeviceFingerprint() {
  if (typeof window === 'undefined') return 'default-device';
  try {
    const screenInfo = `${window.screen.width}x${window.screen.height}x${window.screen.colorDepth}`;
    const userAgent = window.navigator.userAgent;
    const raw = `${screenInfo}-${userAgent}`;
    let hash = 0;
    for (let i = 0; i < raw.length; i += 1) {
      const char = raw.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash &= hash;
    }
    return `dev_${Math.abs(hash)}`;
  } catch {
    return 'default-device';
  }
}

export function readLocalStaffCalendarDeviceSettings(storageArg) {
  const storage = getStorage(storageArg);
  const values = {};
  const present = {};
  if (!storage) return { values, present, hasAny: false };

  STAFF_CALENDAR_DEVICE_FIELDS.forEach((field) => {
    const key = STAFF_CALENDAR_DEVICE_SETTING_KEYS[field];
    let raw = null;
    try {
      raw = storage.getItem(key);
    } catch {
      raw = null;
    }
    if (raw === null || raw === '') return;
    const normalized = normalizeStaffCalendarDeviceSettingsPatch({ [field]: raw });
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

async function loadSettingsRow() {
  const query = supabase
    .from('shockwave_settings')
    .select('id, monthly_settlement_settings')
    .order('updated_at', { ascending: false })
    .limit(1)
    .single();

  const { data, error } = await query;
  if (error) return null;
  if (!data || Array.isArray(data)) return null;
  return data;
}

function getDeviceSettingsMap(monthlySettings) {
  const map = monthlySettings?.[DEVICE_SETTINGS_FIELD];
  return map && typeof map === 'object' && !Array.isArray(map) ? map : {};
}

export async function syncLoadStaffCalendarDeviceSettings({ localSnapshot, applySettings } = {}) {
  try {
    const row = await loadSettingsRow();
    if (!row) return null;

    const deviceId = getStaffCalendarDeviceFingerprint();
    const deviceSettingsMap = getDeviceSettingsMap(row.monthly_settlement_settings);
    const mySettings = deviceSettingsMap[deviceId];
    if (!mySettings) return null;

    const normalized = normalizeStaffCalendarDeviceSettingsPatch(mySettings);
    const local = localSnapshot || readLocalStaffCalendarDeviceSettings();
    const patch = {};
    STAFF_CALENDAR_DEVICE_FIELDS.forEach((field) => {
      if (local.present?.[field]) return;
      if (hasOwn(normalized, field)) patch[field] = normalized[field];
    });

    if (Object.keys(patch).length > 0) {
      applySettings?.(patch);
    }
    return normalized;
  } catch (err) {
    console.error('Failed to load staff calendar device settings:', err);
    return null;
  }
}

let backupTimeout = null;
let pendingPatch = {};

export function syncSaveStaffCalendarDeviceSettings(patch) {
  const normalizedPatch = normalizeStaffCalendarDeviceSettingsPatch(patch);
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
      const row = await loadSettingsRow();
      if (!row) return;

      const deviceId = getStaffCalendarDeviceFingerprint();
      const monthlySettings = row.monthly_settlement_settings || {};
      const deviceSettingsMap = getDeviceSettingsMap(monthlySettings);
      const currentDeviceSettings = deviceSettingsMap[deviceId] || {};

      const nextDeviceSettingsMap = {
        ...deviceSettingsMap,
        [deviceId]: {
          ...currentDeviceSettings,
          ...patchToSave,
          updatedAt: new Date().toISOString(),
        },
      };

      const nextMonthlySettings = {
        ...monthlySettings,
        [DEVICE_SETTINGS_FIELD]: nextDeviceSettingsMap,
      };

      const targetId = row.id || SETTINGS_ROW_ID;
      await supabase
        .from('shockwave_settings')
        .update({ monthly_settlement_settings: nextMonthlySettings })
        .eq('id', targetId);
    } catch (err) {
      console.error('Failed to save staff calendar device settings:', err);
    }
  }, 1500);
}
