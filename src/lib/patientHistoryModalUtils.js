import { has4060Pattern } from './schedulerContentFormat.js';
import {
  normalizeVisitInputValue,
  parseSchedulerPatientIdentity,
} from './schedulerCellTextUtils.js';

function normalizeNameForHistorySearch(value) {
  return String(value || '')
    .trim()
    .replace(/[*\d\s().-]/g, '')
    .toLowerCase();
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

export function buildPatientHistoryCellUpdate(log, currentMemo = {}) {
  const chart = String(log?.chart_number || '').trim();
  const name = String(log?.patient_name || '').replace(/\*/g, '').trim();
  const bodyPart = String(log?.body_part || currentMemo.body_part || '').trim();
  const prescription = String(log?.prescription || '').trim();
  const visitCount = normalizeVisitInputValue(log?.visit_count);

  let contentName = name;

  if ((log?.history_group || log?.type) === 'manual') {
    const doseMatch = String(prescription).match(/(40|60)/);
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

  return {
    content,
    bg_color: currentMemo.bg_color || null,
    prescription: prescription || null,
    body_part: bodyPart || null,
    merge_span: currentMemo.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null },
  };
}
