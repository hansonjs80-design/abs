import {
  getEffectiveSettlementSettings,
  getEffectiveShinjangSpraySettings,
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
  const shinjangSpray = getEffectiveShinjangSpraySettings(settings, year, month);
  const isShinjangSpray = (prescription) => String(prescription || '').includes('신장분사');
  const schedulerShinjangSprayPrescriptions = uniquePrescriptionList(shinjangSpray.prescriptions)
    .filter((prescription) => !shinjangSpray.hidden_prescriptions.includes(prescription));
  const shinjangPrescriptionKeys = new Set(
    schedulerShinjangSprayPrescriptions.map(normalizePrescriptionGroupKey)
  );
  const schedulerShockwavePrescriptions = buildSchedulerPrescriptionList(settings, year, month, 'shockwave')
    .filter((prescription) => (
      !isShinjangSpray(prescription)
      && !shinjangPrescriptionKeys.has(normalizePrescriptionGroupKey(prescription))
    ));
  const schedulerManualTherapyPrescriptions = buildSchedulerPrescriptionList(settings, year, month, 'manual_therapy')
    .filter((prescription) => (
      !isShinjangSpray(prescription)
      && !shinjangPrescriptionKeys.has(normalizePrescriptionGroupKey(prescription))
    ));

  return {
    shockwave,
    manualTherapy,
    shinjangSpray,
    schedulerPrescriptions: {
      shockwave: schedulerShockwavePrescriptions,
      manualTherapy: schedulerManualTherapyPrescriptions,
      shinjangSpray: schedulerShinjangSprayPrescriptions,
      all: uniquePrescriptionList(
        schedulerShockwavePrescriptions,
        schedulerManualTherapyPrescriptions,
        schedulerShinjangSprayPrescriptions
      ),
    },
    durationMinutesMap: {
      ...filterPrescriptionMap(shockwave?.duration_minutes, schedulerShockwavePrescriptions),
      ...filterPrescriptionMap(manualTherapy?.duration_minutes, schedulerManualTherapyPrescriptions),
      ...filterPrescriptionMap(shinjangSpray?.duration_minutes, schedulerShinjangSprayPrescriptions),
    },
    doseTags: {
      ...filterPrescriptionMap(shockwave?.dose_tags, schedulerShockwavePrescriptions),
      ...filterPrescriptionMap(manualTherapy?.dose_tags, schedulerManualTherapyPrescriptions),
      ...filterPrescriptionMap(shinjangSpray?.dose_tags, schedulerShinjangSprayPrescriptions),
    },
    visitLineBreakPrescriptions: [
      ...filterPrescriptionList(shockwave?.visit_line_break_prescriptions, schedulerShockwavePrescriptions),
      ...filterPrescriptionList(manualTherapy?.visit_line_break_prescriptions, schedulerManualTherapyPrescriptions),
      ...filterPrescriptionList(shinjangSpray?.visit_line_break_prescriptions, schedulerShinjangSprayPrescriptions),
    ],
    hiddenPrescriptions: [
      ...(shockwave?.hidden_prescriptions || []),
      ...(manualTherapy?.hidden_prescriptions || []),
      ...(shinjangSpray?.hidden_prescriptions || []),
    ],
  };
}

export function normalizePrescriptionGroupKey(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function buildPrescriptionGroupKeySet(prescriptions) {
  return new Set(
    (Array.isArray(prescriptions) ? prescriptions : [])
      .map(normalizePrescriptionGroupKey)
      .filter(Boolean)
  );
}

export function getScheduleItemTreatmentGroup(item, settings, year, month) {
  const config = getPrescriptionScheduleSettings(settings, year, month);
  const shinjangSprayPrescriptions = config.schedulerPrescriptions?.shinjangSpray || [];
  const manualPrescriptions = config.schedulerPrescriptions?.manualTherapy || [];
  const shockwavePrescriptions = config.schedulerPrescriptions?.shockwave || [];
  const shinjangSprayKeys = buildPrescriptionGroupKeySet(shinjangSprayPrescriptions);
  const manualKeys = buildPrescriptionGroupKeySet(manualPrescriptions);
  const shockwaveKeys = buildPrescriptionGroupKeySet(shockwavePrescriptions);
  const prescriptionKey = normalizePrescriptionGroupKey(item?.prescription);

  if (
    prescriptionKey
    && (
      shinjangSprayKeys.has(prescriptionKey)
      || String(item?.prescription || '').includes('신장분사')
    )
  ) return 'shinjang_spray';
  if (prescriptionKey && manualKeys.has(prescriptionKey)) return 'manual_therapy';
  if (prescriptionKey && shockwaveKeys.has(prescriptionKey)) return 'shockwave';

  const content = String(item?.content || '').trim();
  const shinjangSprayDoseTags = filterPrescriptionMap(
    config.shinjangSpray?.dose_tags,
    shinjangSprayPrescriptions
  );
  const manualDoseTags = filterPrescriptionMap(config.manualTherapy?.dose_tags, manualPrescriptions);
  const shockwaveDoseTags = filterPrescriptionMap(config.shockwave?.dose_tags, shockwavePrescriptions);
  if (getConfiguredDoseTagFromContent(content, shinjangSprayDoseTags)) return 'shinjang_spray';
  if (getConfiguredDoseTagFromContent(content, manualDoseTags)) return 'manual_therapy';
  if (getConfiguredDoseTagFromContent(content, shockwaveDoseTags)) return 'shockwave';

  const legacyManualPrescription = get4060PrescriptionFromContent(content);
  if (
    legacyManualPrescription &&
    manualKeys.has(normalizePrescriptionGroupKey(legacyManualPrescription))
  ) {
    return 'manual_therapy';
  }

  return '';
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
