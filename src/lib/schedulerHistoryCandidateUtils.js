import { getExplicitVisitSuffix } from './schedulerCellTextUtils.js';

export function getScheduleDayDateKey(dayInfo) {
  if (!dayInfo) return '';
  const year = Number(dayInfo.year);
  const month = Number(dayInfo.month);
  const day = Number(dayInfo.day);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return '';
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function shouldUseScheduleContentForPatientHistory(content) {
  const value = String(content || '').trim();
  if (!value) return false;
  return Boolean(getExplicitVisitSuffix(value));
}

export function shouldUseScheduleRowForPatientHistory(row, dayInfo, options = {}) {
  const content = String(row?.content || '').trim();
  if (!shouldUseScheduleContentForPatientHistory(content)) return false;
  if (!dayInfo?.isCurrentMonth) return false;

  const dateKey = getScheduleDayDateKey(dayInfo);
  if (!dateKey) return false;

  const targetDate = String(options?.targetDate || '').trim();
  if (targetDate && dateKey > targetDate) return false;

  const targetRowIndex = Number(options?.targetRowIndex);
  const targetColIndex = Number(options?.targetColIndex);
  if (
    targetDate &&
    dateKey === targetDate &&
    Number.isFinite(targetRowIndex) &&
    Number.isFinite(targetColIndex) &&
    Number(row?.row_index) === targetRowIndex &&
    Number(row?.col_index) === targetColIndex
  ) {
    return false;
  }

  return true;
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
