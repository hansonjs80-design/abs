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

export function buildPatientHistoryBodyFilterOptions(logs = [], countLogs = logs) {
  const partMap = new Map();
  logs.forEach((log) => {
    getPatientHistoryBodyFilterParts(log).forEach((part) => {
      if (!partMap.has(part.key)) partMap.set(part.key, { ...part, count: 0 });
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
    ...Array.from(partMap.values()).sort((a, b) => a.label.localeCompare(b.label, 'ko')),
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
  logs.forEach((log) => {
    const prescription = getPatientHistoryPrescriptionFilterPart(log);
    if (!prescriptionMap.has(prescription.key)) {
      prescriptionMap.set(prescription.key, { ...prescription, count: 0 });
    }
  });
  countLogs.forEach((log) => {
    const prescription = getPatientHistoryPrescriptionFilterPart(log);
    const current = prescriptionMap.get(prescription.key);
    if (current) current.count += 1;
  });

  return [
    { key: PATIENT_HISTORY_ALL_PRESCRIPTION_FILTER, label: '전체', count: countLogs.length },
    ...Array.from(prescriptionMap.values()).sort((a, b) => a.label.localeCompare(b.label, 'ko')),
  ];
}

function filterPatientHistoryLogsByBody(logs, bodyFilter) {
  if (bodyFilter === PATIENT_HISTORY_ALL_BODY_FILTER) return logs;
  return logs.filter((log) => (
    getPatientHistoryBodyFilterParts(log).some((part) => part.key === bodyFilter)
  ));
}

function filterPatientHistoryLogsByPrescription(logs, prescriptionFilter) {
  if (prescriptionFilter === PATIENT_HISTORY_ALL_PRESCRIPTION_FILTER) return logs;
  return logs.filter((log) => (
    getPatientHistoryPrescriptionFilterPart(log).key === prescriptionFilter
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
      const requestedBodyFilter = bodyFilters[rawGroup.key] || PATIENT_HISTORY_ALL_BODY_FILTER;
      const requestedPrescriptionFilter = prescriptionFilters[rawGroup.key]
        || PATIENT_HISTORY_ALL_PRESCRIPTION_FILTER;
      const activeBodyFilter = rawBodyFilterOptions.some((option) => option.key === requestedBodyFilter)
        ? requestedBodyFilter
        : PATIENT_HISTORY_ALL_BODY_FILTER;
      const activePrescriptionFilter = rawPrescriptionFilterOptions.some(
        (option) => option.key === requestedPrescriptionFilter
      )
        ? requestedPrescriptionFilter
        : PATIENT_HISTORY_ALL_PRESCRIPTION_FILTER;
      const bodyFilteredLogs = filterPatientHistoryLogsByBody(rawGroup.logs, activeBodyFilter);
      const prescriptionFilteredLogs = filterPatientHistoryLogsByPrescription(
        rawGroup.logs,
        activePrescriptionFilter
      );
      const filteredLogs = filterPatientHistoryLogsByPrescription(
        bodyFilteredLogs,
        activePrescriptionFilter
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
        totalLogs: rawGroup.logs,
        bodyFilterOptions,
        activeBodyFilter,
        prescriptionFilterOptions,
        activePrescriptionFilter,
      };
    })
    .filter(Boolean);
}

export function getPatientHistoryModalLayout(groupCount) {
  if (groupCount >= 2) {
    return {
      maxWidth: 1446,
      width: '96%',
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    };
  }
  return {
    maxWidth: groupCount === 1 ? 735 : 580,
    width: '80%',
    gridTemplateColumns: 'minmax(0, 1fr)',
  };
}

export function getPatientHistoryColumnWidths(groupCount) {
  void groupCount;
  return ['13%', '10%', '12%', '25%', '20%', '7%', '8%', '5%'];
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
