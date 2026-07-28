import {
  getExplicitVisitSuffix,
  parseSchedulerPatientIdentity,
} from './schedulerCellTextUtils.js';
import { stripDoseTagFromContent } from './schedulerContentFormat.js';

export function parseConfiguredManualTherapyEntry(
  rawContent,
  fallbackTherapistName = '',
  prescription = '',
  doseTag = ''
) {
  const source = String(rawContent || '').trim();
  const configuredPrescription = String(prescription || '').trim();
  if (!source || !configuredPrescription) return null;

  const patientSource = doseTag
    ? stripDoseTagFromContent(source, doseTag)
    : source;
  const identity = parseSchedulerPatientIdentity(patientSource);
  const patientName = String(identity?.patientName || '').trim();
  if (!patientName) return null;

  const visitSuffix = getExplicitVisitSuffix(patientSource);
  const numericVisit = visitSuffix.match(/\((\d+)\)/)?.[1] || '';
  const isNewPatient = visitSuffix === '*' || visitSuffix === '(*)';
  const durationMinutes = configuredPrescription.match(/\d{2,3}/)?.[0] || '';

  return {
    patientName: isNewPatient ? `${patientName}*` : patientName,
    therapistName: fallbackTherapistName,
    durationMinutes,
    durationLabel: configuredPrescription,
    chartNumber: String(identity?.patientChart || '').trim(),
    visitCount: isNewPatient ? '1' : visitSuffix === '(-)' ? '-' : numericVisit,
  };
}
