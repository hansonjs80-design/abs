import {
  normalize4060StarOrder,
} from '../../lib/schedulerContentFormat.js';
import {
  getScheduleDefaultMergeRowSpan,
  getMemoListFromMergeSpan,
  getPrescriptionColor,
  normalizeBodyPartKey,
  normalizeSchedulerVisitSuffix,
  normalizeVisitInputValue,
  splitBodyParts,
} from '../../lib/schedulerUtils.js';
import { getPatientHistoryVisitSequenceColors } from '../../lib/patientHistoryVisitSequenceUtils.js';

export const PATIENT_HISTORY_GROUPS = [
  { key: 'shockwave', label: '충격파 내역' },
  { key: 'manual', label: '도수치료 내역' },
];

export const PATIENT_HISTORY_ALL_BODY_FILTER = '__all__';
export const PATIENT_HISTORY_ALL_PRESCRIPTION_FILTER = '__all__';
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

export function getPatientHistoryPrescriptionColor(prescription, colorMap) {
  return getPrescriptionColor(prescription, colorMap)
    || DEFAULT_CONTEXT_PRESCRIPTION_COLORS[prescription]
    || 'var(--text-primary, #1f2937)';
}

const PATIENT_HISTORY_EMPTY_BODY_FILTER = '__empty__';
const PATIENT_HISTORY_EMPTY_PRESCRIPTION_FILTER = '__empty__';
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

function getPatientHistoryFilterOptionRecency(log, sequence) {
  return {
    latestDate: String(log?.date || ''),
    latestSequence: sequence,
  };
}

function isNewerPatientHistoryFilterOption(next, current) {
  if (!current) return true;
  if (next.latestDate !== current.latestDate) {
    return next.latestDate > current.latestDate;
  }
  return next.latestSequence < current.latestSequence;
}

function sortPatientHistoryFilterOptionsByRecency(options) {
  return options
    .sort((a, b) => (
      b.latestDate.localeCompare(a.latestDate)
      || a.latestSequence - b.latestSequence
      || a.label.localeCompare(b.label, 'ko')
    ))
    .map(({ key, label, count }) => ({ key, label, count }));
}

export function buildPatientHistoryBodyFilterOptions(logs = [], countLogs = logs) {
  const partMap = new Map();
  logs.forEach((log, logIndex) => {
    getPatientHistoryBodyFilterParts(log).forEach((part, partIndex) => {
      const current = partMap.get(part.key);
      const recency = getPatientHistoryFilterOptionRecency(
        log,
        (logIndex * 1000) + partIndex
      );
      if (isNewerPatientHistoryFilterOption(recency, current)) {
        partMap.set(part.key, { ...part, count: current?.count || 0, ...recency });
      }
    });
  });
  countLogs.forEach((log) => {
    getPatientHistoryBodyFilterParts(log).forEach((part) => {
      const current = partMap.get(part.key);
      if (!current) return;
      current.count += 1;
    });
  });

  return [
    { key: PATIENT_HISTORY_ALL_BODY_FILTER, label: '전체', count: countLogs.length },
    ...sortPatientHistoryFilterOptionsByRecency(Array.from(partMap.values())),
  ];
}

export function getPatientHistoryPrescriptionFilterPart(log = {}) {
  const prescription = String(log.prescription || '').trim();
  if (!prescription) {
    return { key: PATIENT_HISTORY_EMPTY_PRESCRIPTION_FILTER, label: '처방 없음' };
  }
  return { key: prescription.toLowerCase(), label: prescription };
}

