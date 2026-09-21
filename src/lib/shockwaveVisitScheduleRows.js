import { generateShockwaveCalendar } from './calendarUtils.js';
import { buildScheduleRowsBySchedulerCellKey, getScheduleRowSchedulerCellKey, getScheduleDayDateKey } from './schedulerHistoryCandidateUtils.js';
import { getExplicitVisitSuffix, parseSchedulerPatientIdentity } from './schedulerCellTextUtils.js';
import { getPrescriptionFromConfiguredDoseTag } from './prescriptionScheduleSettings.js';
import { isTreatmentCancelBg } from './scheduleStatusUtils.js';

// Patient history and insurance eligibility have different inclusion rules.
// Keep visit-bearing history even when a historical prescription is no longer configured.
export function buildShockwaveVisitScheduleRows(schedules, settings, lastDate) {
  const calendars = new Map();
  return [...buildScheduleRowsBySchedulerCellKey(schedules).values()].flatMap((row) => {
    const scheduler_cell_key = getScheduleRowSchedulerCellKey(row);
    const key = `${row.year}-${row.month}`;
    if (!calendars.has(key)) calendars.set(key, generateShockwaveCalendar(Number(row.year), Number(row.month)));
    const day = calendars.get(key)?.[Number(row.week_index)]?.[Number(row.day_index)];
    if (!day?.isCurrentMonth) return [];
    const date = getScheduleDayDateKey(day);
    if (date > lastDate) return [];
    const patient = parseSchedulerPatientIdentity(row.content || '');
    const excluded = !patient.patientName || Boolean(row.merge_span?.mergedInto) || isTreatmentCancelBg(row.bg_color);
    return [{ ...row, date, scheduler_cell_key, _schedule: true, _excluded: excluded,
      prescription: row.prescription || getPrescriptionFromConfiguredDoseTag(settings, Number(row.year), Number(row.month), row.content) || '',
      chart_number: patient.patientChart || '', patient_name: patient.patientName || '',
      visit_count: getExplicitVisitSuffix(row.content || '').replace(/[()]/g, ''),
    }];
  });
}
