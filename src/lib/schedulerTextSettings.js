import { getMonthKey } from './settlementSettings';

export const DEFAULT_SCHEDULER_TEXT_SETTINGS = {
  font_size: 13,
  font_weight: 700,
};

function compareMonthKeys(a, b) {
  return String(a || '').localeCompare(String(b || ''));
}

function normalizeFontSize(value) {
  const nextValue = Number(value);
  if (!Number.isFinite(nextValue)) return DEFAULT_SCHEDULER_TEXT_SETTINGS.font_size;
  const clamped = Math.min(18, Math.max(9, nextValue));
  return Math.round(clamped * 2) / 2;
}

function normalizeFontWeight(value) {
  const nextValue = Number(value);
  if (!Number.isFinite(nextValue)) return DEFAULT_SCHEDULER_TEXT_SETTINGS.font_weight;
  const allowed = [500, 600, 700, 800, 900];
  return allowed.includes(nextValue) ? nextValue : DEFAULT_SCHEDULER_TEXT_SETTINGS.font_weight;
}

export const SCHEDULER_TEXT_SETTINGS_KEY = 'shockwave-scheduler-text-settings';

export function getEffectiveSchedulerTextSettings(settings, year, month) {
  if (typeof window === 'undefined') return DEFAULT_SCHEDULER_TEXT_SETTINGS;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SCHEDULER_TEXT_SETTINGS_KEY) || 'null');
    if (parsed) {
      return {
        font_size: normalizeFontSize(parsed.font_size),
        font_weight: normalizeFontWeight(parsed.font_weight),
      };
    }
  } catch {}
  return DEFAULT_SCHEDULER_TEXT_SETTINGS;
}

export function setMonthlySchedulerTextSettings(settings, year, month, nextConfig) {
  if (typeof window === 'undefined') return settings?.monthly_settlement_settings || {};
  try {
    const current = getEffectiveSchedulerTextSettings();
    const updated = {
      font_size: normalizeFontSize(nextConfig?.font_size ?? current.font_size),
      font_weight: normalizeFontWeight(nextConfig?.font_weight ?? current.font_weight),
    };
    window.localStorage.setItem(SCHEDULER_TEXT_SETTINGS_KEY, JSON.stringify(updated));
    window.dispatchEvent(new Event('scheduler-text-settings-changed'));
  } catch {}
  
  return settings?.monthly_settlement_settings || {};
}
