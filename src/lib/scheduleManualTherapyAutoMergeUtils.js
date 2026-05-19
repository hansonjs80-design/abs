import { buildManualTherapyMergePayload, getManualTherapyRowSpan } from './manualTherapyMergeUtils.js';
import { get4060PrescriptionFromContent } from './schedulerContentFormat.js';

export function resolveManualTherapyAutoPrescription({ content = '', prescription = '' } = {}) {
  const explicitPrescription = String(prescription || '').trim();
  if (getManualTherapyRowSpan(explicitPrescription) > 1) return explicitPrescription;

  const contentPrescription = get4060PrescriptionFromContent(content);
  if (getManualTherapyRowSpan(contentPrescription) > 1) return contentPrescription;

  return '';
}

export function buildManualTherapyAutoMergePayload({
  content = '',
  prescription = '',
  ...rest
}) {
  const resolvedPrescription = resolveManualTherapyAutoPrescription({ content, prescription });
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
  });

  return {
    ...result,
    resolvedPrescription,
  };
}
