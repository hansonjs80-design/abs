export const DEFAULT_SCHEDULER_TEXT_SETTINGS = {
  font_size: 13,
  font_weight: 700,
  header_font_size: 16,
  header_font_weight: 700,
  header_height: 32,
  therapist_font_size: 14,
  therapist_font_weight: 700,
  therapist_height: 29,
};

function normalizeFontSize(value) {
  const nextValue = Number(value);
  if (!Number.isFinite(nextValue)) return DEFAULT_SCHEDULER_TEXT_SETTINGS.font_size;
  const clamped = Math.min(18, Math.max(9, nextValue));
  return Math.round(clamped * 2) / 2;
}

function normalizeHeaderFontSize(value, defaultVal) {
  const nextValue = Number(value);
  if (!Number.isFinite(nextValue)) return defaultVal;
  const clamped = Math.min(24, Math.max(10, nextValue));
  return Math.round(clamped * 2) / 2;
}

function normalizeFontWeight(value, defaultVal = 700) {
  const nextValue = Number(value);
  if (!Number.isFinite(nextValue)) return defaultVal;
  const allowed = [500, 600, 700, 800, 900];
  return allowed.includes(nextValue) ? nextValue : defaultVal;
}

function normalizeHeaderHeight(value, defaultVal) {
  const nextValue = Number(value);
  if (!Number.isFinite(nextValue)) return defaultVal;
  return Math.min(80, Math.max(15, Math.round(nextValue)));
}

export const SCHEDULER_TEXT_SETTINGS_KEY = 'shockwave-scheduler-text-settings';

export function getEffectiveSchedulerTextSettings() {
  if (typeof window === 'undefined') return DEFAULT_SCHEDULER_TEXT_SETTINGS;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SCHEDULER_TEXT_SETTINGS_KEY) || 'null');
    if (parsed) {
      return {
        font_size: normalizeFontSize(parsed.font_size),
        font_weight: normalizeFontWeight(parsed.font_weight, DEFAULT_SCHEDULER_TEXT_SETTINGS.font_weight),
        header_font_size: normalizeHeaderFontSize(parsed.header_font_size, DEFAULT_SCHEDULER_TEXT_SETTINGS.header_font_size),
        header_font_weight: normalizeFontWeight(parsed.header_font_weight, DEFAULT_SCHEDULER_TEXT_SETTINGS.header_font_weight),
        header_height: normalizeHeaderHeight(parsed.header_height, DEFAULT_SCHEDULER_TEXT_SETTINGS.header_height),
        therapist_font_size: normalizeHeaderFontSize(parsed.therapist_font_size, DEFAULT_SCHEDULER_TEXT_SETTINGS.therapist_font_size),
        therapist_font_weight: normalizeFontWeight(parsed.therapist_font_weight, DEFAULT_SCHEDULER_TEXT_SETTINGS.therapist_font_weight),
        therapist_height: normalizeHeaderHeight(parsed.therapist_height, DEFAULT_SCHEDULER_TEXT_SETTINGS.therapist_height),
      };
    }
  } catch {
    // Ignored
  }
  return DEFAULT_SCHEDULER_TEXT_SETTINGS;
}

export function setMonthlySchedulerTextSettings(settings, _year, _month, nextConfig) {
  if (typeof window === 'undefined') return settings?.monthly_settlement_settings || {};
  try {
    const current = getEffectiveSchedulerTextSettings();
    const updated = {
      font_size: normalizeFontSize(nextConfig?.font_size ?? current.font_size),
      font_weight: normalizeFontWeight(nextConfig?.font_weight ?? current.font_weight, DEFAULT_SCHEDULER_TEXT_SETTINGS.font_weight),
      header_font_size: normalizeHeaderFontSize(nextConfig?.header_font_size ?? current.header_font_size, DEFAULT_SCHEDULER_TEXT_SETTINGS.header_font_size),
      header_font_weight: normalizeFontWeight(nextConfig?.header_font_weight ?? current.header_font_weight, DEFAULT_SCHEDULER_TEXT_SETTINGS.header_font_weight),
      header_height: normalizeHeaderHeight(nextConfig?.header_height ?? current.header_height, DEFAULT_SCHEDULER_TEXT_SETTINGS.header_height),
      therapist_font_size: normalizeHeaderFontSize(nextConfig?.therapist_font_size ?? current.therapist_font_size, DEFAULT_SCHEDULER_TEXT_SETTINGS.therapist_font_size),
      therapist_font_weight: normalizeFontWeight(nextConfig?.therapist_font_weight ?? current.therapist_font_weight, DEFAULT_SCHEDULER_TEXT_SETTINGS.therapist_font_weight),
      therapist_height: normalizeHeaderHeight(nextConfig?.therapist_height ?? current.therapist_height, DEFAULT_SCHEDULER_TEXT_SETTINGS.therapist_height),
    };
    window.localStorage.setItem(SCHEDULER_TEXT_SETTINGS_KEY, JSON.stringify(updated));
    window.dispatchEvent(new Event('scheduler-text-settings-changed'));
  } catch {
    // Ignored
  }
  
  return settings?.monthly_settlement_settings || {};
}
