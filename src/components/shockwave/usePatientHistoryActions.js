import { useCallback } from 'react';
import { generateShockwaveCalendar } from '../../lib/calendarUtils';
import { normalizeNameForMatch } from '../../lib/memoParser';
import { supabase } from '../../lib/supabaseClient';
import { has4060Pattern } from '../../lib/schedulerContentFormat';
import {
  applyVisitCountToSchedulerContent,
  getExplicitVisitSuffix,
  parseSchedulerPatientIdentity,
} from '../../lib/schedulerUtils';

export default function usePatientHistoryActions({
  currentYear,
  currentMonth,
  holidays,
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
  setPatientHistoryModalOpen,
  setPatientHistoryModalData,
}) {
  const fetchPatientHistory = useCallback(async (nameParam, chartParam) => {
    setPatientHistoryModalData((prev) => ({ ...prev, loading: true, searchName: nameParam, searchChart: chartParam }));
    try {
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
        ...(shockwaveRes.data || []).map((d) => ({ ...d, type: 'shockwave' })),
        ...(manualRes.data || []).map((d) => ({ ...d, type: 'manual' })),
      ];

      const scheduleData = scheduleRes.data || [];
      const seenLogDates = new Set(allData.map((d) => d.date));

      for (const s of scheduleData) {
        try {
          const calWeeks = generateShockwaveCalendar(s.year, s.month);
          const dayInfo = calWeeks[s.week_index]?.[s.day_index];
          if (!dayInfo) continue;
          const dd = dayInfo.date;
          const dateStr = `${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, '0')}-${String(dd.getDate()).padStart(2, '0')}`;

          if (seenLogDates.has(dateStr)) continue;

          const content = s.content || '';
          const parsed = parseSchedulerPatientIdentity(content);
          const matchChart = chartParam && String(parsed.patientChart || '').trim() === chartParam;
          const matchName = nameParam && normalizeNameForMatch(parsed.patientName).includes(nameParam);
          if (chartParam && !matchChart) continue;
          if (!chartParam && !matchName) continue;

          const visitSuffix = getExplicitVisitSuffix(content);
          const visitCount = visitSuffix.replace(/[()]/g, '') || '';

          allData.push({
            id: s.id,
            date: dateStr,
            patient_name: parsed.patientName || '',
            chart_number: parsed.patientChart || '',
            visit_count: visitCount,
            prescription: s.prescription || '',
            body_part: s.body_part || '',
            type: 'schedule',
          });
          seenLogDates.add(dateStr);
        } catch {
          // Ignore malformed schedule rows.
        }
      }

      const matches = allData.filter((item) => {
        const matchChart = chartParam && String(item.chart_number || '').trim() === chartParam;
        const matchName = nameParam && normalizeNameForMatch(item.patient_name).includes(nameParam);
        if (chartParam) return matchChart;
        return matchName;
      });

      matches.sort((a, b) => {
        if (a.date !== b.date) return b.date.localeCompare(a.date);
        return (parseInt(b.visit_count || '0', 10) || 0) - (parseInt(a.visit_count || '0', 10) || 0);
      });

      let draftLog = null;
      if (selectedCell) {
        const calWeeks = generateShockwaveCalendar(currentYear, currentMonth, holidays);
        const dayInfo = calWeeks[selectedCell.w]?.[selectedCell.d];
        if (dayInfo) {
          const dd = dayInfo.date;
          const cellDate = `${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, '0')}-${String(dd.getDate()).padStart(2, '0')}`;

          const cellKeyValue = `${selectedCell.w}-${selectedCell.d}-${selectedCell.r}-${selectedCell.c}`;
          const cellMemo = memos[cellKeyValue] || {};
          const cellContent = cellMemo.content || pendingDisplayValues[cellKeyValue] || '';
          const visitSuffix = getExplicitVisitSuffix(cellContent);
          const cellVisitCount = visitSuffix.replace(/[()]/g, '') || '';

          draftLog = {
            id: 'draft',
            date: cellDate,
            patient_name: nameParam || '',
            chart_number: chartParam || '',
            prescription: cellMemo.prescription || '',
            body_part: cellMemo.body_part || '',
            visit_count: cellVisitCount,
            type: 'draft',
          };
        }
      }

      let finalLogs = matches;
      if (draftLog) {
        const existingIdx = matches.findIndex((m) => m.date === draftLog.date);
        if (existingIdx !== -1) {
          finalLogs = [...matches];
          finalLogs[existingIdx] = { ...finalLogs[existingIdx], isCurrentCell: true };
        } else {
          draftLog.isCurrentCell = true;
          finalLogs = [draftLog, ...matches];
        }
      }
      setPatientHistoryModalData({ loading: false, logs: finalLogs, searchName: nameParam, searchChart: chartParam });
    } catch (e) {
      console.error(e);
      alert(`디버그 에러 발생: ${e.message}`);
      setPatientHistoryModalData((prev) => ({ ...prev, loading: false }));
    }
  }, [currentYear, currentMonth, holidays, selectedCell, memos, pendingDisplayValues, setPatientHistoryModalData]);

  const handleUpdateLogVisitCount = useCallback(async (log, newValue) => {
    if (log.id === 'draft') return;

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

      addToast('해당 날짜의 회차가 수정되었습니다.', 'success');

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

      if (targetW !== -1 && targetD !== -1) {
        for (let r = 0; r < baseTimeSlotsLength; r++) {
          for (let c = 0; c < colCount; c++) {
            const key = cellKey(targetW, targetD, r, c);
            const memo = memos[key];
            if (memo && memo.content) {
              const parsed = parseSchedulerPatientIdentity(memo.content);
              const matchChart = log.chart_number && parsed.patientChart && String(parsed.patientChart).trim() === String(log.chart_number).trim();
              const matchName = log.patient_name && normalizeNameForMatch(parsed.patientName) === normalizeNameForMatch(log.patient_name);

              if (matchChart || matchName) {
                const updatedContent = applyVisitCountToSchedulerContent(memo.content, newValue);
                if (updatedContent !== memo.content) {
                  setPendingDisplayValues((prev) => ({ ...prev, [key]: updatedContent }));
                  await saveShockwaveMemosBulk([{
                    year: currentYear,
                    month: currentMonth,
                    week_index: targetW,
                    day_index: targetD,
                    row_index: r,
                    col_index: c,
                    content: updatedContent,
                    bg_color: memo.bg_color || null,
                    prescription: memo.prescription || null,
                    body_part: memo.body_part || null,
                    merge_span: memo.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null },
                  }]);
                }
              }
            }
          }
        }
      }
    } catch (e) {
      console.error(e);
      addToast('회차 수정 실패', 'error');
    }
  }, [addToast, currentYear, currentMonth, holidays, memos, baseTimeSlotsLength, colCount, saveShockwaveMemosBulk, cellKey, setPendingDisplayValues]);

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
        : (memos[key]?.content || pendingDisplayValues[key] || '');

      if (!content.trim()) {
        alert(`디버그: 이름이나 차트번호가 비어있습니다. (${content})`);
        return;
      }

      const parsed = parseSchedulerPatientIdentity(content);
      const searchName = normalizeNameForMatch(parsed.patientName);
      const searchChart = parsed.patientChart ? String(parsed.patientChart).trim() : null;

      if (!searchName && !searchChart) {
        alert(`디버그: 이름/차트번호를 파악할 수 없습니다: ${content}`);
        return;
      }

      setPatientHistoryModalOpen(true);
      await fetchPatientHistory(searchName, searchChart);
    } catch (e) {
      console.error(e);
      alert(`디버그 에러 발생: ${e.message}`);
    }
  }, [selectedCell, cellKey, editingCell, editInputRef, editValue, memos, pendingDisplayValues, fetchPatientHistory, setPatientHistoryModalOpen]);

  const handleApplyHistoryToCell = useCallback((log) => {
    if (!selectedCell) return;
    const { w, d, r, c } = selectedCell;
    const key = cellKey(w, d, r, c);

    const chart = String(log.chart_number || '').trim();
    const name = String(log.patient_name || '').replace(/\*/g, '').trim();
    const bodyPart = String(log.body_part || '').trim();
    const prescription = String(log.prescription || '').trim();
    const visitCount = parseInt(log.visit_count || '0', 10) || 0;

    let newContent = name;

    if (log.type === 'manual') {
      const doseMatch = String(prescription).match(/(40|60)/);
      if (doseMatch && !has4060Pattern(newContent)) {
        newContent = `${newContent}${doseMatch[0]}`;
      }
    }

    if (chart) {
      newContent = `${chart}/${newContent}`;
    }

    if (visitCount > 0) {
      newContent = `${newContent}(${visitCount})`;
    }

    const currentMemo = memos[key] || {};

    const payload = {
      year: currentYear,
      month: currentMonth,
      week_index: w,
      day_index: d,
      row_index: r,
      col_index: c,
      content: newContent,
      bg_color: currentMemo.bg_color || null,
      prescription: prescription || null,
      body_part: bodyPart || null,
      merge_span: currentMemo.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null },
    };

    setPendingDisplayValues((prev) => ({ ...prev, [key]: newContent }));

    saveShockwaveMemosBulk([payload]).then((success) => {
      if (success) {
        addToast('선택한 내역이 적용되었습니다.', 'success');
      } else {
        addToast('내역 적용에 실패했습니다.', 'error');
      }
      setPatientHistoryModalOpen(false);
    });
  }, [selectedCell, cellKey, currentYear, currentMonth, memos, saveShockwaveMemosBulk, addToast, setPendingDisplayValues, setPatientHistoryModalOpen]);

  return {
    fetchPatientHistory,
    handleUpdateLogVisitCount,
    handleOpenPatientHistoryModal,
    handleApplyHistoryToCell,
  };
}
