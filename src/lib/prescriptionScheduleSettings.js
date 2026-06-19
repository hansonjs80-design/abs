import { getEffectiveSettlementSettings } from './settlementSettings.js';

export function getPrescriptionScheduleSettings(settings, year, month) {
  const shockwave = getEffectiveSettlementSettings(settings, year, month, 'shockwave');
  const manualTherapy = getEffectiveSettlementSettings(settings, year, month, 'manual_therapy');

  return {
    shockwave,
    manualTherapy,
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
  };
}

export function getConfiguredDoseTag(settings, year, month, prescription) {
  const config = getPrescriptionScheduleSettings(settings, year, month);
  return config.doseTags?.[prescription] || '';
}

export function getPrescriptionFromConfiguredDoseTag(settings, year, month, content) {
  const config = getPrescriptionScheduleSettings(settings, year, month);
  const contentTag = String(content || '').match(/[가-힣a-zA-Z]\s*(\d{2,3})\**($|[(\s])/)?.[1] || '';
  if (!contentTag) return '';
  return Object.entries(config.doseTags || {}).find(([, tag]) => (
    String(tag || '').trim() === contentTag
  ))?.[0] || '';
}

export function shouldBreakVisitSuffixLine(settings, year, month, prescription) {
  if (!prescription) return false;
  const config = getPrescriptionScheduleSettings(settings, year, month);
  return config.visitLineBreakPrescriptions.includes(prescription);
}
