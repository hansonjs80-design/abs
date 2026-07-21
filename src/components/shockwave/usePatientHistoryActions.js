import { useCallback, useRef } from 'react';
import { generateShockwaveCalendar, getTodayKST } from '../../lib/calendarUtils';
import { buildManualTherapyUnmergePayload } from '../../lib/manualTherapyMergeUtils';
import { normalizeNameForMatch } from '../../lib/memoParser';
import {
  buildPatientHistoryCellUpdate,
  getPatientHistorySearchTarget,
  patientHistoryIdentityMatches,
} from '../../lib/patientHistoryModalUtils';
import { buildManualTherapyAutoMergePayload } from '../../lib/scheduleManualTherapyAutoMergeUtils';
import {
  getPrescriptionActionSlotMinutes,
  shouldUnmergeSingleSlotPrescription,
} from '../../lib/schedulePrescriptionChangeUtils';
import {
  getPrescriptionFromConfiguredDoseTag,
  getPrescriptionScheduleSettings,
} from '../../lib/prescriptionScheduleSettings';
import { supabase } from '../../lib/supabaseClient';
import {
  extractDoseTagFromPrescription,
  getActionDoseTagFromPrescription,
  get4060PrescriptionFromContent,
  has4060Pattern,
  updateDoseTagForPrescriptionContent,
} from '../../lib/schedulerContentFormat';
import {
  buildPatientHistorySchedulePresenceKeys,
  buildScheduleRowsBySchedulerCellKey,
  getScheduleRowSchedulerCellKey,
  getScheduleDayDateKey,
  getSchedulerLinkedLogQueryTargets,
  shouldKeepFuturePatientLogForSchedulePresence,
  shouldKeepSchedulerLinkedPatientLog,
  shouldUseScheduleRowForPatientHistory,
} from '../../lib/schedulerHistoryCandidateUtils';
import {
  applyVisitCountToSchedulerContent,
  buildMergeSpanWithBodyPartOptions,
  formatBodyPartInput,
  getBodyPartOptionsFromMergeSpan,
  getExplicitVisitSuffix,
  parseSchedulerPatientIdentity,
  splitBodyParts,
} from '../../lib/schedulerUtils';

const getPatientHistoryTreatmentGroup = ({ type, prescription, content }) => {
  if (type === 'manual') return 'manual';
  if (has4060Pattern(content || '')) return 'manual';
  const prescriptionText = String(prescription || '').trim();
  if (/(?:^|\D)(40|60)\s*분?(?:\D|$)/.test(prescriptionText)) return 'manual';
  return 'shockwave';
};

const DEFAULT_MANUAL_THERAPY_PRESCRIPTIONS = ['40분', '60분'];

const normalizePrescriptionForHistory = (value) => String(value || '').trim().toLowerCase();

const buildActiveManualPrescriptionSet = (settings) => {
  const source = Array.isArray(settings?.manual_therapy_prescriptions)
    ? settings.manual_therapy_prescriptions
    : DEFAULT_MANUAL_THERAPY_PRESCRIPTIONS;
  return new Set(source.map(normalizePrescriptionForHistory).filter(Boolean));
};

const isActiveManualTherapyPrescription = (prescription, activeSet) => (
  activeSet.has(normalizePrescriptionForHistory(prescription))
);

const buildCurrentPrescriptionSet = (settings, year, month) => {
  const config = getPrescriptionScheduleSettings(settings, year, month);
  const source = Array.isArray(config?.schedulerPrescriptions?.all)
    ? config.schedulerPrescriptions.all
    : [
        ...(Array.isArray(config?.shockwave?.prescriptions) ? config.shockwave.prescriptions : []),
        ...(Array.isArray(config?.manualTherapy?.prescriptions) ? config.manualTherapy.prescriptions : []),
      ];
  return new Set(source.map((prescription) => String(prescription || '').trim()).filter(Boolean));
};

const isCurrentConfiguredPrescription = (prescription, currentPrescriptionSet) => {
  const value = String(prescription || '').trim();
  return !value || currentPrescriptionSet.size === 0 || currentPrescriptionSet.has(value);
};

const getPatientHistoryRowKey = (log = {}) => [
  log.type || '',
  log.id || '',
  log.history_group || '',
  log.date || '',
  log.chart_number || '',
  log.patient_name || '',
  log.body_part || '',
].join('__');

const withPatientHistoryRowMeta = (log) => ({
  ...log,
  _history_row_key: getPatientHistoryRowKey(log),
  _original_visit_count: String(log.visit_count || ''),
  _original_prescription: String(log.prescription || ''),
  _original_body_part: String(log.body_part || ''),
});

const getPatientHistoryScheduleOverrideKey = (log = {}) => {
  const date = String(log.date || '').trim();
  const chart = String(log.chart_number || '').trim();
  const name = normalizeNameForMatch(log.patient_name);
  const group = String(log.history_group || 'shockwave').trim();
  const bodyPart = String(log.body_part || '').trim().toLowerCase();
  if (!date) return '';
  if (chart) return `${date}__${group}__chart__${chart}__body__${bodyPart}`;
  if (name) return `${date}__${group}__name__${name}__body__${bodyPart}`;
  return '';
};

const getPreservedBodyPart = (...values) => {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return null;
};

const getHistoryLogTableName = (log = {}) => {
  if (log.type === 'shockwave') return 'shockwave_patient_logs';
  if (log.type === 'manual') return 'manual_therapy_patient_logs';
  return '';
};

const SCHEDULER_LINKED_HISTORY_SCHEDULE_SELECT = [
  'id',
  'year',
  'month',
  'week_index',
  'day_index',
  'row_index',
  'col_index',
  'content',
  'prescription',
  'body_part',
  'merge_span',
  'updated_at',
].join(',');

const fetchScheduleRowsForSchedulerLinkedLogs = async (logs) => {
  const targets = getSchedulerLinkedLogQueryTargets(logs);
  if (targets.length === 0) return buildScheduleRowsBySchedulerCellKey([]);

  const results = await Promise.all(targets.map(async (target) => {
    let query = supabase
      .from('shockwave_schedules')
      .select(SCHEDULER_LINKED_HISTORY_SCHEDULE_SELECT)
      .eq('year', target.year)
      .eq('month', target.month);

    if (target.weekIndexes.length > 0) query = query.in('week_index', target.weekIndexes);
    if (target.dayIndexes.length > 0) query = query.in('day_index', target.dayIndexes);
    if (target.rowIndexes.length > 0) query = query.in('row_index', target.rowIndexes);
    if (target.colIndexes.length > 0) query = query.in('col_index', target.colIndexes);

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }));

  return buildScheduleRowsBySchedulerCellKey(results.flat());
};

