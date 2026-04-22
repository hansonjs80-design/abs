export const DEFAULT_SHOCKWAVE_SETTLEMENT = {
  prescriptions: ['F1.5', 'F/Rdc', 'F/R'],
  prescription_prices: {
    'F1.5': 50000,
    'F/Rdc': 70000,
    'F/R': 80000,
  },
  incentive_percentage: 7,
};

export const DEFAULT_MANUAL_THERAPY_SETTLEMENT = {
  prescriptions: ['40분', '60분'],
  prescription_prices: {
    '40분': 0,
    '60분': 0,
  },
  incentive_percentage: 0,
};

export function getMonthKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function compareMonthKeys(a, b) {
  return String(a || '').localeCompare(String(b || ''));
}

export function buildBaseSettlementSettings(settings, type = 'shockwave') {
  const isManual = type === 'manual_therapy';
  const prescriptions = isManual
    ? settings?.manual_therapy_prescriptions
    : settings?.prescriptions;
  const fallback = isManual ? DEFAULT_MANUAL_THERAPY_SETTLEMENT : DEFAULT_SHOCKWAVE_SETTLEMENT;

  return {
    prescriptions: Array.isArray(prescriptions) && prescriptions.length > 0
      ? prescriptions.filter(Boolean)
      : fallback.prescriptions,
    prescription_prices: {
      ...fallback.prescription_prices,
      ...(settings?.prescription_prices || {}),
    },
    prescription_colors: settings?.prescription_colors || {},
    incentive_percentage: isManual
      ? settings?.manual_therapy_incentive_percentage ?? fallback.incentive_percentage
      : settings?.incentive_percentage ?? fallback.incentive_percentage,
  };
}

export function getEffectiveSettlementSettings(settings, year, month, type = 'shockwave') {
  const base = buildBaseSettlementSettings(settings, type);
  const monthKey = getMonthKey(year, month);
  const monthlySettings = settings?.monthly_settlement_settings;
  const monthlyEntries = monthlySettings && typeof monthlySettings === 'object' && !Array.isArray(monthlySettings)
    ? monthlySettings
    : {};

  const inheritedMonthKey = Object.keys(monthlyEntries)
    .filter((key) => compareMonthKeys(key, monthKey) <= 0 && monthlyEntries[key]?.[type])
    .sort(compareMonthKeys)
    .pop();

  const override = inheritedMonthKey ? monthlyEntries[inheritedMonthKey]?.[type] : null;
  const prescriptions = Array.isArray(override?.prescriptions) && override.prescriptions.length > 0
    ? override.prescriptions.filter(Boolean)
    : base.prescriptions;

  return {
    prescriptions,
    prescription_prices: {
      ...base.prescription_prices,
      ...(override?.prescription_prices || {}),
    },
    prescription_colors: {
      ...base.prescription_colors,
      ...(override?.prescription_colors || {}),
    },
    incentive_percentage: override?.incentive_overridden === true || Number(override?.incentive_percentage) > 0
      ? Number(override?.incentive_percentage) || 0
      : base.incentive_percentage,
    source_month_key: inheritedMonthKey || null,
    target_month_key: monthKey,
  };
}

export function setMonthlySettlementSettings(settings, year, month, type, nextConfig) {
  const monthKey = getMonthKey(year, month);
  const existing = settings?.monthly_settlement_settings && typeof settings.monthly_settlement_settings === 'object'
    ? settings.monthly_settlement_settings
    : {};

  return {
    ...existing,
    [monthKey]: {
      ...(existing[monthKey] || {}),
      [type]: {
        prescriptions: Array.isArray(nextConfig?.prescriptions) ? nextConfig.prescriptions.filter(Boolean) : [],
        prescription_prices: nextConfig?.prescription_prices || {},
        prescription_colors: nextConfig?.prescription_colors || {},
        incentive_percentage: Number(nextConfig?.incentive_percentage) || 0,
        incentive_overridden: true,
      },
    },
  };
}
