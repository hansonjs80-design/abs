import { getPrescriptionFromConfiguredDoseTag, getPrescriptionScheduleSettings } from './prescriptionScheduleSettings.js';
import { get4060PrescriptionFromContent, normalizeConfiguredDoseTagInContent } from './schedulerContentFormat.js';

// Loading a month must not reinterpret an explicitly saved prescription using
// an old dose tag still present in the cell text. Inference is for missing data only.
export function resolveLoadedSchedulePrescription(memo, settings, year, month) {
  const content = String(memo?.content || '').trim();
  const prescription = String(memo?.prescription || '').trim();
  if (prescription) return { content, prescription };
  const config = getPrescriptionScheduleSettings(settings, year, month);
  const normalizedContent = normalizeConfiguredDoseTagInContent(content, config.doseTags);
  const inferred = getPrescriptionFromConfiguredDoseTag(settings, year, month, normalizedContent);
  const legacy = get4060PrescriptionFromContent(normalizedContent);
  return {
    content: normalizedContent,
    prescription: inferred || (config.schedulerPrescriptions.all.includes(legacy) ? legacy : ''),
  };
}