export function buildPatientHistoryPrescriptionFilterOptions(logs = [], countLogs = logs) {
  const prescriptionMap = new Map();
  logs.forEach((log, logIndex) => {
    const prescription = getPatientHistoryPrescriptionFilterPart(log);
    const current = prescriptionMap.get(prescription.key);
    const recency = getPatientHistoryFilterOptionRecency(log, logIndex);
    if (isNewerPatientHistoryFilterOption(recency, current)) {
      prescriptionMap.set(
        prescription.key,
        { ...prescription, count: current?.count || 0, ...recency }
      );
    }
  });
  countLogs.forEach((log) => {
    const prescription = getPatientHistoryPrescriptionFilterPart(log);
    const current = prescriptionMap.get(prescription.key);
    if (current) current.count += 1;
  });

  return [
    { key: PATIENT_HISTORY_ALL_PRESCRIPTION_FILTER, label: '전체', count: countLogs.length },
    ...sortPatientHistoryFilterOptionsByRecency(Array.from(prescriptionMap.values())),
  ];
}

export function getPatientHistoryFilterWidthWeight(options = []) {
  const totalWeight = options.reduce((sum, option) => {
    const labelWeight = Array.from(String(option?.label || '')).reduce(
      (weight, character) => weight + (character.charCodeAt(0) > 255 ? 1.7 : 1),
      0
    );
    const countWeight = String(option?.count ?? '').length;
    return sum + Math.max(7, labelWeight + countWeight + 5);
  }, 0);
  return Math.max(1, Number(totalWeight.toFixed(2)));
}

export function togglePatientHistoryFilterSelection(selection, optionKey) {
  if (optionKey === PATIENT_HISTORY_ALL_BODY_FILTER) return [];
  const selectedKeys = Array.isArray(selection)
    ? selection
    : (selection && selection !== PATIENT_HISTORY_ALL_BODY_FILTER ? [selection] : []);
  const nextKeys = new Set(selectedKeys);
  if (nextKeys.has(optionKey)) nextKeys.delete(optionKey);
  else nextKeys.add(optionKey);
  return Array.from(nextKeys);
}

function normalizePatientHistoryFilterSelection(selection, options) {
  const selectedKeys = Array.isArray(selection)
    ? selection
    : (selection ? [selection] : []);
  if (selectedKeys.includes(PATIENT_HISTORY_ALL_BODY_FILTER)) return [];
  const validKeys = new Set(
    options
      .map((option) => option.key)
      .filter((key) => key !== PATIENT_HISTORY_ALL_BODY_FILTER)
  );
  return Array.from(new Set(selectedKeys.filter((key) => validKeys.has(key))));
}

function filterPatientHistoryLogsByBody(logs, bodyFilters) {
  if (bodyFilters.length === 0) return logs;
  const selectedKeys = new Set(bodyFilters);
  return logs.filter((log) => (
    getPatientHistoryBodyFilterParts(log).some((part) => selectedKeys.has(part.key))
  ));
}

function filterPatientHistoryLogsByPrescription(logs, prescriptionFilters) {
  if (prescriptionFilters.length === 0) return logs;
  const selectedKeys = new Set(prescriptionFilters);
  return logs.filter((log) => (
    selectedKeys.has(getPatientHistoryPrescriptionFilterPart(log).key)
  ));
}

