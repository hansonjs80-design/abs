import {
  getEffectiveSettlementSettings,
} from './settlementSettings.js';
import {
  get4060PrescriptionFromContent,
  getConfiguredDoseTagFromContent,
  normalizeDoseTagInput,
} from './schedulerContentFormat.js';

function uniquePrescriptionList(...sources) {
  const seen = new Set();
  const result = [];
  sources.forEach((source) => {
    if (!source) return;
    const values = Array.isArray(source) ? source : Object.keys(source);
    values.forEach((item) => {
      const value = String(item || '').trim();
      if (!value || seen.has(value)) return;
      seen.add(value);
      result.push(value);
    });
  });
  return result;
}

function buildSchedulerPrescriptionList(settings, year, month, type) {
  const effective = getEffectiveSettlementSettings(settings, year, month, type);

  return uniquePrescriptionList(effective?.prescriptions);
}

function filterPrescriptionMap(source, activePrescriptions) {
  const activeSet = new Set(
    (Array.isArray(activePrescriptions) ? activePrescriptions : [])
      .map((prescription) => String(prescription || '').trim())
      .filter(Boolean)
  );
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {};
  return Object.fromEntries(
    Object.entries(source).filter(([prescription]) => activeSet.has(String(prescription || '').trim()))
  );
}

function filterPrescriptionList(source, activePrescriptions) {
  const activeSet = new Set(
    (Array.isArray(activePrescriptions) ? activePrescriptions : [])
      .map((prescription) => String(prescription || '').trim())
      .filter(Boolean)
  );
  if (!Array.isArray(source)) return [];
  return source.filter((prescription) => activeSet.has(String(prescription || '').trim()));
}

export function getPrescriptionScheduleSettings(settings, year, month) {
  const shockwave = getEffectiveSettlementSettings(settings, year, month, 'shockwave');
  const manualTherapy = getEffectiveSettlementSettings(settings, year, month, 'manual_therapy');
  const schedulerShockwavePrescriptions = buildSchedulerPrescriptionList(settings, year, month, 'shockwave');
  const schedulerManualTherapyPrescriptions = buildSchedulerPrescriptionList(settings, year, month, 'manual_therapy');

  return {
    shockwave,
    manualTherapy,
    schedulerPrescriptions: {
      shockwave: schedulerShockwavePrescriptions,
      manualTherapy: schedulerManualTherapyPrescriptions,
      all: uniquePrescriptionList(schedulerShockwavePrescriptions, schedulerManualTherapyPrescriptions),
    },
    durationMinutesMap: {
      ...filterPrescriptionMap(shockwave?.duration_minutes, schedulerShockwavePrescriptions),
      ...filterPrescriptionMap(manualTherapy?.duration_minutes, schedulerManualTherapyPrescriptions),
    },
    doseTags: {
      ...filterPrescriptionMap(shockwave?.dose_tags, schedulerShockwavePrescriptions),
      ...filterPrescriptionMap(manualTherapy?.dose_tags, schedulerManualTherapyPrescriptions),
    },
    visitLineBreakPrescriptions: [
      ...filterPrescriptionList(shockwave?.visit_line_break_prescriptions, schedulerShockwavePrescriptions),
      ...filterPrescriptionList(manualTherapy?.visit_line_break_prescriptions, schedulerManualTherapyPrescriptions),
    ],
    hiddenPrescriptions: [
      ...(shockwave?.hidden_prescriptions || []),
      ...(manualTherapy?.hidden_prescriptions || []),
    ],
  };
}

function getActiveSchedulerPrescriptionSet(config = {}) {
  const source = Array.isArray(config?.schedulerPrescriptions?.all)
    ? config.schedulerPrescriptions.all
    : [
        ...(Array.isArray(config?.shockwave?.prescriptions) ? config.shockwave.prescriptions : []),
        ...(Array.isArray(config?.manualTherapy?.prescriptions) ? config.manualTherapy.prescriptions : []),
      ];
  return new Set(
    source
      .map((prescription) => String(prescription || '').trim())
      .filter(Boolean)
  );
}

export function isInactiveLegacyManualDoseScheduleItem(item, config = {}) {
  const activePrescriptionSet = getActiveSchedulerPrescriptionSet(config);
  if (activePrescriptionSet.size === 0) return false;

  const content = String(item?.content || '').trim();
  const configuredDoseTag = getConfiguredDoseTagFromContent(content, config?.doseTags || {});
  if (configuredDoseTag) return false;

  const legacyContentPrescription = get4060PrescriptionFromContent(content);
  if (legacyContentPrescription && !activePrescriptionSet.has(legacyContentPrescription)) {
    return true;
  }

  const prescription = String(item?.prescription || '').trim();
  if (/^(?:40|60)분$/u.test(prescription) && !activePrescriptionSet.has(prescription)) {
    return true;
  }

  return false;
}

export function getConfiguredDoseTag(settings, year, month, prescription) {
  const config = getPrescriptionScheduleSettings(settings, year, month);
  return config.doseTags?.[prescription] || '';
}

export function getPrescriptionFromConfiguredDoseTag(settings, year, month, content) {
  const config = getPrescriptionScheduleSettings(settings, year, month);
  const contentTag = getConfiguredDoseTagFromContent(content, config.doseTags);
  if (!contentTag) return '';
  return Object.entries(config.doseTags || {}).find(([, tag]) => (
    normalizeDoseTagInput(tag).toUpperCase() === contentTag.toUpperCase()
  ))?.[0] || '';
}

export function shouldBreakVisitSuffixLine(settings, year, month, prescription) {
  if (!prescription) return false;
  const config = getPrescriptionScheduleSettings(settings, year, month);
  return config.visitLineBreakPrescriptions.includes(prescription);
}
