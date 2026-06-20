export const SCHEDULE_DEVICE_SETTINGS_STORAGE_KEY = 'abs.scheduleDeviceSettings.v1';
export const SCHEDULE_DEVICE_SETTINGS_EVENT = 'abs:schedule-device-settings-change';

const ALLOWED_INTERVALS = new Set([10, 15, 20, 30, 60]);

function normalizeInterval(value, fallback = 20) {
  const numeric = Number(value);
  if (ALLOWED_INTERVALS.has(numeric)) return numeric;
  const fallbackNumeric = Number(fallback);
  return ALLOWED_INTERVALS.has(fallbackNumeric) ? fallbackNumeric : 20;
}

export function normalizeScheduleDeviceSettings(settings = {}, fallback = {}) {
  const interval = normalizeInterval(settings.interval_minutes, fallback.interval_minutes);
  const timeLabelInterval = normalizeInterval(
    settings.time_label_interval_minutes,
    fallback.time_label_interval_minutes || interval
  );

  return {
    interval_minutes: interval,
    time_label_interval_minutes: timeLabelInterval,
  };
}

export function loadScheduleDeviceSettings(fallback = {}) {
  if (typeof window === 'undefined') {
    return normalizeScheduleDeviceSettings({}, fallback);
  }

  try {
    const raw = window.localStorage.getItem(SCHEDULE_DEVICE_SETTINGS_STORAGE_KEY);
    if (!raw) return normalizeScheduleDeviceSettings({}, fallback);
    return normalizeScheduleDeviceSettings(JSON.parse(raw), fallback);
  } catch {
    return normalizeScheduleDeviceSettings({}, fallback);
  }
}

export function saveScheduleDeviceSettings(settings = {}, fallback = {}) {
  const normalized = normalizeScheduleDeviceSettings(settings, fallback);
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(SCHEDULE_DEVICE_SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
    window.dispatchEvent(new CustomEvent(SCHEDULE_DEVICE_SETTINGS_EVENT, { detail: normalized }));
  }
  return normalized;
}

export function applyScheduleDeviceSettings(settings = {}) {
  const deviceSettings = loadScheduleDeviceSettings(settings);
  return {
    ...settings,
    ...deviceSettings,
  };
}
