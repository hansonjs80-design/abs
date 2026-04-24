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

export function getEffectiveSchedulerTextSettings(settings, year, month) {
  const monthKey = getMonthKey(year, month);
  const monthlySettings = settings?.monthly_settlement_settings;
  const monthlyEntries = monthlySettings && typeof monthlySettings === 'object' && !Array.isArray(monthlySettings)
    ? monthlySettings
    : {};

  const inheritedMonthKey = Object.keys(monthlyEntries)
    .filter((key) => compareMonthKeys(key, monthKey) <= 0 && monthlyEntries[key]?.scheduler_ui)
    .sort(compareMonthKeys)
    .pop();

  const override = inheritedMonthKey ? monthlyEntries[inheritedMonthKey]?.scheduler_ui : null;

  return {
    font_size: normalizeFontSize(override?.font_size),
    font_weight: normalizeFontWeight(override?.font_weight),
    source_month_key: inheritedMonthKey || null,
    target_month_key: monthKey,
  };
}

export function setMonthlySchedulerTextSettings(settings, year, month, nextConfig) {
  const monthKey = getMonthKey(year, month);
  const existing = settings?.monthly_settlement_settings && typeof settings.monthly_settlement_settings === 'object'
    ? settings.monthly_settlement_settings
    : {};

  return {
    ...existing,
    [monthKey]: {
      ...(existing[monthKey] || {}),
      scheduler_ui: {
        font_size: normalizeFontSize(nextConfig?.font_size),
        font_weight: normalizeFontWeight(nextConfig?.font_weight),
      },
    },
  };
}
