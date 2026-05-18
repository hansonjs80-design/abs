import { has4060Pattern } from './schedulerContentFormat.js';
import { parseSchedulerPatientIdentity } from './schedulerCellTextUtils.js';

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

export function buildPatientHistoryCellUpdate(log, currentMemo = {}) {
  const chart = String(log?.chart_number || '').trim();
  const name = String(log?.patient_name || '').replace(/\*/g, '').trim();
  const bodyPart = String(log?.body_part || '').trim();
  const prescription = String(log?.prescription || '').trim();
  const visitCount = parseInt(log?.visit_count || '0', 10) || 0;

  let contentName = name;

  if ((log?.history_group || log?.type) === 'manual') {
    const doseMatch = String(prescription).match(/(40|60)/);
    if (doseMatch && !has4060Pattern(contentName)) {
      contentName = `${contentName}${doseMatch[0]}`;
    }
  }

  let content = chart ? `${chart}/${contentName}` : contentName;
  if (visitCount > 0) {
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