const resolveTherapistNameForHistory = ({
  slotIndex,
  day,
  group,
  therapists,
  manualTherapists,
  monthlyRows,
}) => {
  const index = Number(slotIndex);
  if (!Number.isInteger(index) || index < 0 || !day) return '';

  const isManual = group === 'manual';
  const baseTherapists = isManual ? manualTherapists : therapists;
  const monthlyList = Array.isArray(monthlyRows) ? monthlyRows : [];

  if (monthlyList.length > 0) {
    const match = monthlyList.find((therapist) => (
      therapist.slot_index === index &&
      day >= therapist.start_day &&
      day <= therapist.end_day
    ));
    if (match !== undefined) return match.therapist_name || '';
  }

  return baseTherapists?.[index]?.name || '';
};

const getHistoryMonthKey = (year, month, type) => `${year}-${month}-${type}`;

const getHistoryMonthValue = (year, month) => (Number(year) * 12) + Number(month);

const loadMonthlyTherapistRowsForHistory = async ({
  year,
  month,
  type,
  therapists,
  manualTherapists,
}) => {
  const { data, error } = await supabase
    .from('shockwave_monthly_therapists')
    .select('*')
    .eq('year', year)
    .eq('month', month)
    .eq('type', type)
    .order('slot_index')
    .order('start_day');

  if (!error && Array.isArray(data) && data.length > 0) return data;

  const currentValue = getHistoryMonthValue(year, month);
  const lookbackYear = month <= 12 ? year - 1 : year;
  const { data: previousRows, error: prevError } = await supabase
    .from('shockwave_monthly_therapists')
    .select('*')
    .eq('type', type)
    .gte('year', lookbackYear)
    .order('year', { ascending: false })
    .order('month', { ascending: false })
    .order('slot_index')
    .order('start_day')
    .limit(80);

  const previousMonths = (previousRows || []).filter((item) => {
    const value = getHistoryMonthValue(item.year, item.month);
    return value < currentValue;
  });
  const inheritedValue = previousMonths.reduce((max, item) => (
    Math.max(max, getHistoryMonthValue(item.year, item.month))
  ), -Infinity);
  const prevData = previousMonths.filter((item) => (
    getHistoryMonthValue(item.year, item.month) === inheritedValue
  ));

  if (!prevError && prevData.length > 0) {
    const slotMap = new Map();
    prevData.forEach((item) => {
      const existing = slotMap.get(item.slot_index);
      if (!existing || item.start_day > existing.start_day) {
        slotMap.set(item.slot_index, item);
      }
    });
    const lastDay = new Date(year, month, 0).getDate();
    return Array.from(slotMap.values()).map((item) => ({
      slot_index: item.slot_index,
      therapist_name: item.therapist_name,
      start_day: 1,
      end_day: lastDay,
      year,
      month,
      type,
    }));
  }

  const baseTherapists = type === 'manual_therapy' ? manualTherapists : therapists;
  const lastDay = new Date(year, month, 0).getDate();
  return (baseTherapists || []).map((therapist, index) => ({
    slot_index: Number.isInteger(Number(therapist?.slot_index)) ? Number(therapist.slot_index) : index,
    therapist_name: therapist?.name || '',
    start_day: 1,
    end_day: lastDay,
    year,
    month,
    type,
  }));
};

const getUniqueMatchingBodyPart = (items, scheduleLog) => {
  const bodies = new Set();
  items.forEach((item) => {
    if (item.date !== scheduleLog.date) return;
    if ((item.history_group || 'shockwave') !== scheduleLog.history_group) return;
    if (!patientHistoryIdentityMatches({
      chartParam: scheduleLog.chart_number,
      nameParam: scheduleLog.patient_name,
      chartValue: item.chart_number,
      nameValue: item.patient_name,
    })) return;
    const bodyPart = String(item.body_part || '').trim();
    if (bodyPart) bodies.add(bodyPart);
  });
  return bodies.size === 1 ? [...bodies][0] : '';
};

