import {
  normalize4060StarOrder,
} from '../../lib/schedulerContentFormat';
import {
  getScheduleDefaultMergeRowSpan,
  normalizeBodyPartKey,
  normalizeSchedulerVisitSuffix,
  normalizeVisitInputValue,
  splitBodyParts,
} from '../../lib/schedulerUtils';

export const PATIENT_HISTORY_GROUPS = [
  { key: 'shockwave', label: '충격파 내역' },
  { key: 'manual', label: '도수치료 내역' },
];

export const PATIENT_HISTORY_ALL_BODY_FILTER = '__all__';
export const EMPTY_SCHEDULE_MERGE_SPAN = { rowSpan: 1, colSpan: 1, mergedInto: null };
export const SCHEDULE_INTERNAL_BORDER_COLOR = '#d9d9d9';
export const DEFAULT_CONTEXT_PRESCRIPTION_COLORS = {
  'F/R': '#0f172a',
  'F/Rdc': '#64748b',
  'F/RDC': '#64748b',
  'F1.5': '#7c3aed',
  '40분': '#9a3412',
  '60분': '#9a3412',
};

const PATIENT_HISTORY_EMPTY_BODY_FILTER = '__empty__';
const HIDDEN_BODY_PART_OPTIONS_STORAGE_KEY = 'shockwave-hidden-body-part-options-by-patient';

export function stepContextMenuVisitValue(value, delta) {
  const normalized = normalizeVisitInputValue(value);

  if (!normalized) {
    if (delta > 0) return '*';
    if (delta < 0) return '-';
    return '';
  }

  let currentIndex = 0;
  if (normalized === '-') currentIndex = 0;
  else if (normalized === '*') currentIndex = 1;
  else currentIndex = (parseInt(normalized, 10) || 1) + 1;

  const nextIndex = currentIndex + delta;
  if (nextIndex <= 0) return '-';
  if (nextIndex === 1) return '*';
  return String(nextIndex - 1);
}

export function normalizeCommittedSchedulerContent(value) {
  return normalizeSchedulerVisitSuffix(
    normalize4060StarOrder(String(value ?? '').trim())
  );
}

export function getPlainTextDefaultRowSpan({ intervalMinutes, timeLabelIntervalMinutes }) {
  return getScheduleDefaultMergeRowSpan({
    interval_minutes: intervalMinutes,
    time_label_interval_minutes: timeLabelIntervalMinutes,
  });
}

export function loadHiddenBodyPartOptionsByPatient() {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(HIDDEN_BODY_PART_OPTIONS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.entries(parsed).reduce((acc, [patientKey, keys]) => {
      if (!patientKey || !Array.isArray(keys)) return acc;
      const uniqueKeys = Array.from(new Set(
        keys.map((key) => String(key || '').trim()).filter(Boolean)
      ));
      if (uniqueKeys.length > 0) acc[patientKey] = uniqueKeys;
      return acc;
    }, {});
  } catch {
    return {};
  }
}

export function saveHiddenBodyPartOptionsByPatient(value) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      HIDDEN_BODY_PART_OPTIONS_STORAGE_KEY,
      JSON.stringify(value || {})
    );
  } catch {
    // localStorage may be unavailable in private browsing or restricted contexts.
  }
}

export function getPatientHistoryGroupKey(log) {
  return log?.history_group || (log?.type === 'manual' ? 'manual' : 'shockwave');
}

export function getPatientHistoryBodyFilterParts(log = {}) {
  const parts = splitBodyParts(log.body_part || '');
  if (parts.length === 0) {
    return [{ key: PATIENT_HISTORY_EMPTY_BODY_FILTER, label: '부위 없음' }];
  }

  const partMap = new Map();
  parts.forEach((part) => {
    const key = normalizeBodyPartKey(part);
    if (!key || partMap.has(key)) return;
    partMap.set(key, { key, label: part });
  });
  return Array.from(partMap.values());
}

export function buildPatientHistoryBodyFilterOptions(logs = []) {
  const partMap = new Map();
  logs.forEach((log) => {
    getPatientHistoryBodyFilterParts(log).forEach((part) => {
      const current = partMap.get(part.key) || { ...part, count: 0 };
      current.count += 1;
      partMap.set(part.key, current);
    });
  });

  return [
    { key: PATIENT_HISTORY_ALL_BODY_FILTER, label: '전체', count: logs.length },
    ...Array.from(partMap.values()).sort((a, b) => a.label.localeCompare(b.label, 'ko')),
  ];
}
