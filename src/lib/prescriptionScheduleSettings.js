import {
  DEFAULT_MANUAL_THERAPY_SETTLEMENT,
  DEFAULT_SHOCKWAVE_SETTLEMENT,
  buildBaseSettlementSettings,
  getEffectiveSettlementSettings,
} from './settlementSettings.js';
import { getConfiguredDoseTagFromContent, normalizeDoseTagInput } from './schedulerContentFormat.js';

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
  const base = buildBaseSettlementSettings(settings, type);
  const fallback = type === 'manual_therapy'
    ? DEFAULT_MANUAL_THERAPY_SETTLEMENT
    : DEFAULT_SHOCKWAVE_SETTLEMENT;

  return uniquePrescriptionList(
    effective?.prescriptions,
    base?.prescriptions,
    effective?.hidden_prescriptions,
    base?.hidden_prescriptions,
    effective?.duration_minutes,
    base?.duration_minutes,
    effective?.dose_tags,
    base?.dose_tags,
    fallback.prescriptions
  );
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
      ...(shockwave?.duration_minutes || {}),
      ...(manualTherapy?.duration_minutes || {}),
    },
    doseTags: {
      ...(shockwave?.dose_tags || {}),
      ...(manualTherapy?.dose_tags || {}),
    },
    visitLineBreakPrescriptions: [
      ...(shockwave?.visit_line_break_prescriptions || []),
      ...(manualTherapy?.visit_line_break_prescriptions || []),
    ],
    hiddenPrescriptions: [
      ...(shockwave?.hidden_prescriptions || []),
      ...(manualTherapy?.hidden_prescriptions || []),
    ],
  };
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
