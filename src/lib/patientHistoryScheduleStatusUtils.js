import { getEffectiveCellBgColor, isTreatmentCompleteBg } from './scheduleStatusUtils.js';

// Unlinked historical logs have no reliable schedule completion state.
export function getPatientHistoryScheduleCompletion(scheduleRow) {
  return scheduleRow ? isTreatmentCompleteBg(scheduleRow.bg_color) : null;
}

export function getPatientHistoryScheduleStatusSignature(memos = {}, pendingColors = {}) {
  return Object.keys(memos).sort().filter((key) => (
    isTreatmentCompleteBg(getEffectiveCellBgColor(memos, pendingColors, key))
  )).join('|');
}
