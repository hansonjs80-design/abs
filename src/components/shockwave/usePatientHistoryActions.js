import { useCallback } from 'react';
import { generateShockwaveCalendar } from '../../lib/calendarUtils';
import { normalizeNameForMatch } from '../../lib/memoParser';
import {
  buildPatientHistoryCellUpdate,
  getPatientHistorySearchTarget,
  patientHistoryIdentityMatches,
} from '../../lib/patientHistoryModalUtils';
import { buildManualTherapyAutoMergePayload } from '../../lib/scheduleManualTherapyAutoMergeUtils';
import { supabase } from '../../lib/supabaseClient';
import { get4060PrescriptionFromContent, has4060Pattern } from '../../lib/schedulerContentFormat';
import {
  applyVisitCountToSchedulerContent,
  getExplicitVisitSuffix,
  parseSchedulerPatientIdentity,
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
  const fetchPatientHistory = useCallback(async (nameParam, chartParam, options = {}) => {
    const activeSelectedKey = String(options?.selectedKey || '');
    const activeSelectedContent = typeof options?.selectedContent === 'string'
      ? options.selectedContent
      : null;
    setPatientHistoryModalData((prev) => ({ ...prev, loading: true, searchName: nameParam, searchChart: chartParam }));
    try {
      const activeManualPrescriptionSet = buildActiveManualPrescriptionSet(settings);
      const shockwaveQuery = supabase.from('shockwave_patient_logs')
        .select('id, patient_name, chart_number, visit_count, date, prescription, body_part')
        .order('date', { ascending: false })
        .limit(500);

      const manualQuery = supabase.from('manual_therapy_patient_logs')
        .select('id, patient_name, chart_number, visit_count, date, prescription, body_part')
        .order('date', { ascending: false })
        .limit(500);

      const scheduleQuery = supabase.from('shockwave_schedules')
        .select('id, year, month, week_index, day_index, content, prescription, body_part')
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

      const allData = [
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

      const scheduleData = scheduleRes.data || [];
      const scheduleOverrides = new Map();

      for (const s of scheduleData) {
        try {
          const calWeeks = generateShockwaveCalendar(s.year, s.month);
          const dayInfo = calWeeks[s.week_index]?.[s.day_index];
          if (!dayInfo) continue;
          const dd = dayInfo.date;
          const dateStr = `${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, '0')}-${String(dd.getDate()).padStart(2, '0')}`;

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
          const schedulePrescription = s.prescription || get4060PrescriptionFromContent(content);
          const historyGroup = getPatientHistoryTreatmentGroup({
            type: 'schedule',
            prescription: schedulePrescription,
            content,
          });

          const scheduleLog = {
            id: s.id,
            date: dateStr,
            patient_name: parsed.patientName || '',
            chart_number: parsed.patientChart || '',
            visit_count: visitCount,
            prescription: schedulePrescription || '',
            body_part: s.body_part || '',
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

      let selectedDate = '';
      const selectedDateLogs = [];
      if (selectedCell) {
        const calWeeks = generateShockwaveCalendar(currentYear, currentMonth, holidays);
        const dayInfo = calWeeks[selectedCell.w]?.[selectedCell.d];
        if (dayInfo) {
          const dd = dayInfo.date;
          selectedDate = `${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, '0')}-${String(dd.getDate()).padStart(2, '0')}`;
          const selectedKey = cellKey(selectedCell.w, selectedCell.d, selectedCell.r, selectedCell.c);

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
              const currentPrescription = memo.prescription || get4060PrescriptionFromContent(content);
              const draftLog = {
                date: selectedDate,
                patient_name: parsed.patientName || nameParam || '',
                chart_number: parsed.patientChart || chartParam || '',
                history_group: getPatientHistoryTreatmentGroup({
                  type: 'draft',
                  prescription: currentPrescription,
                  content,
                }),
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
                visit_count: visitSuffix.replace(/[()]/g, '') || '',
                type: 'draft',
                history_group: draftLog.history_group,
                isCurrentCell: key === selectedKey,
                sort_index: rowIndex * colCount + colIndex,
              });
            }
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
      setPatientHistoryModalData({
        loading: false,
        logs: finalLogs.map(withPatientHistoryRowMeta),
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
    selectedCell,
    memos,
    pendingDisplayValues,
    baseTimeSlotsLength,
    colCount,
    cellKey,
    setPatientHistoryModalData,
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
    const cellUpdate = buildPatientHistoryCellUpdate(log, currentMemo);

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
    handleUpdateCurrentCellVisitCount,
    handleUpdateDraftHistoryVisitCount,
    handleOpenPatientHistoryModal,
    handleApplyHistoryToCell,
  };
}
