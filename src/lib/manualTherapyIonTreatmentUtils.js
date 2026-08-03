import { getMonthKey } from './settlementSettings.js';

export function normalizeManualTherapyIonTreatment(value) {
  const count = String(value?.count ?? '').trim();
  const amount = String(value?.amount ?? '').trim();

  return { count, amount };
}

export function getManualTherapyIonTreatment(settings, year, month) {
  const monthKey = getMonthKey(year, month);
  return normalizeManualTherapyIonTreatment(
    settings?.monthly_settlement_settings?.[monthKey]?.manual_therapy_ion_treatment
  );
}

export function setManualTherapyIonTreatment(settings, year, month, value) {
  const monthKey = getMonthKey(year, month);
  const monthlySettings = settings?.monthly_settlement_settings
    && typeof settings.monthly_settlement_settings === 'object'
    && !Array.isArray(settings.monthly_settlement_settings)
    ? settings.monthly_settlement_settings
    : {};

  return {
    ...monthlySettings,
    [monthKey]: {
      ...(monthlySettings[monthKey] || {}),
      manual_therapy_ion_treatment: normalizeManualTherapyIonTreatment(value),
    },
  };
}
