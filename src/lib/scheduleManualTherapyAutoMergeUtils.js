import { buildManualTherapyMergePayload, getManualTherapyRowSpan } from './manualTherapyMergeUtils.js';
import { get4060PrescriptionFromContent } from './schedulerContentFormat.js';

function getDoseTagFromContent(content = '') {
  const detectedPrescription = get4060PrescriptionFromContent(content);
  return String(detectedPrescription || '').replace(/[^\d]/g, '');
}

function findPrescriptionByDoseTag(content, doseTags = {}, durationMinutesMap = {}, slotMinutes) {
  const contentDoseTag = getDoseTagFromContent(content);
  if (!contentDoseTag || !doseTags || typeof doseTags !== 'object') return '';
  return Object.entries(doseTags).find(([candidate, tag]) => (
    String(tag || '').trim() === contentDoseTag &&
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
  const explicitPrescription = String(prescription || '').trim();
  if (getManualTherapyRowSpan(explicitPrescription, { durationMinutesMap, slotMinutes }) > 1) return explicitPrescription;

  const doseTagPrescription = findPrescriptionByDoseTag(content, doseTags, durationMinutesMap, slotMinutes);
  if (doseTagPrescription) return doseTagPrescription;

  const contentPrescription = get4060PrescriptionFromContent(content);
  if (getManualTherapyRowSpan(contentPrescription, { durationMinutesMap, slotMinutes }) > 1) return contentPrescription;

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
