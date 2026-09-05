export const DEFAULT_SHOCKWAVE_SETTLEMENT = {
  prescriptions: ['F1.5', 'F/Rdc', 'F/R'],
  prescription_prices: {
    'F1.5': 50000,
    'F/Rdc': 70000,
    'F/R': 80000,
  },
  cryo_prescriptions: [],
  cryo_prices: {},
  shortcuts: {
    'F/R': '1',
    'F/Rdc': '2',
    'F1.5': '3',
  },
  dose_tags: {},
  duration_minutes: {},
  visit_line_break_prescriptions: [],
  hidden_prescriptions: [],
  incentive_percentage: 7,
};

export const DEFAULT_MANUAL_THERAPY_SETTLEMENT = {
  prescriptions: ['40분', '60분'],
  prescription_prices: {
    '40분': 0,
    '60분': 0,
  },
  cryo_prescriptions: [],
  cryo_prices: {},
  shortcuts: {
    '40분': '4',
    '60분': '6',
  },
  dose_tags: {
    '40분': '40',
    '60분': '60',
  },
  duration_minutes: {
    '40분': 40,
    '60분': 60,
  },
  visit_line_break_prescriptions: ['40분', '60분'],
  hidden_prescriptions: [],
  incentive_percentage: 0,
};

export const DEFAULT_SHINJANG_SPRAY_SETTLEMENT = {
  prescription_incentive_percentages: {},
  therapist_names: null,
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

  const rawShortcuts = isManual
    ? settings?.manual_therapy_shortcuts
    : settings?.shortcuts;
  const rawDoseTags = isManual
    ? settings?.manual_therapy_dose_tags
    : settings?.dose_tags;
  const rawDurationMinutes = isManual
    ? settings?.manual_therapy_duration_minutes
    : settings?.duration_minutes;
  const rawVisitLineBreakPrescriptions = isManual
    ? settings?.manual_therapy_visit_line_break_prescriptions
    : settings?.visit_line_break_prescriptions;
  const rawHiddenPrescriptions = isManual
    ? settings?.manual_therapy_hidden_prescriptions
    : settings?.hidden_prescriptions;

  return {
    prescriptions: Array.isArray(prescriptions) && prescriptions.length > 0
      ? prescriptions.filter(Boolean)
      : fallback.prescriptions,
    prescription_prices: {
      ...fallback.prescription_prices,
      ...(settings?.prescription_prices || {}),
    },
    cryo_prescriptions: fallback.cryo_prescriptions,
    cryo_prices: fallback.cryo_prices,
    prescription_colors: settings?.prescription_colors || {},
    shortcuts: {
      ...fallback.shortcuts,
      ...(rawShortcuts || {}),
    },
    dose_tags: {
      ...fallback.dose_tags,
      ...(rawDoseTags || {}),
    },
    duration_minutes: {
      ...fallback.duration_minutes,
      ...(rawDurationMinutes || {}),
    },
    visit_line_break_prescriptions: Array.isArray(rawVisitLineBreakPrescriptions)
      ? rawVisitLineBreakPrescriptions.filter(Boolean)
      : fallback.visit_line_break_prescriptions,
    hidden_prescriptions: Array.isArray(rawHiddenPrescriptions)
      ? rawHiddenPrescriptions.filter(Boolean)
      : fallback.hidden_prescriptions || [],
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
  const activePrescriptionSet = new Set(prescriptions);
  const shortcuts = Object.fromEntries(
    Object.entries({
      ...base.shortcuts,
      ...(override?.shortcuts || {}),
    }).filter(([prescription]) => activePrescriptionSet.has(prescription))
  );

  return {
    prescriptions,
    prescription_prices: {
      ...base.prescription_prices,
      ...(override?.prescription_prices || {}),
    },
    cryo_prescriptions: Array.isArray(override?.cryo_prescriptions)
      ? override.cryo_prescriptions.filter(Boolean)
      : base.cryo_prescriptions,
    cryo_prices: {
      ...base.cryo_prices,
      ...(override?.cryo_prices || {}),
    },
    prescription_colors: {
      ...base.prescription_colors,
      ...(override?.prescription_colors || {}),
    },
    shortcuts,
    dose_tags: {
      ...base.dose_tags,
      ...(override?.dose_tags || {}),
    },
    duration_minutes: {
      ...base.duration_minutes,
      ...(override?.duration_minutes || {}),
    },
    visit_line_break_prescriptions: Array.isArray(override?.visit_line_break_prescriptions)
      ? override.visit_line_break_prescriptions.filter(Boolean)
      : base.visit_line_break_prescriptions,
    hidden_prescriptions: Array.isArray(override?.hidden_prescriptions)
      ? override.hidden_prescriptions.filter(Boolean)
      : base.hidden_prescriptions || [],
    incentive_percentage: override?.incentive_overridden === true || Number(override?.incentive_percentage) > 0
      ? Number(override?.incentive_percentage) || 0
      : base.incentive_percentage,
    source_month_key: inheritedMonthKey || null,
    target_month_key: monthKey,
  };
}

export function buildPrescriptionClassificationSignature(settings, monthTargets = []) {
  const targets = Array.isArray(monthTargets) ? monthTargets : [];
  return JSON.stringify(targets.map(({ year, month }) => {
    const shockwave = getEffectiveSettlementSettings(settings, year, month, 'shockwave');
    const manualTherapy = getEffectiveSettlementSettings(settings, year, month, 'manual_therapy');
    const toClassificationFields = (value) => ({
      prescriptions: Array.isArray(value?.prescriptions) ? value.prescriptions : [],
      dose_tags: value?.dose_tags || {},
      hidden_prescriptions: Array.isArray(value?.hidden_prescriptions)
        ? value.hidden_prescriptions
        : [],
    });

    return {
      month_key: getMonthKey(year, month),
      shockwave: toClassificationFields(shockwave),
      manual_therapy: toClassificationFields(manualTherapy),
    };
  }));
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
        cryo_prescriptions: Array.isArray(nextConfig?.cryo_prescriptions)
          ? nextConfig.cryo_prescriptions.filter(Boolean)
          : [],
        cryo_prices: nextConfig?.cryo_prices || {},
        prescription_colors: nextConfig?.prescription_colors || {},
        shortcuts: nextConfig?.shortcuts || {},
        ...(nextConfig?.dose_tags ? { dose_tags: nextConfig.dose_tags } : {}),
        ...(nextConfig?.duration_minutes ? { duration_minutes: nextConfig.duration_minutes } : {}),
        visit_line_break_prescriptions: Array.isArray(nextConfig?.visit_line_break_prescriptions)
          ? nextConfig.visit_line_break_prescriptions.filter(Boolean)
          : [],
        hidden_prescriptions: Array.isArray(nextConfig?.hidden_prescriptions)
          ? nextConfig.hidden_prescriptions.filter(Boolean)
          : [],
        incentive_percentage: Number(nextConfig?.incentive_percentage) || 0,
        incentive_overridden: true,
      },
    },
  };
}

