import { generateShockwaveCalendar } from './calendarUtils.js';
import { getScheduleItemTreatmentGroup } from './prescriptionScheduleSettings.js';
import { parseSchedulerPatientIdentity } from './schedulerCellTextUtils.js';
import { getScheduleDayDateKey } from './schedulerHistoryCandidateUtils.js';
import { buildInsuranceRecords, getInsuranceUsage, isInsuranceSelfPay } from './insuranceUsageUtils.js';
import { isTreatmentCancelBg } from './scheduleStatusUtils.js';

// Notifications never gate, cancel, or replace a scheduler operation.
export function notifyReservationWarnings(loadWarnings, notify, onError = () => {}) {
  Promise.resolve().then(loadWarnings).then((warnings) => {
    if (warnings?.length) notify(warnings);
  }).catch(onError);
  return true;
}

export function findShinjangReplacement(prescription, prescriptions = []) {
  const getDose = (value) => String(value || '').normalize('NFKC').match(/\d+(?:\.\d+)?/g) || [];
  const source = getDose(prescription);
  if (source.length !== 1) return '';
  const matches = prescriptions.filter((candidate) => {
    const doses = getDose(candidate);
    return doses.length === 1 && Number(doses[0]) === Number(source[0])
      && /dc/i.test(candidate) === /dc/i.test(prescription);
  });
  return matches.length === 1 ? matches[0] : '';
}

export function getReservationWarningReplacement(request, dropdownPrescription = '') {
  if (dropdownPrescription) return dropdownPrescription;
  if (request.type === 'manual-week-limit' || request.type === 'manual-visit-limit') {
    const matches = (request.prescriptions?.shinjangSpray || []).filter((value) => (
      String(value).normalize('NFKC').replace(/\s/g, '') === '신장분사1'
    ));
    return matches.length === 1 ? matches[0] : '';
  }
  return (request.type === 'shockwave-interval' ? request.replacement : request.prescription) || '';
}

export function getNextReservationActionIndex(disabled, currentIndex, key) {
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return -1;
  const enabled = disabled.flatMap((value, index) => value ? [] : [index]);
  if (!enabled.length) return -1;
  const position = enabled.indexOf(currentIndex);
  if (position < 0) return enabled[0];
  return enabled[(position + (key === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length];
}

export async function prepareReservationPayload(payload, confirm) {
  const prepared = payload.map((row) => ({ ...row }));
  for (const row of prepared) {
    if (!String(row.content || '').trim() || row.merge_span?.mergedInto) continue;
    const answer = await confirm(row, prepared);
    if (answer === false) return null;
    if (typeof answer === 'string') row.prescription = answer;
  }
  return prepared;
}

export async function resolveReservationWarnings({ prescription, getWarnings, ask }) {
  let selected = prescription;
  const accepted = new Set();
  while (true) {
    const warning = getWarnings(selected).find((item) => !accepted.has(`${selected}:${item.type}:${item.message}`));
    if (!warning) return selected === prescription ? true : selected;
    const answer = await ask(warning, selected);
    if (answer === false) return false;
    if (typeof answer === 'string' && answer !== selected) selected = answer;
    else accepted.add(`${selected}:${warning.type}:${warning.message}`);
  }
}

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

export function canReusePriorReservationWarnings({ content, oldContent, prescription, oldPrescription }) {
  return prescription === oldPrescription && isSamePatient(getIdentity(content), getIdentity(oldContent));
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
  historyLogs = [],
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
    if (isTargetRow(row, target) || row?.merge_span?.mergedInto || isTreatmentCancelBg(row.bg_color) || !String(row?.content || '').trim()) return [];
    const rowDate = getScheduleDate(row);
    if (!rowDate || !isSamePatient(targetIdentity, getIdentity(row.content))) return [];
    return [{ row, date: rowDate, treatmentGroup: getScheduleItemTreatmentGroup(row, settings, year, month) }];
  });

  const warnings = [];
  const usage = getInsuranceUsage(buildInsuranceRecords({ scheduleRows, historyLogs, settings }), target, settings);
  const visitCount = isInsuranceSelfPay(target.prescription) ? 0 : (usage?.count || 0);
  if (treatmentGroup === 'manual_therapy') {
    const sameWeekDates = new Set(
      matchingRows
        .filter((item) => item.treatmentGroup === 'manual_therapy' && getMondayWeekKey(item.date) === getMondayWeekKey(targetDate))
        .map((item) => item.date)
    );
    if (sameWeekDates.size >= 2 && !sameWeekDates.has(targetDate)) {
      warnings.push({
        type: 'manual-week-limit',
        message: '한 주에 2일을 초과해 예약할 수 없습니다. 그래도 예약하시겠습니까?',
      });
    }
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
        message: '아직 7일이 경과되지 않았습니다',
      });
    }
    if (visitCount > 0 && usage?.overLimit) {
      warnings.push({
        type: 'shockwave-visit-limit',
        message: `충격파 실비 한도 초과: ${[
          ...(visitCount > 12 ? [`합산 ${visitCount}/12회`] : []),
          ...(usage.exceededParts || []).map((part) => `(${part.label} ${part.count}/6)`),
        ].join(', ')}. 그래도 예약하시겠습니까?`,
      });
    }
  }

  return warnings.map((warning) => ({ ...warning, insuranceUsage: usage }));
}