export default function usePatientHistoryActions({
  currentYear,
  currentMonth,
  holidays,
  settings,
  therapists,
  manualTherapists,
  monthlyTherapists,
  monthlyManualTherapists,
  selectedCell,
  editingCell,
  editValue,
  editInputRef,
  memos,
  pendingDisplayValues,
  baseTimeSlotsLength,
  colCount,
  cellKey,
  saveShockwaveMemosBulk,
  addToast,
  setPendingDisplayValues,
  applyImmediateCellDisplay,
  applyImmediateMergeSpan,
  clearImmediateCellDisplay,
  setPatientHistoryModalOpen,
  setPatientHistoryModalData,
}) {
  const patientHistoryResultCacheRef = useRef(new Map());
  const monthlyTherapistRowsCacheRef = useRef(new Map());
  const calendarCacheRef = useRef(new Map());

  const fetchPatientHistory = useCallback(async (nameParam, chartParam, options = {}) => {
    const activeSelectedKey = String(options?.selectedKey || '');
    const activeSelectedContent = typeof options?.selectedContent === 'string'
      ? options.selectedContent
      : null;
    let selectedDate = '';
    let selectedKey = activeSelectedKey;
    let selectedDayInfo = null;
    if (selectedCell) {
      const calWeeks = generateShockwaveCalendar(currentYear, currentMonth, holidays);
      selectedDayInfo = calWeeks[selectedCell.w]?.[selectedCell.d] || null;
      if (selectedDayInfo) {
        selectedDate = getScheduleDayDateKey(selectedDayInfo);
        selectedKey = selectedKey || cellKey(selectedCell.w, selectedCell.d, selectedCell.r, selectedCell.c);
      }
    }
    const manualPrescriptionSignature = Array.isArray(settings?.manual_therapy_prescriptions)
      ? settings.manual_therapy_prescriptions.join('|')
      : '';
    const cacheKey = [
      normalizeNameForMatch(nameParam),
      String(chartParam || '').trim(),
      activeSelectedKey,
      activeSelectedContent ?? '',
      currentYear,
      currentMonth,
      selectedDate,
      baseTimeSlotsLength,
      colCount,
      manualPrescriptionSignature,
    ].join('__');
    const cached = patientHistoryResultCacheRef.current.get(cacheKey);
    if (cached && Date.now() - cached.time < 15000) {
      setPatientHistoryModalData({
        loading: false,
        logs: cached.logs,
        searchName: nameParam,
        searchChart: chartParam,
      });
      return;
    }
    setPatientHistoryModalData((prev) => ({ ...prev, loading: true, searchName: nameParam, searchChart: chartParam }));
    try {
      const activeManualPrescriptionSet = buildActiveManualPrescriptionSet(settings);
      const shockwaveQuery = supabase.from('shockwave_patient_logs')
        .select('id, patient_name, chart_number, visit_count, date, prescription, body_part, therapist_name, source, scheduler_cell_key')
        .order('date', { ascending: false })
        .limit(500);

      const manualQuery = supabase.from('manual_therapy_patient_logs')
        .select('id, patient_name, chart_number, visit_count, date, prescription, body_part, therapist_name, source, scheduler_cell_key')
        .order('date', { ascending: false })
        .limit(500);

      const scheduleQuery = supabase.from('shockwave_schedules')
        .select(SCHEDULER_LINKED_HISTORY_SCHEDULE_SELECT)
        .neq('content', '')
        .order('year', { ascending: false })
        .order('month', { ascending: false })
        .limit(1000);

      if (chartParam) {
        shockwaveQuery.eq('chart_number', chartParam);
        manualQuery.eq('chart_number', chartParam);
        scheduleQuery.ilike('content', `%${chartParam}%`);
      } else if (nameParam) {
        shockwaveQuery.ilike('patient_name', `%${nameParam}%`);
        manualQuery.ilike('patient_name', `%${nameParam}%`);
        scheduleQuery.ilike('content', `%${nameParam}%`);
      }

      const [shockwaveRes, manualRes, scheduleRes] = await Promise.all([shockwaveQuery, manualQuery, scheduleQuery]);

      const fetchedLogData = [
        ...(shockwaveRes.data || []).filter((d) => patientHistoryIdentityMatches({
          chartParam,
          nameParam,
          chartValue: d.chart_number,
          nameValue: d.patient_name,
        })).map((d) => ({
          ...d,
          type: 'shockwave',
          history_group: getPatientHistoryTreatmentGroup({ type: 'shockwave', prescription: d.prescription }),
        })),
        ...(manualRes.data || []).filter((d) => (
          patientHistoryIdentityMatches({
            chartParam,
            nameParam,
            chartValue: d.chart_number,
            nameValue: d.patient_name,
          }) && isActiveManualTherapyPrescription(d.prescription, activeManualPrescriptionSet)
        )).map((d) => ({
          ...d,
          type: 'manual',
          history_group: 'manual',
        })),
      ];
      const linkedScheduleRowsByKey = await fetchScheduleRowsForSchedulerLinkedLogs(fetchedLogData);
      const keepHistoryLog = (log) => shouldKeepSchedulerLinkedPatientLog(log, linkedScheduleRowsByKey, {
        rowCount: baseTimeSlotsLength,
        colCount,
        patientMatchesSchedule: (historyLog, scheduleIdentity) => patientHistoryIdentityMatches({
          chartParam: historyLog.chart_number,
          nameParam: historyLog.patient_name,
          chartValue: scheduleIdentity.patientChart,
          nameValue: scheduleIdentity.patientName,
        }),
        getLogHistoryGroup: (historyLog) => historyLog.history_group || historyLog.type,
        getScheduleHistoryGroup: (scheduleRow, content) => getPatientHistoryTreatmentGroup({
          type: 'schedule',
          prescription: scheduleRow.prescription,
          content,
        }),
      });
      let allData = fetchedLogData.filter(keepHistoryLog);

      const scheduleCandidates = scheduleRes.data || [];
      const latestScheduleRowsByKey = await fetchScheduleRowsForSchedulerLinkedLogs(
        scheduleCandidates.map((row) => ({
          scheduler_cell_key: getScheduleRowSchedulerCellKey(row),
        }))
      );
      const scheduleData = [];
      const seenScheduleKeys = new Set();
      scheduleCandidates.forEach((candidate) => {
        const key = getScheduleRowSchedulerCellKey(candidate);
        if (!key || seenScheduleKeys.has(key)) return;
        seenScheduleKeys.add(key);
        const latest = latestScheduleRowsByKey.get(key);
        if (latest) scheduleData.push(latest);
      });
      const scheduleOverrides = new Map();
      const therapistSignature = (therapists || []).map((item) => item?.name || '').join('|');
      const manualTherapistSignature = (manualTherapists || []).map((item) => item?.name || '').join('|');
      const getMonthlyTherapistRows = async (year, month, historyGroup) => {
        const type = historyGroup === 'manual' ? 'manual_therapy' : 'shockwave';
        const baseSignature = type === 'manual_therapy' ? manualTherapistSignature : therapistSignature;
        const key = `${getHistoryMonthKey(year, month, type)}__${baseSignature}`;
        if (!monthlyTherapistRowsCacheRef.current.has(key)) {
          monthlyTherapistRowsCacheRef.current.set(key, loadMonthlyTherapistRowsForHistory({
            year,
            month,
            type,
            therapists,
            manualTherapists,
          }));
        }
        return monthlyTherapistRowsCacheRef.current.get(key);
      };
      const getCachedCalendar = (year, month) => {
        const key = `${year}-${month}`;
        if (!calendarCacheRef.current.has(key)) {
          calendarCacheRef.current.set(key, generateShockwaveCalendar(year, month));
        }
        return calendarCacheRef.current.get(key);
      };

      const scheduleRowsWithMeta = [];
      const monthlyPreloadTargets = new Map();
      for (const s of scheduleData) {
        try {
          const calWeeks = getCachedCalendar(s.year, s.month);
          const dayInfo = calWeeks[s.week_index]?.[s.day_index];
          if (!dayInfo) continue;
          if (!shouldUseScheduleRowForPatientHistory(s, dayInfo, {
            rowCount: baseTimeSlotsLength,
            colCount,
          })) continue;
          const dateStr = getScheduleDayDateKey(dayInfo);

          const content = s.content || '';
          const parsed = parseSchedulerPatientIdentity(content);
          if (!patientHistoryIdentityMatches({
            chartParam,
            nameParam,
            chartValue: parsed.patientChart,
            nameValue: parsed.patientName,
          })) continue;

          const visitSuffix = getExplicitVisitSuffix(content);
          const visitCount = visitSuffix.replace(/[()]/g, '') || '';
          const schedulePrescription = s.prescription
            || getPrescriptionFromConfiguredDoseTag(settings, currentYear, currentMonth, content)
            || get4060PrescriptionFromContent(content);
          const historyGroup = getPatientHistoryTreatmentGroup({
            type: 'schedule',
            prescription: schedulePrescription,
            content,
          });
          scheduleRowsWithMeta.push({
            row: s,
            dayInfo,
            dateStr,
            parsed,
            visitCount,
            schedulePrescription,
            historyGroup,
          });
          monthlyPreloadTargets.set(`${s.year}-${s.month}-${historyGroup}`, {
            year: s.year,
            month: s.month,
            historyGroup,
          });
        } catch {
          // Ignore malformed schedule rows.
        }
      }

      const today = getTodayKST();
      const todayDateKey = getScheduleDayDateKey({
        year: today.getFullYear(),
        month: today.getMonth() + 1,
        day: today.getDate(),
      });
      const schedulePresenceKeys = buildPatientHistorySchedulePresenceKeys(scheduleRowsWithMeta);
      allData = allData.filter((log) => (
        shouldKeepFuturePatientLogForSchedulePresence(log, schedulePresenceKeys, todayDateKey)
      ));

      await Promise.all([...monthlyPreloadTargets.values()].map((target) => (
        getMonthlyTherapistRows(target.year, target.month, target.historyGroup)
      )));

      for (const item of scheduleRowsWithMeta) {
        try {
          const {
            row: s,
            dayInfo,
            dateStr,
            parsed,
            visitCount,
            schedulePrescription,
            historyGroup,
          } = item;
          const therapistName = resolveTherapistNameForHistory({
            slotIndex: s.col_index,
            day: dayInfo.day,
            group: historyGroup,
            therapists,
            manualTherapists,
            monthlyRows: await getMonthlyTherapistRows(s.year, s.month, historyGroup),
          });

          const scheduleLog = {
            id: s.id,
            date: dateStr,
            patient_name: parsed.patientName || '',
            chart_number: parsed.patientChart || '',
            visit_count: visitCount,
            prescription: schedulePrescription || '',
            body_part: s.body_part || '',
            therapist_name: therapistName,
            type: 'schedule',
            history_group: historyGroup,
          };
          scheduleLog.body_part = getPreservedBodyPart(
            scheduleLog.body_part,
            getUniqueMatchingBodyPart(allData, scheduleLog),
          ) || '';
          const scheduleOverrideKey = getPatientHistoryScheduleOverrideKey(scheduleLog);
          if (scheduleOverrideKey) scheduleOverrides.set(scheduleOverrideKey, scheduleLog);

          const existingIndex = allData.findIndex((item) => {
            if (item.date !== scheduleLog.date) return false;
            if ((item.history_group || 'shockwave') !== scheduleLog.history_group) return false;
            if (String(item.body_part || '').trim().toLowerCase() !== String(scheduleLog.body_part || '').trim().toLowerCase()) return false;
            return patientHistoryIdentityMatches({
              chartParam: scheduleLog.chart_number,
              nameParam: scheduleLog.patient_name,
              chartValue: item.chart_number,
              nameValue: item.patient_name,
            });
          });

          if (existingIndex >= 0) {
            allData[existingIndex] = {
              ...allData[existingIndex],
              patient_name: scheduleLog.patient_name || allData[existingIndex].patient_name,
              chart_number: scheduleLog.chart_number || allData[existingIndex].chart_number,
              visit_count: scheduleLog.visit_count || allData[existingIndex].visit_count,
              prescription: scheduleLog.prescription || allData[existingIndex].prescription,
              body_part: scheduleLog.body_part || allData[existingIndex].body_part,
              therapist_name: scheduleLog.therapist_name,
              schedule_id: scheduleLog.id,
            };
          } else {
            allData.push(scheduleLog);
          }
        } catch {
          // Ignore malformed schedule rows.
        }
      }

      const matches = allData.filter((item) => {
        return patientHistoryIdentityMatches({
          chartParam,
          nameParam,
          chartValue: item.chart_number,
          nameValue: item.patient_name,
        });
      }).map((item) => {
        const override = scheduleOverrides.get(getPatientHistoryScheduleOverrideKey(item));
        if (!override) return item;
        return {
          ...item,
          patient_name: override.patient_name || item.patient_name,
          chart_number: override.chart_number || item.chart_number,
          visit_count: override.visit_count,
          prescription: override.prescription || item.prescription,
          body_part: override.body_part || item.body_part,
          therapist_name: override.therapist_name,
          schedule_id: override.id,
        };
      });

      scheduleOverrides.forEach((override) => {
        const alreadyIncluded = matches.some((item) => (
          getPatientHistoryScheduleOverrideKey(item) === getPatientHistoryScheduleOverrideKey(override)
        ));
        if (!alreadyIncluded) matches.push(override);
      });

      matches.sort((a, b) => {
        if (a.date !== b.date) return b.date.localeCompare(a.date);
        return (parseInt(b.visit_count || '0', 10) || 0) - (parseInt(a.visit_count || '0', 10) || 0);
      });

      const selectedDateLogs = [];
      if (selectedCell && selectedDayInfo && selectedDate) {
          for (let rowIndex = 0; rowIndex < baseTimeSlotsLength; rowIndex++) {
            for (let colIndex = 0; colIndex < colCount; colIndex++) {
              const key = cellKey(selectedCell.w, selectedCell.d, rowIndex, colIndex);
              const memo = memos[key] || {};
              const content = activeSelectedKey === key && activeSelectedContent !== null
                ? activeSelectedContent
                : Object.prototype.hasOwnProperty.call(pendingDisplayValues, key)
                ? pendingDisplayValues[key]
                : (memo.content || '');
              if (!String(content || '').trim()) continue;

              const parsed = parseSchedulerPatientIdentity(content);
              if (!patientHistoryIdentityMatches({
                chartParam,
                nameParam,
                chartValue: parsed.patientChart,
                nameValue: parsed.patientName,
              })) continue;

              const visitSuffix = getExplicitVisitSuffix(content);
              const currentPrescription = memo.prescription
                || getPrescriptionFromConfiguredDoseTag(settings, currentYear, currentMonth, content)
                || get4060PrescriptionFromContent(content);
              const historyGroup = getPatientHistoryTreatmentGroup({
                type: 'draft',
                prescription: currentPrescription,
                content,
              });
              const draftLog = {
                date: selectedDate,
                patient_name: parsed.patientName || nameParam || '',
                chart_number: parsed.patientChart || chartParam || '',
                history_group: historyGroup,
              };
              selectedDateLogs.push({
                id: `draft-${key}`,
                schedule_cell_key: key,
                date: selectedDate,
                patient_name: draftLog.patient_name,
                chart_number: draftLog.chart_number,
                prescription: currentPrescription || '',
                body_part: getPreservedBodyPart(
                  memo.body_part,
                  getUniqueMatchingBodyPart(allData, draftLog),
                ) || '',
                therapist_name: resolveTherapistNameForHistory({
                  slotIndex: colIndex,
                  day: selectedDayInfo.day,
                  group: historyGroup,
                  therapists,
                  manualTherapists,
                  monthlyRows: historyGroup === 'manual' ? monthlyManualTherapists : monthlyTherapists,
                }),
                visit_count: visitSuffix.replace(/[()]/g, '') || '',
                type: 'draft',
                history_group: draftLog.history_group,
                isCurrentCell: key === selectedKey,
                sort_index: rowIndex * colCount + colIndex,
              });
            }
          }
      }

      let finalLogs = matches;
      if (selectedDate && selectedDateLogs.length > 0) {
        selectedDateLogs.sort((a, b) => (a.sort_index || 0) - (b.sort_index || 0));
        finalLogs = [
          ...selectedDateLogs,
          ...matches.filter((m) => m.date !== selectedDate),
        ].sort((a, b) => {
          if (a.date !== b.date) return b.date.localeCompare(a.date);
          if (a.date === selectedDate && b.date === selectedDate) {
            return (a.sort_index ?? 0) - (b.sort_index ?? 0);
          }
          return (parseInt(b.visit_count || '0', 10) || 0) - (parseInt(a.visit_count || '0', 10) || 0);
        });
      }
      const logsWithMeta = finalLogs.map(withPatientHistoryRowMeta);
      patientHistoryResultCacheRef.current.set(cacheKey, {
        time: Date.now(),
        logs: logsWithMeta,
      });
      if (patientHistoryResultCacheRef.current.size > 30) {
        const oldestKey = patientHistoryResultCacheRef.current.keys().next().value;
        patientHistoryResultCacheRef.current.delete(oldestKey);
      }
      setPatientHistoryModalData({
        loading: false,
        logs: logsWithMeta,
        searchName: nameParam,
        searchChart: chartParam,
      });
    } catch (e) {
      console.error(e);
      alert(`디버그 에러 발생: ${e.message}`);
      setPatientHistoryModalData((prev) => ({ ...prev, loading: false }));
    }
  }, [
    currentYear,
    currentMonth,
    holidays,
    settings,
    therapists,
    manualTherapists,
    monthlyTherapists,
    monthlyManualTherapists,
    selectedCell,
    memos,
    pendingDisplayValues,
    baseTimeSlotsLength,
    colCount,
    cellKey,
    setPatientHistoryModalData,
  ]);

  const buildContentWithPrescription = useCallback((content, oldPrescription, newPrescription) => {
    const prescriptionScheduleSettings = getPrescriptionScheduleSettings(settings, currentYear, currentMonth);
    const doseTag = getActionDoseTagFromPrescription(newPrescription, prescriptionScheduleSettings.doseTags);
    const previousDoseTag = prescriptionScheduleSettings.doseTags?.[oldPrescription]
      || extractDoseTagFromPrescription(oldPrescription);
    return updateDoseTagForPrescriptionContent(
      content,
      doseTag,
      previousDoseTag,
      prescriptionScheduleSettings.doseTags
    );
  }, [currentMonth, currentYear, settings]);

  const saveScheduleCellHistoryField = useCallback(async (targetKey, field, rawValue, log = {}) => {
    const parts = String(targetKey || '').split('-').map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return false;
    const [w, d, r, c] = parts;
    const memo = memos[targetKey] || {};
    const content = Object.prototype.hasOwnProperty.call(pendingDisplayValues, targetKey)
      ? pendingDisplayValues[targetKey]
      : (memo.content || '');
    if (!String(content || '').trim()) return true;

    const prescriptionScheduleSettings = getPrescriptionScheduleSettings(settings, currentYear, currentMonth);
    const normalizedValue = field === 'body_part'
      ? formatBodyPartInput(rawValue)
      : String(rawValue || '').trim();
    const nextPrescription = field === 'prescription'
      ? normalizedValue
      : String(memo.prescription || log.prescription || '').trim();
    const nextBodyPart = field === 'body_part'
      ? normalizedValue
      : (getPreservedBodyPart(memo.body_part, log.body_part) || '');
    const updatedContent = field === 'prescription'
      ? buildContentWithPrescription(content, memo.prescription || log.prescription || '', nextPrescription)
      : content;
    const nextBodyParts = splitBodyParts(nextBodyPart);
    const nextBodyPartOptions = field === 'body_part'
      ? Array.from(new Set([
          ...getBodyPartOptionsFromMergeSpan(memo.merge_span),
          ...nextBodyParts,
        ].filter(Boolean)))
      : getBodyPartOptionsFromMergeSpan(memo.merge_span);
    const nextMergeSpan = field === 'body_part'
      ? buildMergeSpanWithBodyPartOptions(memo.merge_span, nextBodyPartOptions)
      : memo.merge_span;

    const basePayload = {
      year: currentYear,
      month: currentMonth,
      week_index: w,
      day_index: d,
      row_index: r,
      col_index: c,
      content: updatedContent,
      bg_color: memo.bg_color || null,
      prescription: nextPrescription || null,
      body_part: nextBodyPart || null,
      merge_span: nextMergeSpan || { rowSpan: 1, colSpan: 1, mergedInto: null },
    };
    const scheduleSlotMinutes = getPrescriptionActionSlotMinutes(settings);
    const currentMergeSpan = memo.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null };
    const shouldUnmergeSingleSlot = field === 'prescription' && shouldUnmergeSingleSlotPrescription({
      prescription: nextPrescription,
      mergeSpan: currentMergeSpan,
      prescriptionScheduleSettings,
      settings,
    });

    const manualTherapyMerge = buildManualTherapyAutoMergePayload({
      key: targetKey,
      memos,
      currentYear,
      currentMonth,
      rowCount: baseTimeSlotsLength,
      content: updatedContent,
      bgColor: memo.bg_color || null,
      prescription: nextPrescription,
      bodyPart: nextBodyPart || null,
      mergeSpan: basePayload.merge_span,
      durationMinutesMap: prescriptionScheduleSettings.durationMinutesMap,
      doseTags: prescriptionScheduleSettings.doseTags,
      slotMinutes: scheduleSlotMinutes,
    });
    const prescriptionUnmerge = shouldUnmergeSingleSlot
      ? buildManualTherapyUnmergePayload({
          key: targetKey,
          memos,
          currentYear,
          currentMonth,
          content: updatedContent,
          bgColor: memo.bg_color || null,
          prescription: nextPrescription || null,
          bodyPart: nextBodyPart || null,
        })
      : null;
    const savePayload = prescriptionUnmerge?.ok
      ? prescriptionUnmerge.payload
      : (manualTherapyMerge.ok ? manualTherapyMerge.payload : [basePayload]);

    setPendingDisplayValues((prev) => {
      const next = { ...prev };
      savePayload.forEach((item) => {
        next[`${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`] = String(item.content ?? '');
      });
      return next;
    });
    applyImmediateCellDisplay?.(savePayload, { keepContextMenuOpen: true });
    applyImmediateMergeSpan?.(savePayload);

    const success = await saveShockwaveMemosBulk(savePayload);
    if (success) {
      clearImmediateCellDisplay?.(savePayload);
      patientHistoryResultCacheRef.current.clear();
      addToast(field === 'prescription' ? '처방이 수정되었습니다.' : '부위가 수정되었습니다.', 'success');
      return true;
    }

    addToast(field === 'prescription' ? '처방 수정 실패' : '부위 수정 실패', 'error');
    return false;
  }, [
    addToast,
    applyImmediateCellDisplay,
    applyImmediateMergeSpan,
    baseTimeSlotsLength,
    buildContentWithPrescription,
    clearImmediateCellDisplay,
    currentMonth,
    currentYear,
    memos,
    pendingDisplayValues,
    saveShockwaveMemosBulk,
    setPendingDisplayValues,
    settings,
  ]);

  const updateLinkedScheduleRowField = useCallback(async (scheduleId, field, value, oldPrescription = '') => {
    if (!scheduleId) return;
    const updatePayload = { updated_at: new Date().toISOString() };

    if (field === 'prescription') {
      const { data, error: fetchError } = await supabase
        .from('shockwave_schedules')
        .select('content, prescription')
        .eq('id', scheduleId)
        .single();
      if (fetchError) throw fetchError;
      updatePayload.prescription = value || null;
      if (data) {
        updatePayload.content = buildContentWithPrescription(
          data.content || '',
          oldPrescription || data.prescription || '',
          value
        );
      }
    } else if (field === 'body_part') {
      updatePayload.body_part = value || null;
    }

    const { error } = await supabase
      .from('shockwave_schedules')
      .update(updatePayload)
      .eq('id', scheduleId);
    if (error) throw error;
  }, [buildContentWithPrescription]);

  const handleUpdatePatientHistoryField = useCallback(async (log, field, rawValue) => {
    if (!['prescription', 'body_part'].includes(field)) return false;
    const newValue = field === 'body_part'
      ? formatBodyPartInput(rawValue)
      : String(rawValue || '').trim();

    try {
      if (log.id === 'draft' || log.isCurrentCell) {
        if (!selectedCell) return false;
        const key = cellKey(selectedCell.w, selectedCell.d, selectedCell.r, selectedCell.c);
        return saveScheduleCellHistoryField(key, field, newValue, log);
      }

      if (String(log.id || '').startsWith('draft-')) {
        return saveScheduleCellHistoryField(log.schedule_cell_key, field, newValue, log);
      }

      if (log.type === 'schedule') {
        await updateLinkedScheduleRowField(log.id, field, newValue, log.prescription || '');
      } else {
        const tableName = getHistoryLogTableName(log);
        if (tableName) {
          const { error } = await supabase
            .from(tableName)
            .update({ [field]: newValue || null })
            .eq('id', log.id);
          if (error) throw error;
        }
        if (log.schedule_id) {
          await updateLinkedScheduleRowField(log.schedule_id, field, newValue, log.prescription || '');
        }
      }

      patientHistoryResultCacheRef.current.clear();
      addToast(field === 'prescription' ? '처방이 수정되었습니다.' : '부위가 수정되었습니다.', 'success');
      return true;
    } catch (e) {
      console.error(e);
      addToast(field === 'prescription' ? '처방 수정 실패' : '부위 수정 실패', 'error');
      return false;
    }
  }, [
    addToast,
    cellKey,
    saveScheduleCellHistoryField,
    selectedCell,
    updateLinkedScheduleRowField,
  ]);

  const handleUpdateLogVisitCount = useCallback(async (log, newValue) => {
    if (log.id === 'draft' || log.type === 'draft') return false;

    try {
      if (log.type === 'schedule') {
        const { data } = await supabase.from('shockwave_schedules').select('content').eq('id', log.id).single();
        if (data) {
          const updatedContent = applyVisitCountToSchedulerContent(data.content, newValue);
          const { error } = await supabase.from('shockwave_schedules').update({ content: updatedContent, updated_at: new Date().toISOString() }).eq('id', log.id);
          if (error) throw error;
        }
      } else {
        const tableName = log.type === 'shockwave' ? 'shockwave_patient_logs' : 'manual_therapy_patient_logs';
        const { error } = await supabase.from(tableName).update({ visit_count: newValue }).eq('id', log.id);
        if (error) throw error;
      }

      if (log.schedule_id && log.type !== 'schedule') {
        const { data, error: fetchScheduleError } = await supabase
          .from('shockwave_schedules')
          .select('content')
          .eq('id', log.schedule_id)
          .single();
        if (fetchScheduleError) throw fetchScheduleError;
        if (data) {
          const updatedContent = applyVisitCountToSchedulerContent(data.content, newValue);
          const { error: updateScheduleError } = await supabase
            .from('shockwave_schedules')
            .update({ content: updatedContent, updated_at: new Date().toISOString() })
            .eq('id', log.schedule_id);
          if (updateScheduleError) throw updateScheduleError;
        }
      }

      const calWeeks = generateShockwaveCalendar(currentYear, currentMonth, holidays);
      let targetW = -1;
      let targetD = -1;

      for (let w = 0; w < calWeeks.length; w++) {
        for (let d = 0; d < calWeeks[w].length; d++) {
          const dd = calWeeks[w][d].date;
          const dateStr = `${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, '0')}-${String(dd.getDate()).padStart(2, '0')}`;
          if (dateStr === log.date) {
            targetW = w;
            targetD = d;
            break;
          }
        }
        if (targetW !== -1) break;
      }

      let scheduleSyncFailed = false;
      if (targetW !== -1 && targetD !== -1) {
        for (let r = 0; r < baseTimeSlotsLength; r++) {
          for (let c = 0; c < colCount; c++) {
            const key = cellKey(targetW, targetD, r, c);
            const memo = memos[key] || {};
            const content = Object.prototype.hasOwnProperty.call(pendingDisplayValues, key)
              ? pendingDisplayValues[key]
              : (memo.content || '');
            if (String(content || '').trim()) {
              const parsed = parseSchedulerPatientIdentity(content);
              const matchChart = log.chart_number && parsed.patientChart && String(parsed.patientChart).trim() === String(log.chart_number).trim();
              const matchName = log.patient_name && normalizeNameForMatch(parsed.patientName) === normalizeNameForMatch(log.patient_name);
              const logBodyPart = String(log.body_part || '').trim().toLowerCase();
              const memoBodyPart = String(memo.body_part || '').trim().toLowerCase();
              const bodyPartMatches = !logBodyPart || !memoBodyPart || logBodyPart === memoBodyPart;

              if ((matchChart || matchName) && bodyPartMatches) {
                const updatedContent = applyVisitCountToSchedulerContent(content, newValue);
                if (updatedContent !== content) {
                  setPendingDisplayValues((prev) => ({ ...prev, [key]: updatedContent }));
                  const success = await saveShockwaveMemosBulk([{
                    year: currentYear,
                    month: currentMonth,
                    week_index: targetW,
                    day_index: targetD,
                    row_index: r,
                    col_index: c,
                    content: updatedContent,
                    bg_color: memo.bg_color || null,
                    prescription: memo.prescription || null,
                    body_part: getPreservedBodyPart(memo.body_part, log.body_part),
                    merge_span: memo.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null },
                  }]);
                  if (!success) scheduleSyncFailed = true;
                }
              }
            }
          }
        }
      }
      if (scheduleSyncFailed) throw new Error('schedule sync failed');
      addToast('해당 날짜의 회차가 수정되었습니다.', 'success');
      return true;
    } catch (e) {
      console.error(e);
      addToast('회차 수정 실패', 'error');
      return false;
    }
  }, [addToast, currentYear, currentMonth, holidays, memos, pendingDisplayValues, baseTimeSlotsLength, colCount, saveShockwaveMemosBulk, cellKey, setPendingDisplayValues]);

  const handleUpdateCurrentCellVisitCount = useCallback(async (newValue, log = {}) => {
    if (!selectedCell) return false;
    const { w, d, r, c } = selectedCell;
    const key = cellKey(w, d, r, c);
    const memo = memos[key] || {};
    const content = editingCell === key
      ? (editInputRef.current?.value ?? editValue)
      : (Object.prototype.hasOwnProperty.call(pendingDisplayValues, key)
          ? pendingDisplayValues[key]
          : (memo.content || ''));
    const updatedContent = applyVisitCountToSchedulerContent(content, newValue);
    if (!String(content || '').trim() || updatedContent === content) return true;

    const payload = [{
      year: currentYear,
      month: currentMonth,
      week_index: w,
      day_index: d,
      row_index: r,
      col_index: c,
      content: updatedContent,
      bg_color: memo.bg_color || null,
      prescription: memo.prescription || null,
      body_part: getPreservedBodyPart(memo.body_part, log.body_part),
      merge_span: memo.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null },
    }];

    setPendingDisplayValues((prev) => ({ ...prev, [key]: updatedContent }));
    applyImmediateCellDisplay?.(payload, { keepContextMenuOpen: true });
    applyImmediateMergeSpan?.(payload);

    const success = await saveShockwaveMemosBulk(payload);
    if (success) {
      clearImmediateCellDisplay?.(payload);
      addToast('회차가 수정되었습니다.', 'success');
      return true;
    }

    addToast('회차 수정 실패', 'error');
    return false;
  }, [
    selectedCell,
    cellKey,
    memos,
    editingCell,
    editInputRef,
    editValue,
    pendingDisplayValues,
    currentYear,
    currentMonth,
    saveShockwaveMemosBulk,
    setPendingDisplayValues,
    applyImmediateCellDisplay,
    applyImmediateMergeSpan,
    clearImmediateCellDisplay,
    addToast,
  ]);

  const handleUpdateDraftHistoryVisitCount = useCallback(async (log, newValue) => {
    const draftKey = String(log?.schedule_cell_key || '').trim();
    if (!draftKey) return handleUpdateCurrentCellVisitCount(newValue, log);
    const parts = draftKey.split('-').map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
      return false;
    }
    const [w, d, r, c] = parts;
    const memo = memos[draftKey] || {};
    const content = Object.prototype.hasOwnProperty.call(pendingDisplayValues, draftKey)
      ? pendingDisplayValues[draftKey]
      : (memo.content || '');
    const updatedContent = applyVisitCountToSchedulerContent(content, newValue);
    if (!String(content || '').trim() || updatedContent === content) return true;

    const payload = [{
      year: currentYear,
      month: currentMonth,
      week_index: w,
      day_index: d,
      row_index: r,
      col_index: c,
      content: updatedContent,
      bg_color: memo.bg_color || null,
      prescription: memo.prescription || null,
      body_part: getPreservedBodyPart(memo.body_part, log.body_part),
      merge_span: memo.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null },
    }];

    setPendingDisplayValues((prev) => ({ ...prev, [draftKey]: updatedContent }));
    applyImmediateCellDisplay?.(payload, { keepContextMenuOpen: true });
    applyImmediateMergeSpan?.(payload);

    const success = await saveShockwaveMemosBulk(payload);
    if (success) {
      clearImmediateCellDisplay?.(payload);
      addToast('회차가 수정되었습니다.', 'success');
      return true;
    }

    addToast('회차 수정 실패', 'error');
    return false;
  }, [
    handleUpdateCurrentCellVisitCount,
    memos,
    pendingDisplayValues,
    currentYear,
    currentMonth,
    saveShockwaveMemosBulk,
    setPendingDisplayValues,
    applyImmediateCellDisplay,
    applyImmediateMergeSpan,
    clearImmediateCellDisplay,
    addToast,
  ]);

  const handleOpenPatientHistoryModal = useCallback(async () => {
    try {
      if (!selectedCell) {
        alert('디버그: 선택된 셀이 없습니다.');
        return;
      }
      const { w, d, r, c } = selectedCell;
      const key = cellKey(w, d, r, c);
      const content = editingCell === key
        ? (editInputRef.current?.value ?? editValue)
        : (Object.prototype.hasOwnProperty.call(pendingDisplayValues, key)
            ? pendingDisplayValues[key]
            : (memos[key]?.content || ''));

      if (!content.trim()) {
        setPatientHistoryModalData({ loading: false, logs: [], searchName: '', searchChart: '' });
        setPatientHistoryModalOpen(true);
        return;
      }

      const { shouldFetch, searchName, searchChart } = getPatientHistorySearchTarget(content);

      if (!shouldFetch) {
        setPatientHistoryModalData({ loading: false, logs: [], searchName: '', searchChart: '' });
        setPatientHistoryModalOpen(true);
        return;
      }

      setPatientHistoryModalOpen(true);
      await fetchPatientHistory(searchName, searchChart, {
        selectedKey: key,
        selectedContent: content,
      });
    } catch (e) {
      console.error(e);
      alert(`디버그 에러 발생: ${e.message}`);
    }
  }, [selectedCell, cellKey, editingCell, editInputRef, editValue, memos, pendingDisplayValues, fetchPatientHistory, setPatientHistoryModalOpen, setPatientHistoryModalData]);

  const handleApplyHistoryToCell = useCallback((log) => {
    if (!selectedCell) return;
    const { w, d, r, c } = selectedCell;
    const key = cellKey(w, d, r, c);

    const currentMemo = memos[key] || {};
    const currentPrescriptionSet = buildCurrentPrescriptionSet(settings, currentYear, currentMonth);
    const logPrescription = String(log?.prescription || '').trim();
    const shouldOmitPrescription = !isCurrentConfiguredPrescription(logPrescription, currentPrescriptionSet);
    const cellUpdate = buildPatientHistoryCellUpdate(log, currentMemo, {
      omitPrescription: shouldOmitPrescription,
      omitPrescriptionDoseTag: shouldOmitPrescription,
      resetVisitCount: shouldOmitPrescription,
    });
    const prescriptionScheduleSettings = getPrescriptionScheduleSettings(settings, currentYear, currentMonth);

    const payload = {
      year: currentYear,
      month: currentMonth,
      week_index: w,
      day_index: d,
      row_index: r,
      col_index: c,
      ...cellUpdate,
    };
    const manualTherapyMerge = buildManualTherapyAutoMergePayload({
      key,
      memos,
      currentYear,
      currentMonth,
      rowCount: baseTimeSlotsLength,
      content: cellUpdate.content,
      bgColor: cellUpdate.bg_color || null,
      prescription: cellUpdate.prescription,
      bodyPart: cellUpdate.body_part || null,
      mergeSpan: cellUpdate.merge_span,
      durationMinutesMap: prescriptionScheduleSettings.durationMinutesMap,
      doseTags: prescriptionScheduleSettings.doseTags,
      slotMinutes: settings?.interval_minutes || 10,
    });
    const savePayload = manualTherapyMerge.ok ? manualTherapyMerge.payload : [payload];

    if (manualTherapyMerge.reason === 'occupied') {
      addToast('아래 셀이 비어있지 않아 자동 병합하지 않았습니다.', 'warning');
    } else if (manualTherapyMerge.reason === 'bounds') {
      addToast('아래 시간이 부족해 자동 병합하지 않았습니다.', 'warning');
    }

    setPendingDisplayValues((prev) => {
      const next = { ...prev };
      savePayload.forEach((item) => {
        next[`${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`] = String(item.content ?? '');
      });
      return next;
    });
    applyImmediateCellDisplay?.(savePayload);
    applyImmediateMergeSpan?.(savePayload);

    saveShockwaveMemosBulk(savePayload).then((success) => {
      if (success) {
        clearImmediateCellDisplay?.(savePayload);
        addToast('선택한 내역이 적용되었습니다.', 'success');
      } else {
        addToast('내역 적용에 실패했습니다.', 'error');
      }
    });
  }, [
    selectedCell,
    cellKey,
    currentYear,
    currentMonth,
    settings,
    memos,
    baseTimeSlotsLength,
    saveShockwaveMemosBulk,
    addToast,
    setPendingDisplayValues,
    applyImmediateCellDisplay,
    applyImmediateMergeSpan,
    clearImmediateCellDisplay,
  ]);

  return {
    fetchPatientHistory,
    handleUpdateLogVisitCount,
    handleUpdatePatientHistoryField,
    handleUpdateCurrentCellVisitCount,
    handleUpdateDraftHistoryVisitCount,
    handleOpenPatientHistoryModal,
    handleApplyHistoryToCell,
  };
}