export function getEffectiveShinjangSpraySettings(settings, year, month) {
  const monthKey = getMonthKey(year, month);
  const monthlySettings = settings?.monthly_settlement_settings;
  const monthlyEntries = monthlySettings && typeof monthlySettings === 'object' && !Array.isArray(monthlySettings)
    ? monthlySettings
    : {};
  const inheritedMonthKey = Object.keys(monthlyEntries)
    .filter((key) => compareMonthKeys(key, monthKey) <= 0 && monthlyEntries[key]?.shinjang_spray)
    .sort(compareMonthKeys)
    .pop();
  const override = inheritedMonthKey
    ? monthlyEntries[inheritedMonthKey]?.shinjang_spray
    : null;

  return {
    prescription_incentive_percentages: {
      ...DEFAULT_SHINJANG_SPRAY_SETTLEMENT.prescription_incentive_percentages,
      ...(override?.prescription_incentive_percentages || {}),
    },
    therapist_names: Array.isArray(override?.therapist_names)
      ? override.therapist_names.map((name) => String(name || '').trim()).filter(Boolean)
      : DEFAULT_SHINJANG_SPRAY_SETTLEMENT.therapist_names,
    source_month_key: inheritedMonthKey || null,
    target_month_key: monthKey,
  };
}

export function setMonthlyShinjangSpraySettings(settings, year, month, nextConfig) {
  const monthKey = getMonthKey(year, month);
  const existing = settings?.monthly_settlement_settings
    && typeof settings.monthly_settlement_settings === 'object'
    && !Array.isArray(settings.monthly_settlement_settings)
    ? settings.monthly_settlement_settings
    : {};
  const rawPercentages = nextConfig?.prescription_incentive_percentages;
  const prescriptionIncentivePercentages = Object.fromEntries(
    Object.entries(rawPercentages && typeof rawPercentages === 'object' && !Array.isArray(rawPercentages)
      ? rawPercentages
      : {})
      .map(([prescription, percentage]) => [
        String(prescription || '').trim(),
        Math.max(0, Number(percentage) || 0),
      ])
      .filter(([prescription]) => prescription)
  );
  const therapistNames = Array.isArray(nextConfig?.therapist_names)
    ? [...new Set(nextConfig.therapist_names.map((name) => String(name || '').trim()).filter(Boolean))]
    : [];

  return {
    ...existing,
    [monthKey]: {
      ...(existing[monthKey] || {}),
      shinjang_spray: {
        prescription_incentive_percentages: prescriptionIncentivePercentages,
        therapist_names: therapistNames,
      },
    },
  };
}
