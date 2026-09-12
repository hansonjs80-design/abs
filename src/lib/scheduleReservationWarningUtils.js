import { generateShockwaveCalendar } from './calendarUtils.js';
import { getScheduleItemTreatmentGroup } from './prescriptionScheduleSettings.js';
import { getExplicitVisitSuffix, parseSchedulerPatientIdentity } from './schedulerCellTextUtils.js';
import { getScheduleDayDateKey } from './schedulerHistoryCandidateUtils.js';

function getIdentity(content) {
  const parsed = parseSchedulerPatientIdentity(content);
  return {
    chartNumber: String(parsed?.patientChart || '').trim(),
    name: String(parsed?.patientName || '').replace(/\*/g, '').trim(),
  };
}

function isSamePatient(left, right) {
  // 이름만 같거나 차트번호만 같은 예약은 경고 대상이 아니다.
  return Boolean(
    left?.chartNumber && left?.name
    && left.chartNumber === right?.chartNumber
    && left.name === right?.name
  );
}

function getScheduleDate(row) {
  const weeks = generateShockwaveCalendar(Number(row?.year), Number(row?.month));
  return getScheduleDayDateKey(weeks?.[Number(row?.week_index)]?.[Number(row?.day_index)]);
}

function getMondayWeekKey(dateKey) {
  const date = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  const day = date.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + offset);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

function getVisitCount(content) {
  const suffix = getExplicitVisitSuffix(content);
  const match = suffix.match(/^\((\d+)\)$/);
  return match ? Number(match[1]) : 0;
}

function isTargetRow(row, target) {
  return Number(row?.year) === Number(target?.year)
    && Number(row?.month) === Number(target?.month)
    && Number(row?.week_index) === Number(target?.week_index)
    && Number(row?.day_index) === Number(target?.day_index)
    && Number(row?.row_index) === Number(target?.row_index)
    && Number(row?.col_index) === Number(target?.col_index);
}

/**
 * Determines which booking confirmations should be shown immediately before a
 * scheduler cell is persisted. This stays pure so every save path can share it.
 */
export function buildScheduleReservationWarnings({
  target,
  scheduleRows = [],
  settings,
  year,
  month,
} = {}) {
  const targetContent = String(target?.content || '').trim();
  const targetDate = String(target?.date || '').trim();
  const targetIdentity = getIdentity(targetContent);
  const treatmentGroup = getScheduleItemTreatmentGroup(target, settings, year, month);
  if (!targetDate || !isSamePatient(targetIdentity, targetIdentity)) return [];

  const matchingRows = (Array.isArray(scheduleRows) ? scheduleRows : []).flatMap((row) => {
    if (isTargetRow(row, target) || row?.merge_span?.mergedInto || !String(row?.content || '').trim()) return [];
    const rowDate = getScheduleDate(row);
    if (!rowDate || !isSamePatient(targetIdentity, getIdentity(row.content))) return [];
    return [{ row, date: rowDate, treatmentGroup: getScheduleItemTreatmentGroup(row, settings, year, month) }];
  });

  const warnings = [];
  if (treatmentGroup === 'manual_therapy') {
    const sameWeekDates = new Set(
      matchingRows
        .filter((item) => item.treatmentGroup === 'manual_therapy' && getMondayWeekKey(item.date) === getMondayWeekKey(targetDate))
        .map((item) => item.date)
    );
    if (sameWeekDates.size >= 2) {
      warnings.push({
        type: 'manual-week-limit',
        message: '도수치료 처방은 같은 환자가 한 주에 2일을 초과해 예약할 수 있습니다. 그래도 예약하시겠습니까?',
      });
    }
    const visitCount = getVisitCount(targetContent);
    if (visitCount >= 16) {
      warnings.push({
        type: 'manual-visit-limit',
        message: `도수치료 ${visitCount}회차째 입니다. 그래도 예약하시겠습니까?`,
      });
    }
  }

  if (treatmentGroup === 'shockwave') {
    const targetTime = new Date(`${targetDate}T00:00:00`).getTime();
    const hasRecentShockwave = matchingRows.some((item) => {
      if (item.treatmentGroup !== 'shockwave' || item.date >= targetDate) return false;
      const itemTime = new Date(`${item.date}T00:00:00`).getTime();
      const days = Math.round((targetTime - itemTime) / (24 * 60 * 60 * 1000));
      return days >= 0 && days < 7;
    });
    if (hasRecentShockwave) {
      warnings.push({
        type: 'shockwave-interval',
        message: '충격파 예약 후 7일이 경과되지 않았습니다. 그래도 예약하시겠습니까?',
      });
    }
    if (getVisitCount(targetContent) >= 7) {
      warnings.push({
        type: 'shockwave-visit-limit',
        message: '충격파가 7회차입니다. 그래도 예약하시겠습니까?',
      });
    }
  }

  return warnings;
}
