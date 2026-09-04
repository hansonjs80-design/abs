import { has4060Pattern } from './schedulerContentFormat.js';
import { incrementSessionCount } from './scheduleVisitCountUtils.js';
import { getScheduleItemTreatmentGroup } from './prescriptionScheduleSettings.js';
import { formatBodyPartPresetDisplayValue } from './bodyPartPresetUtils.js';
import {
  getMemoListFromMergeSpan,
  normalizeVisitInputValue,
  parseSchedulerPatientIdentity,
} from './schedulerCellTextUtils.js';

function normalizeNameForHistorySearch(value) {
  return String(value || '')
    .trim()
    .replace(/[*\d\s().-]/g, '')
    .toLowerCase();
}

function getPatientHistoryPeriod(date, fallbackYear, fallbackMonth) {
  const match = String(date || '').trim().match(/^(\d{4})-(\d{1,2})(?:-|$)/);
  const year = Number(match?.[1] || fallbackYear);
  const month = Number(match?.[2] || fallbackMonth);
  return {
    year: Number.isInteger(year) && year > 0 ? year : new Date().getFullYear(),
    month: Number.isInteger(month) && month >= 1 && month <= 12 ? month : 1,
  };
}

export function getConfiguredPatientHistoryTreatmentGroup({
  prescription = '',
  content = '',
  settings,
  date = '',
  year,
  month,
} = {}) {
  const period = getPatientHistoryPeriod(date, year, month);
  const treatmentGroup = getScheduleItemTreatmentGroup(
    { prescription, content },
    settings,
    period.year,
    period.month
  );
  if (treatmentGroup === 'manual_therapy') return 'manual';
  if (treatmentGroup === 'shockwave') return 'shockwave';
  return '';
}

export function getPatientHistoryTreatmentGroup({
  type = '',
  prescription = '',
  content = '',
  settings,
  date = '',
  year,
  month,
} = {}) {
  const configuredGroup = getConfiguredPatientHistoryTreatmentGroup({
    prescription,
    content,
    settings,
    date,
    year,
    month,
  });
  if (configuredGroup) return configuredGroup;
  return type === 'manual' ? 'manual' : 'shockwave';
}

export function getPatientHistorySearchTarget(content) {
  const rawContent = String(content || '').trim();
  if (!rawContent) {
    return { shouldFetch: false, searchName: '', searchChart: '' };
  }

  const parsed = parseSchedulerPatientIdentity(rawContent);
  const searchName = normalizeNameForHistorySearch(parsed.patientName);
  const searchChart = parsed.patientChart ? String(parsed.patientChart).trim() : '';

  return {
    shouldFetch: Boolean(searchName || searchChart),
    searchName,
    searchChart,
  };
}

export function getPatientHistoryNameOnlySearchTarget(content) {
  const parsed = parseSchedulerPatientIdentity(String(content || '').trim());
  const searchName = normalizeNameForHistorySearch(parsed.patientName || content);

  return {
    shouldFetch: Boolean(searchName),
    searchName,
    searchChart: '',
  };
}

export function getPatientHistoryCandidateQueryTarget(searchName = '', searchChart = '') {
  const normalizedName = normalizeNameForHistorySearch(searchName);
  if (normalizedName) return { type: 'name', value: normalizedName };

  const chartNumber = String(searchChart || '').trim();
  if (chartNumber) return { type: 'chart', value: chartNumber };

  return { type: '', value: '' };
}

export function getPatientHistoryChartOptions(logs = [], searchName = '') {
  const normalizedSearchName = normalizeNameForHistorySearch(searchName);
  if (!normalizedSearchName) return [];

  const charts = new Map();
  (Array.isArray(logs) ? logs : []).forEach((log) => {
    if (normalizeNameForHistorySearch(log?.patient_name) !== normalizedSearchName) return;
    const chartNumber = String(log?.chart_number || '').trim();
    if (!chartNumber || charts.has(chartNumber)) return;
    charts.set(chartNumber, {
      chartNumber,
      patientName: String(log?.patient_name || searchName).trim() || searchName,
    });
  });

  return [...charts.values()].sort((left, right) => (
    left.chartNumber.localeCompare(right.chartNumber, 'ko', { numeric: true })
  ));
}

export function resolvePatientHistorySearchChart(searchChart = '', chartOptions = []) {
  const requestedChart = String(searchChart || '').trim();
  if (requestedChart) return requestedChart;
  return chartOptions.length === 1
    ? String(chartOptions[0]?.chartNumber || '').trim()
    : '';
}

export function isNameOnlyPatientHistoryDraft(content) {
  const rawContent = String(content || '').trim();
  if (!rawContent) return false;

  const parsed = parseSchedulerPatientIdentity(rawContent);
  const patientName = String(parsed.patientName || '').trim();
  const patientChart = String(parsed.patientChart || '').trim();

  return Boolean(patientName && !patientChart && rawContent === patientName);
}

export function patientHistoryIdentityMatches({
  chartParam,
  nameParam,
  chartValue,
  nameValue,
}) {
  const searchChart = String(chartParam || '').trim();
  const rowChart = String(chartValue || '').trim();
  const searchName = normalizeNameForHistorySearch(nameParam);
  const rowName = normalizeNameForHistorySearch(nameValue);

  const chartMatches = Boolean(searchChart && rowChart && rowChart === searchChart);
  const nameMatches = Boolean(searchName && rowName && rowName === searchName);

  if (searchChart && searchName) return chartMatches && nameMatches;
  if (searchChart) return chartMatches;
  if (searchName) return nameMatches;
  return false;
}

