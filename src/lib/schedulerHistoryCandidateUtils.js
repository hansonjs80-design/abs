import { getExplicitVisitSuffix } from './schedulerCellTextUtils.js';

export function shouldUseScheduleContentForPatientHistory(content) {
  const value = String(content || '').trim();
  if (!value) return false;
  return Boolean(getExplicitVisitSuffix(value));
}

export function isUnmarkedSameDaySchedulerLog(row, targetDate) {
  const date = String(row?.date || '').trim();
  if (!targetDate || date !== targetDate) return false;

  const hasSchedulerSource = String(row?.source || '').trim() === 'scheduler' ||
    Boolean(String(row?.scheduler_cell_key || '').trim());
  if (!hasSchedulerSource) return false;

  const patientName = String(row?.patient_name || '').trim();
  if (!patientName || patientName.includes('*')) return false;

  const visitCount = String(row?.visit_count || '').trim();
  return !visitCount || visitCount === '1';
}