export function buildPatientHistoryLogGroups({
  logs = [],
  bodyFilters = {},
  prescriptionFilters = {},
  selectedGroupKey = 'shockwave',
} = {}) {
  const groupMap = new Map(
    PATIENT_HISTORY_GROUPS.map((group) => [group.key, { ...group, logs: [] }])
  );
  logs.forEach((log) => {
    const groupKey = getPatientHistoryGroupKey(log);
    const group = groupMap.get(groupKey) || groupMap.get('shockwave');
    group.logs.push(log);
  });

  const orderedGroups = [...PATIENT_HISTORY_GROUPS].sort((a, b) => {
    if (a.key === selectedGroupKey) return -1;
    if (b.key === selectedGroupKey) return 1;
    return 0;
  });

  return orderedGroups
    .map((group) => {
      const rawGroup = groupMap.get(group.key);
      if (!rawGroup || rawGroup.logs.length === 0) return null;
      const rawBodyFilterOptions = buildPatientHistoryBodyFilterOptions(rawGroup.logs);
      const rawPrescriptionFilterOptions = buildPatientHistoryPrescriptionFilterOptions(rawGroup.logs);
      const activeBodyFilters = normalizePatientHistoryFilterSelection(
        bodyFilters[rawGroup.key],
        rawBodyFilterOptions
      );
      const activePrescriptionFilters = normalizePatientHistoryFilterSelection(
        prescriptionFilters[rawGroup.key],
        rawPrescriptionFilterOptions
      );
      const bodyFilteredLogs = filterPatientHistoryLogsByBody(rawGroup.logs, activeBodyFilters);
      const prescriptionFilteredLogs = filterPatientHistoryLogsByPrescription(
        rawGroup.logs,
        activePrescriptionFilters
      );
      const filteredLogs = filterPatientHistoryLogsByPrescription(
        bodyFilteredLogs,
        activePrescriptionFilters
      );
      const bodyFilterOptions = buildPatientHistoryBodyFilterOptions(
        rawGroup.logs,
        prescriptionFilteredLogs
      );
      const prescriptionFilterOptions = buildPatientHistoryPrescriptionFilterOptions(
        rawGroup.logs,
        bodyFilteredLogs
      );
      return {
        ...rawGroup,
        logs: filteredLogs,
        visitSequenceColors: getPatientHistoryVisitSequenceColors(filteredLogs),
        totalLogs: rawGroup.logs,
        bodyFilterOptions,
        activeBodyFilters,
        prescriptionFilterOptions,
        activePrescriptionFilters,
      };
    })
    .filter(Boolean);
}

const PATIENT_HISTORY_BASE_COLUMN_WIDTHS = [3.98, 12.42, 7.44, 11.73, 27.29, 21.83, 5.12, 6.56, 3.63];
const PATIENT_HISTORY_APPLY_COLUMN_SCALE = 1.1;
const PATIENT_HISTORY_COLUMN_WIDTH_SCALE = (
  PATIENT_HISTORY_BASE_COLUMN_WIDTHS.slice(0, -1).reduce((sum, width) => sum + width, 0)
  + PATIENT_HISTORY_BASE_COLUMN_WIDTHS.at(-1) * PATIENT_HISTORY_APPLY_COLUMN_SCALE
) / 100;

export function getPatientHistoryModalLayout(groupCount) {
  if (groupCount >= 2) {
    return {
      maxWidth: Math.ceil(1534 * PATIENT_HISTORY_COLUMN_WIDTH_SCALE),
      width: '100%',
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    };
  }
  return {
    maxWidth: groupCount === 1
      ? Math.ceil(780 * PATIENT_HISTORY_COLUMN_WIDTH_SCALE)
      : 580,
    width: groupCount === 1 ? '85%' : '80%',
    gridTemplateColumns: 'minmax(0, 1fr)',
  };
}

export function getPatientHistoryColumnWidths(groupCount) {
  void groupCount;
  const expandedWidths = PATIENT_HISTORY_BASE_COLUMN_WIDTHS.map((width, index) => (
    index === PATIENT_HISTORY_BASE_COLUMN_WIDTHS.length - 1
      ? width * PATIENT_HISTORY_APPLY_COLUMN_SCALE
      : width
  ));
  const totalWidth = expandedWidths.reduce((sum, width) => sum + width, 0);
  return expandedWidths.map((width) => `${(width / totalWidth) * 100}%`);
}

export function getPatientHistoryScheduleNavigationTarget(dateValue) {
  const match = String(dateValue || '').trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|T)/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) return null;

  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year
    || date.getMonth() + 1 !== month
    || date.getDate() !== day
  ) return null;

  return { date, year, month, day };
}