export function getPatientHistoryScheduleOverrideKey(log = {}) {
  const linkedScheduleId = String(
    log?.schedule_id || (log?.type === 'schedule' ? log?.id : '') || ''
  ).trim();
  if (linkedScheduleId) return `schedule__${linkedScheduleId}`;

  const date = String(log?.date || '').trim();
  const chart = String(log?.chart_number || '').trim();
  const name = normalizeNameForHistorySearch(log?.patient_name);
  const group = String(log?.history_group || 'shockwave').trim();
  const bodyPart = String(log?.body_part || '').trim().toLowerCase();
  if (!date) return '';
  if (chart) return `${date}__${group}__chart__${chart}__body__${bodyPart}`;
  if (name) return `${date}__${group}__name__${name}__body__${bodyPart}`;
  return '';
}

export function patientHistoryLogsShareScheduleCell(left = {}, right = {}) {
  const leftKey = getPatientHistoryScheduleOverrideKey(left);
  const rightKey = getPatientHistoryScheduleOverrideKey(right);
  return Boolean(
    leftKey &&
    rightKey &&
    leftKey.startsWith('schedule__') &&
    leftKey === rightKey
  );
}

export function dedupePatientHistoryLogsByScheduleCell(logs = []) {
  const seenScheduleKeys = new Set();
  return (Array.isArray(logs) ? logs : []).filter((log) => {
    const key = getPatientHistoryScheduleOverrideKey(log);
    if (!key.startsWith('schedule__')) return true;
    if (seenScheduleKeys.has(key)) return false;
    seenScheduleKeys.add(key);
    return true;
  });
}

export function getPatientHistoryMemoText(mergeSpan) {
  return getMemoListFromMergeSpan(mergeSpan)
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .join('\n');
}

export function parsePatientHistoryBodyPartText(value) {
  return String(value || '')
    .split(/[,\r\n]+/)
    .map((item) => item.replace(/^\s*•\s*/, '').trim())
    .filter(Boolean);
}

export function getPatientHistoryBodyPartText(value) {
  const displayItems = String(value || '')
    .replace(/\r\n/g, '\n')
    .split(/[,\n]/)
    .map((item) => item.replace(/^\s*•\s*/, '').trim());
  const itemCount = displayItems.filter(Boolean).length;

  return displayItems
    .map((item) => {
      const displayItem = formatBodyPartPresetDisplayValue(item);
      return displayItem && itemCount > 1 ? `• ${displayItem}` : displayItem;
    })
    .join('\n');
}

export function getPatientHistoryBodyPartTextareaRows(value) {
  return Math.max(1, parsePatientHistoryBodyPartText(value).length);
}

export function parsePatientHistoryMemoText(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((item) => item.replace(/^\s*•\s*/, '').trim())
    .filter(Boolean);
}

export function getPatientHistoryMemoDisplayText(value) {
  const displayItems = String(value || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((item) => item.replace(/^\s*•\s*/, '').trim());
  const itemCount = displayItems.filter(Boolean).length;

  return displayItems
    .map((item) => (item && itemCount > 1 ? `• ${item}` : item))
    .join('\n');
}

export function getPatientHistoryMemoTextareaRows(value) {
  return Math.max(1, String(value || '').split(/\r?\n/).length);
}

export function getPatientHistoryListTextAlign(itemCount) {
  return Number(itemCount) > 1 ? 'left' : 'center';
}

export function resolvePatientHistoryApplyTarget(capturedCell, selectedCell) {
  const target = capturedCell || selectedCell;
  if (!target) return null;
  const normalized = {
    w: Number(target.w),
    d: Number(target.d),
    r: Number(target.r),
    c: Number(target.c),
  };
  return Object.values(normalized).every(Number.isFinite) ? normalized : null;
}

export function shouldIncrementPatientHistoryApplyVisit(sourceDate, targetDate) {
  const source = String(sourceDate || '').trim();
  const target = String(targetDate || '').trim();
  return Boolean(source && target && source !== target);
}

export function buildPatientHistoryCellUpdate(log, currentMemo = {}, options = {}) {
  const chart = String(log?.chart_number || '').trim();
  const name = String(log?.patient_name || '').replace(/\*/g, '').trim();
  const bodyPart = String(log?.body_part || currentMemo.body_part || '').trim();
  const rawPrescription = String(log?.prescription || '').trim();
  const prescription = options.omitPrescription ? '' : rawPrescription;
  const visitCount = normalizeVisitInputValue(
    options.resetVisitCount ? '1' : log?.visit_count
  );

  let contentName = name;

  if ((log?.history_group || log?.type) === 'manual' && !options.omitPrescriptionDoseTag) {
    const doseMatch = String(rawPrescription).match(/(40|60)/);
    if (doseMatch && !has4060Pattern(contentName)) {
      contentName = `${contentName}${doseMatch[0]}`;
    }
  }

  let content = chart ? `${chart}/${contentName}` : contentName;
  if (visitCount === '-') {
    content = `${content}(-)`;
  } else if (visitCount === '*') {
    content = `${content}*`;
  } else if (visitCount) {
    content = `${content}(${visitCount})`;
  }

  if (options.incrementVisitCount && !options.resetVisitCount) {
    content = incrementSessionCount(content);
  }

  return {
    content,
    bg_color: currentMemo.bg_color || null,
    prescription: prescription || null,
    body_part: bodyPart || null,
    merge_span: currentMemo.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null },
  };
}
