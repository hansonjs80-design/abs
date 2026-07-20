import { generateShockwaveCalendar } from './calendarUtils.js';
import {
  getExplicitVisitSuffix,
  parseSchedulerPatientIdentity,
} from './schedulerCellTextUtils.js';

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

export function buildSchedulerCellKey(year, month, weekIndex, dayIndex, rowIndex, colIndex) {
  const values = [year, month, weekIndex, dayIndex, rowIndex, colIndex].map(Number);
  if (!values.every(Number.isFinite)) return '';
  const [safeYear, safeMonth, safeWeekIndex, safeDayIndex, safeRowIndex, safeColIndex] = values;
  return [
    safeYear,
    String(safeMonth).padStart(2, '0'),
    safeWeekIndex,
    safeDayIndex,
    safeRowIndex,
    safeColIndex,
  ].join(':');
}

export function parseSchedulerCellKey(value) {
  const parts = String(value || '').split(':');
  if (parts.length !== 6) return null;
  const [year, month, weekIndex, dayIndex, rowIndex, colIndex] = parts.map(Number);
  if (![year, month, weekIndex, dayIndex, rowIndex, colIndex].every(Number.isFinite)) return null;
  return {
    year,
    month,
    week_index: weekIndex,
    day_index: dayIndex,
    row_index: rowIndex,
    col_index: colIndex,
    memoKey: `${weekIndex}-${dayIndex}-${rowIndex}-${colIndex}`,
    schedulerCellKey: buildSchedulerCellKey(year, month, weekIndex, dayIndex, rowIndex, colIndex),
  };
}

export function getScheduleRowSchedulerCellKey(row) {
  return buildSchedulerCellKey(
    row?.year,
    row?.month,
    row?.week_index,
    row?.day_index,
    row?.row_index,
    row?.col_index
  );
}

export function buildScheduleRowsBySchedulerCellKey(rows) {
  const byKey = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const key = getScheduleRowSchedulerCellKey(row);
    if (key) byKey.set(key, row);
  });
  return byKey;
}

export function getSchedulerLinkedLogQueryTargets(logs) {
  const targets = new Map();
  (Array.isArray(logs) ? logs : []).forEach((log) => {
    const parsed = parseSchedulerCellKey(log?.scheduler_cell_key);
    if (!parsed) return;
    const monthKey = `${parsed.year}-${parsed.month}`;
    if (!targets.has(monthKey)) {
      targets.set(monthKey, {
        year: parsed.year,
        month: parsed.month,
        weekIndexes: new Set(),
        dayIndexes: new Set(),
        rowIndexes: new Set(),
        colIndexes: new Set(),
      });
    }
    const target = targets.get(monthKey);
    target.weekIndexes.add(parsed.week_index);
    target.dayIndexes.add(parsed.day_index);
    target.rowIndexes.add(parsed.row_index);
    target.colIndexes.add(parsed.col_index);
  });

  return Array.from(targets.values()).map((target) => ({
    year: target.year,
    month: target.month,
    weekIndexes: Array.from(target.weekIndexes),
    dayIndexes: Array.from(target.dayIndexes),
    rowIndexes: Array.from(target.rowIndexes),
    colIndexes: Array.from(target.colIndexes),
  }));
}

export function isSchedulerLinkedPatientLog(row) {
  return String(row?.source || '').trim() === 'scheduler' ||
    Boolean(String(row?.scheduler_cell_key || '').trim());
}

function normalizePresencePatientName(value) {
  return String(value || '')
    .trim()
    .replace(/[*\d\s().-]/g, '')
    .toLowerCase();
}

function addPatientHistoryPresenceKeys(target, item = {}) {
  const date = String(item.date || item.dateStr || '').trim();
  if (!date) return;

  const group = String(item.history_group || item.historyGroup || 'shockwave').trim() || 'shockwave';
  const parsed = item.parsed || {};
  const chart = String(item.chart_number || item.chartNumber || parsed.patientChart || '').trim();
  const name = normalizePresencePatientName(item.patient_name || item.patientName || parsed.patientName);

  if (chart) target.add(`${date}__${group}__chart__${chart}`);
  if (name) target.add(`${date}__${group}__name__${name}`);
}

