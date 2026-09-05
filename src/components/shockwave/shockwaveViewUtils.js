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
import { getPatientHistoryGroupedVisitSequenceColors } from '../../lib/patientHistoryVisitSequenceUtils.js';
import { parseSchedulerCellKey } from '../../lib/schedulerHistoryCandidateUtils.js';
import { formatBodyPartPresetDisplayValue } from '../../lib/bodyPartPresetUtils.js';

export const PATIENT_HISTORY_GROUPS = [
  { key: 'shockwave', label: '충격파 내역' },
  { key: 'manual', label: '도수치료 내역' },
  { key: 'shinjang', label: '신장분사 내역' },
];

export const PATIENT_HISTORY_SORT_OPTIONS = [
  { key: 'date', label: '날짜순' },
  { key: 'prescription', label: '처방순' },
  { key: 'body', label: '부위순' },
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
  const configuredGroup = String(log?.history_group || '').trim();
  if (configuredGroup === 'shinjang_spray') return 'shinjang';
  if (PATIENT_HISTORY_GROUPS.some((group) => group.key === configuredGroup)) {
    return configuredGroup;
  }
  return log?.type === 'manual' ? 'manual' : 'shockwave';
}

export function buildPatientHistoryTreatmentFilterOptions(logs = []) {
  const counts = new Map(PATIENT_HISTORY_GROUPS.map((group) => [group.key, 0]));
  (Array.isArray(logs) ? logs : []).forEach((log) => {
    const key = getPatientHistoryGroupKey(log);
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return PATIENT_HISTORY_GROUPS.map((group) => ({
    ...group,
    count: counts.get(group.key) || 0,
  }));
}

export function togglePatientHistoryTreatmentSelection(selection, optionKey) {
  const validKeys = PATIENT_HISTORY_GROUPS.map((group) => group.key);
  const selectedKeys = new Set(
    Array.isArray(selection) && selection.length > 0
      ? selection.filter((key) => validKeys.includes(key))
      : validKeys
  );
  if (selectedKeys.has(optionKey)) {
    if (selectedKeys.size > 1) selectedKeys.delete(optionKey);
  } else if (validKeys.includes(optionKey)) {
    selectedKeys.add(optionKey);
  }
  return validKeys.filter((key) => selectedKeys.has(key));
}

export function getPatientHistoryBodyFilterParts(log = {}) {
  const parts = splitBodyParts(log.body_part || '');
  if (parts.length === 0) {
    return [{ key: PATIENT_HISTORY_EMPTY_BODY_FILTER, label: '부위 없음' }];
  }

  const partMap = new Map();
  parts.forEach((part) => {
    const displayPart = formatBodyPartPresetDisplayValue(part);
    const key = normalizeBodyPartKey(displayPart);
    if (!key || partMap.has(key)) return;
    partMap.set(key, { key, label: displayPart });
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

export function sortPatientHistoryLogs(logs = [], sortOrder = 'date') {
  const source = Array.isArray(logs) ? logs : [];
  const compareDate = (left, right) => (
    String(right?.date || '').localeCompare(String(left?.date || ''))
  );
  const compareSchedulePosition = (left, right) => {
    const leftPosition = parseSchedulerCellKey(left?.scheduler_cell_key);
    const rightPosition = parseSchedulerCellKey(right?.scheduler_cell_key);
    if (!leftPosition || !rightPosition) return 0;
    return leftPosition.row_index - rightPosition.row_index
      || leftPosition.col_index - rightPosition.col_index;
  };
  const compareLabel = (left, right, field) => (
    String(left?.[field] || '').trim().localeCompare(
      String(right?.[field] || '').trim(),
      'ko',
      { numeric: true }
    )
  );

  return source
    .map((log, index) => ({ log, index }))
    .sort((left, right) => {
      const primary = sortOrder === 'prescription'
        ? compareLabel(left.log, right.log, 'prescription')
        : sortOrder === 'body'
          ? compareLabel(left.log, right.log, 'body_part')
          : compareDate(left.log, right.log);
      return primary
        || compareDate(left.log, right.log)
        || compareSchedulePosition(left.log, right.log)
        || left.index - right.index;
    })
    .map(({ log }) => log);
}

function buildFilteredPatientHistoryGroup({
  group,
  rawLogs,
  filterKey,
  bodyFilters,
  prescriptionFilters,
  sortOrder,
}) {
  const rawBodyFilterOptions = buildPatientHistoryBodyFilterOptions(rawLogs);
  const rawPrescriptionFilterOptions = buildPatientHistoryPrescriptionFilterOptions(rawLogs);
  const activeBodyFilters = normalizePatientHistoryFilterSelection(
    bodyFilters[filterKey],
    rawBodyFilterOptions
  );
  const activePrescriptionFilters = normalizePatientHistoryFilterSelection(
    prescriptionFilters[filterKey],
    rawPrescriptionFilterOptions
  );
  const bodyFilteredLogs = filterPatientHistoryLogsByBody(rawLogs, activeBodyFilters);
  const prescriptionFilteredLogs = filterPatientHistoryLogsByPrescription(
    rawLogs,
    activePrescriptionFilters
  );
  const filteredLogs = sortPatientHistoryLogs(
    filterPatientHistoryLogsByPrescription(bodyFilteredLogs, activePrescriptionFilters),
    sortOrder
  );

  return {
    ...group,
    logs: filteredLogs,
    visitSequenceColors: getPatientHistoryGroupedVisitSequenceColors(
      filteredLogs,
      getPatientHistoryGroupKey
    ),
    totalLogs: rawLogs,
    bodyFilterOptions: buildPatientHistoryBodyFilterOptions(rawLogs, prescriptionFilteredLogs),
    activeBodyFilters,
    prescriptionFilterOptions: buildPatientHistoryPrescriptionFilterOptions(rawLogs, bodyFilteredLogs),
    activePrescriptionFilters,
  };
}

export function buildPatientHistoryLogGroups({
  logs = [],
  bodyFilters = {},
  prescriptionFilters = {},
  selectedGroupKey = 'shockwave',
  selectedTreatmentGroups,
  sortOrder = 'date',
} = {}) {
  const groupMap = new Map(
    PATIENT_HISTORY_GROUPS.map((group) => [group.key, { ...group, logs: [] }])
  );
  logs.forEach((log) => {
    const groupKey = getPatientHistoryGroupKey(log);
    const group = groupMap.get(groupKey) || groupMap.get('shockwave');
    group.logs.push(log);
  });

  const hasExplicitTreatmentSelection = Array.isArray(selectedTreatmentGroups);
  const selectedKeys = hasExplicitTreatmentSelection && selectedTreatmentGroups.length > 0
    ? PATIENT_HISTORY_GROUPS
      .map((group) => group.key)
      .filter((key) => selectedTreatmentGroups.includes(key))
    : PATIENT_HISTORY_GROUPS.map((group) => group.key);

  if (hasExplicitTreatmentSelection && selectedKeys.length >= 3) {
    const combinedLogs = selectedKeys.flatMap((key) => groupMap.get(key)?.logs || []);
    return [buildFilteredPatientHistoryGroup({
      group: { key: 'all', label: '전체 치료 내역', treatmentKeys: selectedKeys },
      rawLogs: combinedLogs,
      filterKey: 'all',
      bodyFilters,
      prescriptionFilters,
      sortOrder,
    })];
  }

  const orderedGroups = PATIENT_HISTORY_GROUPS
    .filter((group) => selectedKeys.includes(group.key))
    .sort((a, b) => {
    if (a.key === selectedGroupKey) return -1;
    if (b.key === selectedGroupKey) return 1;
    return 0;
  });

  return orderedGroups
    .map((group) => {
      const rawGroup = groupMap.get(group.key);
      if (!rawGroup || (!hasExplicitTreatmentSelection && rawGroup.logs.length === 0)) return null;
      return buildFilteredPatientHistoryGroup({
        group,
        rawLogs: rawGroup.logs,
        filterKey: group.key,
        bodyFilters,
        prescriptionFilters,
        sortOrder,
      });
    })
    .filter(Boolean);
}

export function resolvePatientHistoryGroupTargetCell({
  modalOpen = false,
  capturedCell = null,
  selectedCell = null,
} = {}) {
  if (modalOpen && capturedCell) return capturedCell;
  return selectedCell;
}

const PATIENT_HISTORY_BASE_COLUMN_WIDTHS = [3.98, 12.42, 7.44, 11.73, 27.29, 21.83, 5.12, 6.56, 3.63];
const PATIENT_HISTORY_SINGLE_MODAL_BASE_WIDTH = 780;
const PATIENT_HISTORY_MEMO_COLUMN_INDEX = 5;
const PATIENT_HISTORY_PRESCRIPTION_COLUMN_INDEX = 3;
const PATIENT_HISTORY_MEMO_COLUMN_SCALE = 1.1;
const PATIENT_HISTORY_APPLY_COLUMN_SCALE = 1.1;
const PATIENT_HISTORY_TREATMENT_COLUMN_WIDTH = 7.8;
const PATIENT_HISTORY_SHINJANG_PRESCRIPTION_SCALE = 1.2;
const PATIENT_HISTORY_COMBINED_PRESCRIPTION_SCALE = 1.32;
const PATIENT_HISTORY_COLUMN_WIDTH_SCALE = (
  PATIENT_HISTORY_BASE_COLUMN_WIDTHS.reduce((sum, width, index) => {
    if (index === PATIENT_HISTORY_MEMO_COLUMN_INDEX) {
      return sum + width * PATIENT_HISTORY_MEMO_COLUMN_SCALE;
    }
    if (index === PATIENT_HISTORY_BASE_COLUMN_WIDTHS.length - 1) {
      return sum + width * PATIENT_HISTORY_APPLY_COLUMN_SCALE;
    }
    return sum + width;
  }, 0)
) / 100;

export function getPatientHistoryModalLayout(groupsOrCount) {
  const groups = Array.isArray(groupsOrCount) ? groupsOrCount : null;
  const groupCount = groups ? groups.length : Number(groupsOrCount || 0);
  const isCombined = groups?.length === 1 && groups[0]?.key === 'all';
  const isShinjang = groups?.length === 1 && groups[0]?.key === 'shinjang';
  if (groupCount >= 2) {
    return {
      maxWidth: Math.ceil(1534 * PATIENT_HISTORY_COLUMN_WIDTH_SCALE),
      width: '100%',
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    };
  }
  if (isCombined) {
    const combinedPrescriptionWidthIncrease = PATIENT_HISTORY_SINGLE_MODAL_BASE_WIDTH
      * PATIENT_HISTORY_BASE_COLUMN_WIDTHS[PATIENT_HISTORY_PRESCRIPTION_COLUMN_INDEX]
      * (PATIENT_HISTORY_COMBINED_PRESCRIPTION_SCALE - 1)
      / 100;
    return {
      maxWidth: Math.ceil(
        (PATIENT_HISTORY_SINGLE_MODAL_BASE_WIDTH * PATIENT_HISTORY_COLUMN_WIDTH_SCALE)
        + (PATIENT_HISTORY_SINGLE_MODAL_BASE_WIDTH * PATIENT_HISTORY_TREATMENT_COLUMN_WIDTH / 100)
        + combinedPrescriptionWidthIncrease
      ),
      width: '95%',
      gridTemplateColumns: 'minmax(0, 1fr)',
    };
  }
  const shinjangPrescriptionWidthIncrease = isShinjang
    ? PATIENT_HISTORY_SINGLE_MODAL_BASE_WIDTH
      * PATIENT_HISTORY_BASE_COLUMN_WIDTHS[PATIENT_HISTORY_PRESCRIPTION_COLUMN_INDEX]
      * (PATIENT_HISTORY_SHINJANG_PRESCRIPTION_SCALE - 1)
      / 100
    : 0;
  return {
    maxWidth: groupCount === 1
      ? Math.ceil(
          PATIENT_HISTORY_SINGLE_MODAL_BASE_WIDTH * PATIENT_HISTORY_COLUMN_WIDTH_SCALE
          + shinjangPrescriptionWidthIncrease
        )
      : 580,
    width: groupCount === 1 ? '85%' : '80%',
    gridTemplateColumns: 'minmax(0, 1fr)',
  };
}

export function getPatientHistoryColumnWidths(
  groupCount,
  includeTreatmentColumn = false,
  treatmentGroupKey = ''
) {
  void groupCount;
  const expandedWidths = PATIENT_HISTORY_BASE_COLUMN_WIDTHS.map((width, index) => (
    index === PATIENT_HISTORY_MEMO_COLUMN_INDEX
      ? width * PATIENT_HISTORY_MEMO_COLUMN_SCALE
      : index === PATIENT_HISTORY_PRESCRIPTION_COLUMN_INDEX && treatmentGroupKey === 'shinjang'
        ? width * PATIENT_HISTORY_SHINJANG_PRESCRIPTION_SCALE
      : index === PATIENT_HISTORY_PRESCRIPTION_COLUMN_INDEX && includeTreatmentColumn
        ? width * PATIENT_HISTORY_COMBINED_PRESCRIPTION_SCALE
      : index === PATIENT_HISTORY_BASE_COLUMN_WIDTHS.length - 1
        ? width * PATIENT_HISTORY_APPLY_COLUMN_SCALE
        : width
  ));
  const displayWidths = includeTreatmentColumn
    ? [expandedWidths[0], PATIENT_HISTORY_TREATMENT_COLUMN_WIDTH, ...expandedWidths.slice(1)]
    : expandedWidths;
  const totalWidth = displayWidths.reduce((sum, width) => sum + width, 0);
  return displayWidths.map((width) => `${(width / totalWidth) * 100}%`);
}

export function getPatientHistoryScheduleNavigationTarget(logOrDate) {
  const log = logOrDate && typeof logOrDate === 'object' && !(logOrDate instanceof Date)
    ? logOrDate
    : { date: logOrDate };
  const dateValue = log.date;
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

  const toScheduleCell = (value) => {
    const [w, d, r, c] = value.map(Number);
    if (![w, d, r, c].every((item) => Number.isInteger(item) && item >= 0)) return null;
    return { w, d, r, c };
  };
  const canonicalCell = parseSchedulerCellKey(log.scheduler_cell_key);
  let cell = null;
  if (canonicalCell?.year === year && canonicalCell?.month === month) {
    cell = toScheduleCell([
      canonicalCell.week_index,
      canonicalCell.day_index,
      canonicalCell.row_index,
      canonicalCell.col_index,
    ]);
  }

  if (!cell) {
    const directYear = Number(log.year ?? year);
    const directMonth = Number(log.month ?? month);
    if (directYear === year && directMonth === month) {
      cell = toScheduleCell([
        log.week_index,
        log.day_index,
        log.row_index,
        log.col_index,
      ]);
    }
  }

  if (!cell && (log.type === 'draft' || String(log.id || '').startsWith('draft-'))) {
    const draftParts = String(log.schedule_cell_key || '').split('-');
    if (draftParts.length === 4) cell = toScheduleCell(draftParts);
  }

  return { date, year, month, day, cell };
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
  if (hasHoverContent && cellData?.body_part) {
    const bodyParts = splitBodyParts(cellData.body_part)
      .map((part) => formatBodyPartPresetDisplayValue(part));
    text += `\n🦴 부위: ${bodyParts.join(', ')}`;
  }

  const memoList = getMemoListFromMergeSpan(cellData?.merge_span);
  if (memoList.length === 1) {
    text += `\n📝 메모: ${memoList[0]}`;
  } else if (memoList.length > 1) {
    text += `\n📝 메모:\n${memoList.map((memo) => `  • ${memo}`).join('\n')}`;
  }

  return text;
}
