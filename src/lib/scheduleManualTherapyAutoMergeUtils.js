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
    normalizeDoseTagInput(tag).toUpperCase() === contentDoseTag.toUpperCase() &&
    getManualTherapyRowSpan(candidate, { durationMinutesMap, slotMinutes }) > 1
  ))?.[0] || '';
}

export function hasTrailingTextAfterVisitSuffix(content = '') {
  const text = String(content || '').trim();
  if (!text) return false;
  return /(?:\((-|\d+|\*)\)|\*)(?=\S).+$/u.test(text);
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
  oldContent: _oldContent = '',
  oldPrescription: _oldPrescription = '',
  ...rest
}) {
  const finalSlotMinutes = Number(slotMinutes) || 20;

  const resolvedPrescription = resolveManualTherapyAutoPrescription({
    content,
    prescription,
    durationMinutesMap,
    doseTags,
    slotMinutes: finalSlotMinutes,
  });

  const finalPrescription = resolvedPrescription || prescription || '';
  const rowSpan = getManualTherapyRowSpan(finalPrescription, { durationMinutesMap, slotMinutes: finalSlotMinutes });

  // 10분 단위일 때 내용이 존재하면 무조건 최소 2칸 강제 병합 보장
  let targetRowSpan = rowSpan;
  const hasTextContent = String(content || '').trim() && String(content || '').trim() !== '\u200B';
  const hasVisitTrailingText = hasTrailingTextAfterVisitSuffix(content);

  if ((finalSlotMinutes === 10 && hasTextContent) || hasVisitTrailingText) {
    targetRowSpan = Math.max(2, rowSpan);
  }

  if (targetRowSpan <= 1) {
    return {
      ok: false,
      reason: 'not-merged',
      payload: [],
      affectedKeys: [],
      resolvedPrescription: '',
    };
  }

  // targetRowSpan을 buildManualTherapyMergePayload가 정상 파싱하도록 durationMinutesMap에 임시 맵핑
  const tempDurationMap = {
    ...durationMinutesMap,
  };
  if (finalPrescription) {
    tempDurationMap[finalPrescription] = targetRowSpan * finalSlotMinutes;
  } else {
    tempDurationMap[''] = targetRowSpan * finalSlotMinutes;
  }

  const result = buildManualTherapyMergePayload({
    ...rest,
    content,
    prescription: finalPrescription,
    durationMinutesMap: tempDurationMap,
    slotMinutes: finalSlotMinutes,
  });

  return {
    ...result,
    resolvedPrescription: finalPrescription,
  };
}
