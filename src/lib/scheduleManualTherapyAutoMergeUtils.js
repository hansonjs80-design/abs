import { buildManualTherapyMergePayload, getManualTherapyRowSpan } from './manualTherapyMergeUtils.js';
import { get4060PrescriptionFromContent, getConfiguredDoseTagFromContent, normalizeDoseTagInput } from './schedulerContentFormat.js';

function getDoseTagFromContent(content = '', doseTags = {}) {
  const configuredTag = getConfiguredDoseTagFromContent(content, doseTags);
  if (configuredTag) return configuredTag;
  const detectedPrescription = get4060PrescriptionFromContent(content);
  return String(detectedPrescription || '').replace(/[^\d]/g, '');
}

function findPrescriptionByDoseTag(content, doseTags = {}, durationMinutesMap = {}, slotMinutes) {
  const contentDoseTag = getDoseTagFromContent(content, doseTags);
  if (!contentDoseTag || !doseTags || typeof doseTags !== 'object') return '';
  return Object.entries(doseTags).find(([candidate, tag]) => (
    normalizeDoseTagInput(tag) === contentDoseTag &&
    getManualTherapyRowSpan(candidate, { durationMinutesMap, slotMinutes }) > 1
  ))?.[0] || '';
}

export function resolveManualTherapyAutoPrescription({
  content = '',
  prescription = '',
  durationMinutesMap = {},
  doseTags = {},
  slotMinutes,
} = {}) {
  const doseTagPrescription = findPrescriptionByDoseTag(content, doseTags, durationMinutesMap, slotMinutes);
  if (doseTagPrescription) return doseTagPrescription;

  const contentPrescription = get4060PrescriptionFromContent(content);
  if (getManualTherapyRowSpan(contentPrescription, { durationMinutesMap, slotMinutes }) > 1) return contentPrescription;

  const explicitPrescription = String(prescription || '').trim();
  if (getManualTherapyRowSpan(explicitPrescription, { durationMinutesMap, slotMinutes }) > 1) return explicitPrescription;

  return '';
}

export function buildManualTherapyAutoMergePayload({
  content = '',
  prescription = '',
  durationMinutesMap = {},
  doseTags = {},
  slotMinutes,
  ...rest
}) {
  const resolvedPrescription = resolveManualTherapyAutoPrescription({
    content,
    prescription,
    durationMinutesMap,
    doseTags,
    slotMinutes,
  });
  if (!resolvedPrescription) {
    return {
      ok: false,
      reason: 'not-manual-therapy',
      payload: [],
      affectedKeys: [],
      resolvedPrescription: '',
    };
  }

  const result = buildManualTherapyMergePayload({
    ...rest,
    content,
    prescription: resolvedPrescription,
    durationMinutesMap,
    slotMinutes,
  });

  return {
    ...result,
    resolvedPrescription,
  };
}