export function buildShockwaveHoverTooltipText({
  hoverCell,
  renderMemos = {},
  pendingDisplayValues = {},
  pendingMergeSpans = {},
  selectedKeys,
  cellKey,
  getTimeSlotsForDay,
  getReservationTimeForMemo,
  slotMinutes = 30,
} = {}) {
  if (!hoverCell) return '';

  const {
    weekIdx,
    dayIdx,
    rowIdx,
    colIdx,
    staffBlockRule,
    slotInfo,
    selectionInfo,
  } = hoverCell;
  const keyStr = cellKey(weekIdx, dayIdx, rowIdx, colIdx);
  const cellData = renderMemos[keyStr] || {};
  const content = typeof pendingDisplayValues[keyStr] === 'string'
    ? pendingDisplayValues[keyStr]
    : cellData.content;
  const hasHoverContent = Boolean(String(content || '').trim() && content !== '\u200B');
  const cellPrescription = cellData.prescription || '';
  const isSelectionHover = (
    selectionInfo
    && selectionInfo.w === weekIdx
    && selectionInfo.d === dayIdx
    && selectionInfo.minRow !== selectionInfo.maxRow
    && selectedKeys
    && selectedKeys.has(keyStr)
  );

  let text = '';
  if (isSelectionHover) {
    const daySlots = getTimeSlotsForDay(weekIdx, dayIdx);
    const selectionStart = daySlots.find((slot) => slot.idx === selectionInfo.minRow);
    const selectionEnd = daySlots.find((slot) => slot.idx === selectionInfo.maxRow);
    if (selectionStart && selectionEnd) {
      const startTime = selectionStart.time || selectionStart.label;
      const endTime = new Date(`2000-01-01T${selectionEnd.time || selectionEnd.label}:00`);
      endTime.setMinutes(endTime.getMinutes() + slotMinutes);
      const endHour = String(endTime.getHours()).padStart(2, '0');
      const endMinute = String(endTime.getMinutes()).padStart(2, '0');

      const durationMinutes = (
        selectionInfo.maxRow - selectionInfo.minRow + 1
      ) * slotMinutes;
      const durationHours = Math.floor(durationMinutes / 60);
      const remainingMinutes = durationMinutes % 60;
      let durationText = '';
      if (durationHours > 0) durationText += `${durationHours}시간`;
      if (remainingMinutes > 0) {
        durationText += `${durationHours > 0 ? ' ' : ''}${remainingMinutes}분`;
      }

      text = `⏱ ${startTime} ~ ${endHour}:${endMinute} (총 ${durationText})`;
      if (hasHoverContent) text += `\n👤 ${content}`;
    } else {
      const mergeSpanForHover = pendingMergeSpans[keyStr] || cellData.merge_span;
      const optimisticCellData = { ...cellData, merge_span: mergeSpanForHover };
      const reservationTime = getReservationTimeForMemo(
        optimisticCellData,
        weekIdx,
        dayIdx,
        rowIdx
      );
      text = `⏱ ${reservationTime || slotInfo.label}`;
      if (hasHoverContent) text += `\n👤 ${content}`;
    }
  } else {
    const mergeSpanForHover = pendingMergeSpans[keyStr] || cellData.merge_span;
    const optimisticCellData = { ...cellData, merge_span: mergeSpanForHover };
    const reservationTime = getReservationTimeForMemo(
      optimisticCellData,
      weekIdx,
      dayIdx,
      rowIdx
    );
    text = `⏱ ${reservationTime || slotInfo.label}`;
    if (hasHoverContent) text += `\n👤 ${content}`;
  }

  if (staffBlockRule) text += `\n근무표: ${staffBlockRule.keyword}`;
  if (hasHoverContent && cellPrescription) text += `\n💊 처방: ${cellPrescription}`;
  if (hasHoverContent && cellData?.body_part) text += `\n🦴 부위: ${cellData.body_part}`;

  const memoList = getMemoListFromMergeSpan(cellData?.merge_span);
  if (memoList.length === 1) {
    text += `\n📝 메모: ${memoList[0]}`;
  } else if (memoList.length > 1) {
    text += `\n📝 메모:\n${memoList.map((memo) => `  • ${memo}`).join('\n')}`;
  }

  return text;
}