export function buildPatientHistorySchedulePresenceKeys(items) {
  const keys = new Set();
  (Array.isArray(items) ? items : []).forEach((item) => addPatientHistoryPresenceKeys(keys, item));
  return keys;
}

export function hasPatientHistorySchedulePresence(log, schedulePresenceKeys) {
  if (!schedulePresenceKeys || typeof schedulePresenceKeys.has !== 'function') return false;
  const keys = new Set();
  addPatientHistoryPresenceKeys(keys, log);
  for (const key of keys) {
    if (schedulePresenceKeys.has(key)) return true;
  }
  return false;
}

export function shouldKeepUnkeyedSchedulerLogForPatientHistory(log, schedulePresenceKeys, todayDate) {
  const source = String(log?.source || '').trim();
  const hasSchedulerCellKey = Boolean(String(log?.scheduler_cell_key || '').trim());
  if (source !== 'scheduler' || hasSchedulerCellKey) return true;

  return shouldKeepFuturePatientLogForSchedulePresence(log, schedulePresenceKeys, todayDate);
}

export function shouldKeepFuturePatientLogForSchedulePresence(log, schedulePresenceKeys, todayDate) {
  const logDate = String(log?.date || '').trim();
  const currentDate = String(todayDate || '').trim();
  if (!logDate || !currentDate || logDate <= currentDate) return true;

  return hasPatientHistorySchedulePresence(log, schedulePresenceKeys);
}

function defaultPatientHistoryLogMatchesScheduleRow(log, scheduleIdentity) {
  const logChart = String(log?.chart_number || '').trim();
  const rowChart = String(scheduleIdentity?.patientChart || '').trim();
  const logName = String(log?.patient_name || '').replace(/\*/g, '').trim();
  const rowName = String(scheduleIdentity?.patientName || '').replace(/\*/g, '').trim();
  if (logChart && rowChart) return logChart === rowChart;
  return Boolean(logName && rowName && logName === rowName);
}

export function shouldKeepSchedulerLinkedPatientLog(log, scheduleRowsByCellKey, options = {}) {
  const source = String(log?.source || '').trim();
  const parsedKey = parseSchedulerCellKey(log?.scheduler_cell_key);
  if (!parsedKey) {
    return source !== 'scheduler' || options.keepUnkeyedSchedulerLogs !== false;
  }

  const scheduleRow = scheduleRowsByCellKey?.get(parsedKey.schedulerCellKey);
  if (!scheduleRow) return false;

  const calWeeks = typeof options.getCalendar === 'function'
    ? options.getCalendar(Number(scheduleRow.year), Number(scheduleRow.month))
    : generateShockwaveCalendar(Number(scheduleRow.year), Number(scheduleRow.month));
  const dayInfo = calWeeks?.[Number(scheduleRow.week_index)]?.[Number(scheduleRow.day_index)];
  if (!shouldUseScheduleRowForPatientHistory(scheduleRow, dayInfo, {
    targetDate: options.targetDate,
    targetRowIndex: options.targetRowIndex,
    targetColIndex: options.targetColIndex,
  })) {
    return false;
  }

  const scheduleContent = String(scheduleRow.content || '').trim();
  const scheduleIdentity = parseSchedulerPatientIdentity(scheduleContent);
  const identityMatches = typeof options.patientMatchesSchedule === 'function'
    ? options.patientMatchesSchedule(log, scheduleIdentity, scheduleRow)
    : defaultPatientHistoryLogMatchesScheduleRow(log, scheduleIdentity);
  if (!identityMatches) return false;

  if (typeof options.getLogHistoryGroup === 'function' && typeof options.getScheduleHistoryGroup === 'function') {
    const logGroup = String(options.getLogHistoryGroup(log) || '').trim();
    const scheduleGroup = String(options.getScheduleHistoryGroup(scheduleRow, scheduleContent) || '').trim();
    if (logGroup && scheduleGroup && logGroup !== scheduleGroup) return false;
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
