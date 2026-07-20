import { supabase } from './supabaseClient.js';
import { generateShockwaveCalendar, getTodayKST } from './calendarUtils.js';
import { has4060Pattern, get4060PrescriptionFromContent } from './schedulerContentFormat.js';
import { TREATMENT_COMPLETE_BG } from './schedulerUtils.js';
import { getShockwaveScheduleBaseRowCount } from './scheduleHiddenCellRelocationUtils.js';
import {
  getPastLogsForPatient,
  normalizeHistoryPatientName,
  sortPastLogsLatestFirst,
} from './patientHistoryMatchUtils.js';
import {
  buildScheduleStatsSyncMutation,
  fetchStatsRowsForDateRange,
  getStatsMonthDateRange,
  replaceStatsRowsForDateRange,
  shouldOverwriteExistingStatsForScheduleSync,
} from './scheduleStatsSyncUtils.js';
export {
  ABBREV_MAP,
  ALWAYS_UPPER,
  normalizeBodyShortcutKey,
  toProperCase,
} from './bodyPartFormatUtils.js';

/** 처방명 비교용 정규화 – 띄어쓰기·슬래시·대소문자 무시 */
function normalizePrescriptionKeySync(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

let todaySchedulerSyncQueue = Promise.resolve();

function buildSchedulerCellKey(year, month, weekIndex, dayIndex, rowIndex, colIndex) {
  return [
    year,
    String(month).padStart(2, '0'),
    weekIndex,
    dayIndex,
    rowIndex,
    colIndex,
  ].join(':');
}

function parseScheduleMemoKey(key) {
  const [weekIndex, dayIndex, rowIndex, colIndex] = String(key || '').split('-').map(Number);
  return { weekIndex, dayIndex, rowIndex, colIndex };
}

function normalizeScheduleMergeSpanForStats(mergeSpan = {}) {
  const base = mergeSpan && typeof mergeSpan === 'object' ? mergeSpan : {};
  return {
    rowSpan: Math.max(1, Number(base.rowSpan) || 1),
    colSpan: Math.max(1, Number(base.colSpan) || 1),
    mergedInto: base.mergedInto || null,
  };
}

function getStatsTherapistColumnCount(therapists = [], monthlyTherapists = []) {
  const therapistCount = Array.isArray(therapists) ? therapists.length : 0;
  const monthlySlotCount = (Array.isArray(monthlyTherapists) ? monthlyTherapists : []).reduce(
    (max, item) => Math.max(max, (Number(item?.slot_index) || 0) + 1),
    0
  );
  return Math.max(1, therapistCount, monthlySlotCount);
}

function isScheduleMemoKeyInRenderedBounds(key, { rowCount, colCount } = {}) {
  const { weekIndex, dayIndex, rowIndex, colIndex } = parseScheduleMemoKey(key);
  if (![weekIndex, dayIndex, rowIndex, colIndex].every(Number.isFinite)) return false;
  if (weekIndex < 0 || dayIndex < 0 || rowIndex < 0 || colIndex < 0) return false;
  if (Number.isFinite(Number(rowCount)) && rowIndex >= Number(rowCount)) return false;
  if (Number.isFinite(Number(colCount)) && colIndex >= Number(colCount)) return false;
  return true;
}

export function getVisibleShockwaveScheduleMemoEntriesForStats(memos = {}, options = {}) {
  const entries = Object.entries(memos || {});
  const coveredKeys = new Set();

  entries.forEach(([key, cell]) => {
    const mergeSpan = normalizeScheduleMergeSpanForStats(cell?.merge_span);
    if (mergeSpan.mergedInto || (mergeSpan.rowSpan <= 1 && mergeSpan.colSpan <= 1)) return;

    const { weekIndex, dayIndex, rowIndex, colIndex } = parseScheduleMemoKey(key);
    if (![weekIndex, dayIndex, rowIndex, colIndex].every(Number.isFinite)) return;

    for (let row = rowIndex; row < rowIndex + mergeSpan.rowSpan; row += 1) {
      for (let col = colIndex; col < colIndex + mergeSpan.colSpan; col += 1) {
        const coveredKey = `${weekIndex}-${dayIndex}-${row}-${col}`;
        if (coveredKey !== key) coveredKeys.add(coveredKey);
      }
    }
  });

  return entries.filter(([key, cell]) => {
    if (!isScheduleMemoKeyInRenderedBounds(key, options)) return false;
    const mergeSpan = normalizeScheduleMergeSpanForStats(cell?.merge_span);
    return !mergeSpan.mergedInto && !coveredKeys.has(key);
  });
}

function isMissingSchedulerCellKeyError(error) {
  const message = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`;
  return (
    error?.code === '42703' ||
    /scheduler_cell_key.{0,80}(column|field|does not exist|not found|missing)/i.test(message) ||
    /(column|field|does not exist|not found|missing).{0,80}scheduler_cell_key/i.test(message)
  );
}

function isSchedulerCellKeyUpsertUnsupportedError(error) {
  const message = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`;
  return (
    isMissingSchedulerCellKeyError(error) ||
    error?.code === '42P10' ||
    /no unique|exclusion constraint|on conflict/i.test(message)
  );
}

function omitSchedulerCellKey(row) {
  const { scheduler_cell_key: _scheduler_cell_key, ...rest } = row;
  return rest;
}

// 추출 로직 (기존 앱스스크립트 parseNameChart_ 및 관련 정규표현식 이식)
export function parseTherapyInfo(rawContent) {
  if (!rawContent || typeof rawContent !== 'string') return null;
  const s = rawContent.trim();
  if (!s) return null;

  // 특수문구 거름망
  if (/^(휴무|연차|반차|출근|퇴근|근무|야간|오전|오후|처방|건수|총건수|합계|결산|주차)$/.test(s)) return null;
  // 시간포맷 필터 (예: 12:30)
  if (/^\d{1,2}:\d{2}$/.test(s)) return null;

  let chart = "";
  let name = s;
  let visit = "";

  if (s.includes('/')) {
    const parts = s.split('/');
    const p0 = parts[0].trim();
    const p1 = parts[1]?.trim() || '';

    // If p0 has numbers and p1 has letters, it's Chart/Name (User described: 챠트번호/이름)
    if (/\d/.test(p0) && /[^\d*()]/.test(p1)) {
       chart = p0;
       name = p1;
    } 
    // If p0 has letters and p1 has numbers, it's Name/Chart
    else if (/[^\d*()]/.test(p0) && /\d/.test(p1)) {
       name = p0;
       chart = p1;
    } else {
       chart = p0;
       name = p1;
    }
  }

  // 도수치료 표기(이름40/이름60)는 충격파 통계에서 제외
  if (has4060Pattern(s) || has4060Pattern(name)) return null;

  // Extract visit count: name(visit) or name*
  const visitMatch = name.match(/\((\d+)₩?\)$/);
  if (visitMatch) {
    visit = visitMatch[1];
    name = name.replace(/\(\d+₩?\)$/, '').trim();
  } else if (/\(-\)$/.test(name)) {
    visit = "-";
    name = name.replace(/\(-\)$/, '').trim();
  } else if (name.endsWith('*')) {
    visit = "1";
    // 별표는 1회차 시각적 표시이므로 이름에 남겨둠
  }

  name = name.trim();
  if (!name || /^\d+$/.test(name.replace(/\*/g, ''))) return null;

  // 한글 이름 뒤에 붙은 도수 태그(영문/숫자 조합) 제거 (예: 박병수DC -> 박병수)
  name = name.replace(/([가-힣]{2,})([a-zA-Z\d]+)$/, '$1').trim();

  return {
    patient_name: name,
    chart_number: chart,
    visit_count: visit, 
    body_part: "", // To be auto-filled by sync logic
    original: s
  };
}

export function shouldUseExistingShockwaveSchedulerLogForCopy(row) {
  return row?.source === 'scheduler' || Boolean(String(row?.scheduler_cell_key || '').trim());
}

export function resolveShockwaveSchedulePrescriptionCount({ prescription, fallbackPrescription } = {}) {
  return prescription || fallbackPrescription ? 1 : '';
}

function buildSchedulerRowPlacement(items, existingRows) {
  const parsedExistingRows = (existingRows || [])
    .map((row) => {
      const parsed = parseTherapyInfo(row?.content);
      return {
        rowIndex: Number(row?.row_index),
        content: String(row?.content || '').trim(),
        cleanName: parsed?.patient_name?.replace(/\*/g, '').trim() || '',
      };
    })
    .filter((row) => Number.isInteger(row.rowIndex))
    .sort((a, b) => a.rowIndex - b.rowIndex);

  const usedRowIndexes = new Set();
  const lastAssignedRowByName = new Map();
  const existingRowsByContent = new Map();
  const existingRowsByName = new Map();

  parsedExistingRows.forEach((row) => {
    if (row.content) {
      const contentRows = existingRowsByContent.get(row.content) || [];
      contentRows.push(row.rowIndex);
      existingRowsByContent.set(row.content, contentRows);
    }
    if (row.cleanName) {
      const nameRows = existingRowsByName.get(row.cleanName) || [];
      nameRows.push(row.rowIndex);
      existingRowsByName.set(row.cleanName, nameRows);
    }
  });

  const takeMatchingExistingRow = (matcher) => {
    const matchedRow = parsedExistingRows.find(
      (row) => !usedRowIndexes.has(row.rowIndex) && matcher(row)
    );
    if (!matchedRow) return null;
    usedRowIndexes.add(matchedRow.rowIndex);
    return matchedRow.rowIndex;
  };

  const findNextAvailableRow = (startRow) => {
    let candidate = Math.max(0, Number.isInteger(startRow) ? startRow : 0);
    while (
      usedRowIndexes.has(candidate) ||
      parsedExistingRows.some((row) => row.rowIndex === candidate && row.content)
    ) {
      candidate += 1;
    }
    usedRowIndexes.add(candidate);
    return candidate;
  };

  return items.map((item, itemIndex) => {
    const content = String(item?.content || '').trim();
    const cleanName = String(item?.cleanName || '').trim();

    let rowIndex =
      takeMatchingExistingRow((row) => content && row.content === content) ??
      takeMatchingExistingRow((row) => cleanName && row.cleanName === cleanName);

    if (!Number.isInteger(rowIndex) && cleanName && lastAssignedRowByName.has(cleanName)) {
      rowIndex = findNextAvailableRow(lastAssignedRowByName.get(cleanName) + 1);
    }

    if (!Number.isInteger(rowIndex) && cleanName) {
      const existingNameRows = existingRowsByName.get(cleanName) || [];
      const anchorRow = existingNameRows.length > 0
        ? Math.max(...existingNameRows)
        : itemIndex;
      rowIndex = findNextAvailableRow(anchorRow);
    }

    if (!Number.isInteger(rowIndex)) {
      rowIndex = findNextAvailableRow(itemIndex);
    }

    if (cleanName) lastAssignedRowByName.set(cleanName, rowIndex);

    return {
      ...item,
      rowIndex,
    };
  });
}

// 월별 치료사 설정에서 날짜별 치료사 이름 조회
function resolveTherapistName(slotIndex, day, therapists, monthlyTherapists) {
  if (monthlyTherapists && monthlyTherapists.length > 0) {
    const match = monthlyTherapists.find(
      (t) => t.slot_index === slotIndex && day >= t.start_day && day <= t.end_day
    );
    if (match !== undefined) return match.therapist_name || '';
  }
  return therapists?.[slotIndex]?.name || `치료사 ${slotIndex + 1}`;
}

async function runTodayShockwaveScheduleToStatsSync({
  year,
  month,
  memos,
  therapists,
  monthlyTherapists,
  settings = {},
  targetDateStr,
  overwriteManual = false,
  scheduleAuthoritative = true,
  pastDataCache = null,
  existingMonthStats = null,
  collectOnly = false,
  copyExistingTreatmentDetails = true,
}) {
  if (!memos) {
    return { skipped: true, reason: 'missing_memos' };
  }

  const today = getTodayKST();
  const todayY = targetDateStr ? parseInt(targetDateStr.split('-')[0], 10) : today.getFullYear();
  const todayM = targetDateStr ? parseInt(targetDateStr.split('-')[1], 10) : today.getMonth() + 1;
  const todayD = targetDateStr ? parseInt(targetDateStr.split('-')[2], 10) : today.getDate();
  const todayDateStrFinal = targetDateStr || `${todayY}-${String(todayM).padStart(2, '0')}-${String(todayD).padStart(2, '0')}`;
  const renderedRowCount = getShockwaveScheduleBaseRowCount(settings, year, month);
  const renderedColCount = getStatsTherapistColumnCount(therapists, monthlyTherapists);
  const effectiveOverwriteManual = shouldOverwriteExistingStatsForScheduleSync({
    year: todayY,
    month: todayM,
    overwriteManual,
    scheduleAuthoritative,
    today,
  });

  if (!targetDateStr && (todayY !== year || todayM !== month)) {
    return { skipped: true, reason: 'today_outside_current_month', todayDateStr: todayDateStrFinal };
  }

  const weeks = generateShockwaveCalendar(year, month);
  const newLogs = [];

  // 방문 완료(bg_color === TREATMENT_COMPLETE_BG)된 셀만 통계에 포함
  getVisibleShockwaveScheduleMemoEntriesForStats(memos, {
    rowCount: renderedRowCount,
    colCount: renderedColCount,
  }).forEach(([key, cell]) => {
    const [w, d, r, c] = key.split('-').map(Number);
    const dayInfo = weeks[w]?.[d];
    if (!dayInfo || !dayInfo.isCurrentMonth) return;
    if (dayInfo.year !== todayY || dayInfo.month !== todayM || dayInfo.day !== todayD) return;

    // 방문 완료된 셀만 통계에 포함
    if (String(cell?.bg_color || '').toLowerCase() !== TREATMENT_COMPLETE_BG.toLowerCase()) return;

    const parsed = parseTherapyInfo(cell?.content);
    if (!parsed) return;

    const therapistName = resolveTherapistName(c, dayInfo.day, therapists, monthlyTherapists);
    newLogs.push({
      r,
      c,
      scheduler_cell_key: buildSchedulerCellKey(year, month, w, d, r, c),
      date: todayDateStrFinal,
      patient_name: parsed.patient_name,
      chart_number: parsed.chart_number || '',
      visit_count: parsed.visit_count || '',
      body_part: cell?.body_part || parsed.body_part || '',
      therapist_name: therapistName,
      prescription: cell?.prescription || get4060PrescriptionFromContent(cell?.content) || '',
      prescription_count: (cell?.prescription || get4060PrescriptionFromContent(cell?.content)) ? 1 : null,
    });
  });

  newLogs.sort((a, b) => {
    if (a.r !== b.r) return a.r - b.r;
    return a.c - b.c;
  });

  const cleanNamesSet = new Set(newLogs.map((l) => normalizeHistoryPatientName(l.patient_name)));
  const queryNames = [];
  const chartNumbers = [];
  cleanNamesSet.forEach((name) => {
    queryNames.push(name);
    queryNames.push(`${name}*`);
  });
  newLogs.forEach((item) => {
    if (item.chart_number) chartNumbers.push(String(item.chart_number).trim());
  });

  let pastData = [];
  if (pastDataCache) {
    const queryNameSet = new Set(queryNames);
    const chartNumberSet = new Set(chartNumbers);
    if (queryNameSet.size > 0 || chartNumberSet.size > 0) {
      pastData = pastDataCache.filter((row) => {
        const normalizedName = normalizeHistoryPatientName(row?.patient_name);
        const chartNumber = String(row?.chart_number || '').trim();
        return (
          (normalizedName && queryNameSet.has(normalizedName)) ||
          (chartNumber && chartNumberSet.has(chartNumber))
        );
      });
    }
  } else if (queryNames.length > 0 || chartNumbers.length > 0) {
    const queries = [];
    if (queryNames.length > 0) {
      queries.push(
        supabase
          .from('shockwave_patient_logs')
          .select('patient_name, chart_number, visit_count, body_part, date')
          .in('patient_name', queryNames)
          .order('date', { ascending: false })
      );
    }
    if (chartNumbers.length > 0) {
      queries.push(
        supabase
          .from('shockwave_patient_logs')
          .select('patient_name, chart_number, visit_count, body_part, date')
          .in('chart_number', Array.from(new Set(chartNumbers)))
          .order('date', { ascending: false })
      );
    }

    const results = await Promise.all(queries);
    const seen = new Set();
    pastData = results.flatMap((result) => result.data || []).filter((row) => {
      const key = `${row.date}|${row.chart_number}|${row.patient_name}|${row.visit_count}|${row.body_part}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  newLogs.forEach((item) => {
    const patientLogs = getPastLogsForPatient(item, pastData, todayDateStrFinal);

    if (patientLogs.length > 0) {
      const lastLog = sortPastLogsLatestFirst(patientLogs)[0];
      if (!item.chart_number) item.chart_number = lastLog.chart_number || '';
      if (!item.body_part) item.body_part = lastLog.body_part || '';
      if (!item.visit_count) {
        const lastVisit = parseInt(lastLog.visit_count || '0', 10);
        item.visit_count = lastVisit > 0 ? String(lastVisit + 1) : '1';
      }
    } else if (!item.visit_count) {
      item.visit_count = '1';
    }
  });

  let todayStats = [];
  if (Array.isArray(existingMonthStats)) {
    todayStats = existingMonthStats.filter((row) => row.date === todayDateStrFinal);
  } else {
    const { data } = await supabase
      .from('shockwave_patient_logs')
      .select('*')
      .eq('date', todayDateStrFinal);
    todayStats = data || [];
  }

  const schedulerEntriesForCopying = copyExistingTreatmentDetails
    ? todayStats.filter(shouldUseExistingShockwaveSchedulerLogForCopy)
    : [];
  const existingByCellKey = new Map();
  const existingGroups = {};
  schedulerEntriesForCopying.forEach((row) => {
    if (row.scheduler_cell_key) existingByCellKey.set(row.scheduler_cell_key, row);
    const key = (row.patient_name || '').replace(/\*/g, '');
    if (!existingGroups[key]) existingGroups[key] = [];
    existingGroups[key].push(row);
  });

  const rebuiltSchedulerRows = [];

  newLogs.forEach((item) => {
    const key = normalizeHistoryPatientName(item.patient_name);
    const old = copyExistingTreatmentDetails
      ? existingByCellKey.get(item.scheduler_cell_key) || existingGroups[key]?.shift() || null
      : null;

    const out = {
      scheduler_cell_key: item.scheduler_cell_key,
      date: item.date,
      patient_name: item.patient_name,
      chart_number: item.chart_number,
      visit_count: item.visit_count,
      body_part: item.body_part,
      therapist_name: item.therapist_name,
      prescription: item.prescription || old?.prescription || '',
      prescription_count: resolveShockwaveSchedulePrescriptionCount({
        prescription: item.prescription,
        fallbackPrescription: old?.prescription,
      }),
      source: 'scheduler',
    };

    rebuiltSchedulerRows.push(out);
  });

  const { toDeleteIds, rowsToUpsert } = buildScheduleStatsSyncMutation({
    existingRows: todayStats,
    rebuiltRows: rebuiltSchedulerRows,
    overwriteExistingStats: effectiveOverwriteManual,
    isSameRow: (existing, newRow) => (
      existing.patient_name === newRow.patient_name &&
      String(existing.chart_number || '') === String(newRow.chart_number || '') &&
      String(existing.visit_count || '') === String(newRow.visit_count || '') &&
      String(existing.body_part || '') === String(newRow.body_part || '') &&
      existing.therapist_name === newRow.therapist_name &&
      normalizePrescriptionKeySync(existing.prescription) === normalizePrescriptionKeySync(newRow.prescription) &&
      Number(existing.prescription_count || 1) === Number(newRow.prescription_count || 1)
    ),
  });

  if (collectOnly) {
    return {
      skipped: false,
      todayDateStr: todayDateStrFinal,
      extractedCount: newLogs.length,
      insertedCount: rowsToUpsert.length,
      updatedCount: 0,
      deletedCount: toDeleteIds.length,
      totalUpdates: rowsToUpsert.length + toDeleteIds.length,
      toDeleteIds,
      rowsToUpsert,
      rebuiltRows: rebuiltSchedulerRows,
      todayStats,
    };
  }

  if (toDeleteIds.length > 0) {
    const { error: deleteError } = await supabase.from('shockwave_patient_logs').delete().in('id', toDeleteIds);
    if (deleteError) throw deleteError;
  }
  
  if (rowsToUpsert.length > 0) {
    const { error: upsertError } = await supabase
      .from('shockwave_patient_logs')
      .upsert(rowsToUpsert, { onConflict: 'scheduler_cell_key' });

    if (upsertError) {
      if (!isSchedulerCellKeyUpsertUnsupportedError(upsertError)) throw upsertError;
      const fallbackRows = isMissingSchedulerCellKeyError(upsertError)
        ? rowsToUpsert.map(omitSchedulerCellKey)
        : rowsToUpsert;
      const fallbackDeleteIds = (todayStats || [])
        .filter((row) => effectiveOverwriteManual ? true : row.source !== 'manual')
        .map((row) => row.id)
        .filter(Boolean);
      if (fallbackDeleteIds.length > 0) {
        const { error: fallbackDeleteError } = await supabase.from('shockwave_patient_logs').delete().in('id', fallbackDeleteIds);
        if (fallbackDeleteError) throw fallbackDeleteError;
      }
      const { error: fallbackInsertError } = await supabase.from('shockwave_patient_logs').insert(fallbackRows);
      if (fallbackInsertError) throw fallbackInsertError;
    }
  }

  return {
    skipped: false,
    todayDateStr: todayDateStrFinal,
    extractedCount: newLogs.length,
    insertedCount: rowsToUpsert.length,
    updatedCount: 0,
    deletedCount: toDeleteIds.length,
    totalUpdates: rowsToUpsert.length + toDeleteIds.length,
  };
}

export async function syncTodayShockwaveScheduleToStats(params) {
  const run = todaySchedulerSyncQueue.then(async () => {
    const res = await runTodayShockwaveScheduleToStatsSync(params);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('clinic-stats-updated'));
    }
    return res;
  });
  todaySchedulerSyncQueue = run.catch(() => {});
  return run;
}

export async function syncMonthShockwaveScheduleToStats({
  year,
  month,
  memos,
  therapists,
  monthlyTherapists,
  settings = {},
  upToToday = false,
  overwriteManual = false,
  scheduleAuthoritative = true,
  emitEvent = true,
  replaceExistingMonthLogs = false,
}) {
  const today = getTodayKST();
  const effectiveOverwriteManual = shouldOverwriteExistingStatsForScheduleSync({
    year,
    month,
    overwriteManual,
    scheduleAuthoritative,
    today,
  });
  const daysInMonth = new Date(year, month, 0).getDate();
  let endDay = daysInMonth;
  
  if (upToToday && year === today.getFullYear() && month === today.getMonth() + 1) {
    endDay = today.getDate();
  }

  const { startDate: startOfMonthStr, endDate: endOfMonthStr } = getStatsMonthDateRange(year, month);

  if (replaceExistingMonthLogs) {
    const weeks = generateShockwaveCalendar(year, month);
    const patientNamesSet = new Set();
    const chartNumbersSet = new Set();

    const renderedRowCount = getShockwaveScheduleBaseRowCount(settings, year, month);
    const renderedColCount = getStatsTherapistColumnCount(therapists, monthlyTherapists);

    getVisibleShockwaveScheduleMemoEntriesForStats(memos, {
      rowCount: renderedRowCount,
      colCount: renderedColCount,
    }).forEach(([key, cell]) => {
      const [w, d] = key.split('-').map(Number);
      const dayInfo = weeks[w]?.[d];
      if (!dayInfo || !dayInfo.isCurrentMonth) return;
      if (upToToday && year === today.getFullYear() && month === today.getMonth() + 1) {
        if (dayInfo.day > today.getDate()) return;
      }
      if (String(cell?.bg_color || '').toLowerCase() !== TREATMENT_COMPLETE_BG.toLowerCase()) return;

      const parsed = parseTherapyInfo(cell?.content);
      if (!parsed) return;

      const cleanName = normalizeHistoryPatientName(parsed.patient_name);
      if (cleanName) {
        patientNamesSet.add(cleanName);
        patientNamesSet.add(`${cleanName}*`);
      }
      if (parsed.chart_number) chartNumbersSet.add(String(parsed.chart_number).trim());
    });

    const historyQueries = [];
    const patientNames = Array.from(patientNamesSet);
    const chartNumbers = Array.from(chartNumbersSet);
    if (patientNames.length > 0) {
      historyQueries.push(
        supabase
          .from('shockwave_patient_logs')
          .select('patient_name, chart_number, visit_count, body_part, date')
          .in('patient_name', patientNames)
          .lt('date', startOfMonthStr)
          .order('date', { ascending: false })
      );
    }
    if (chartNumbers.length > 0) {
      historyQueries.push(
        supabase
          .from('shockwave_patient_logs')
          .select('patient_name, chart_number, visit_count, body_part, date')
          .in('chart_number', chartNumbers)
          .lt('date', startOfMonthStr)
          .order('date', { ascending: false })
      );
    }

    const historyResults = await Promise.all(historyQueries);
    const historyError = historyResults.find((result) => result.error)?.error;
    if (historyError) throw historyError;

    const seenHistoryRows = new Set();
    const rollingPastData = historyResults.flatMap((result) => result.data || []).filter((row) => {
      const key = `${row.date}|${row.chart_number}|${row.patient_name}|${row.visit_count}|${row.body_part}`;
      if (seenHistoryRows.has(key)) return false;
      seenHistoryRows.add(key);
      return true;
    });

    const existingMonthStats = await fetchStatsRowsForDateRange({
      supabaseClient: supabase,
      tableName: 'shockwave_patient_logs',
      startDate: startOfMonthStr,
      endDate: endOfMonthStr,
    });

    const rebuiltRowsForMonth = [];
    const dateErrors = [];

    for (let d = 1; d <= endDay; d++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      try {
        const result = await runTodayShockwaveScheduleToStatsSync({
          year,
          month,
          memos,
          therapists,
          monthlyTherapists,
          settings,
          targetDateStr: dateStr,
          overwriteManual: effectiveOverwriteManual,
          scheduleAuthoritative: false,
          pastDataCache: rollingPastData,
          existingMonthStats,
          collectOnly: true,
          copyExistingTreatmentDetails: false,
        });

        if (!result.skipped) {
          const rebuiltRows = Array.isArray(result.rebuiltRows) ? result.rebuiltRows : [];
          rebuiltRowsForMonth.push(...rebuiltRows);
          rollingPastData.push(...rebuiltRows);
        }
      } catch (error) {
        dateErrors.push(`${dateStr}: ${error?.message || error}`);
      }
    }

    if (dateErrors.length > 0) {
      throw new Error(`충격파 월 통계 재계산 실패: ${dateErrors.join(', ')}`);
    }

    const deletedCount = effectiveOverwriteManual
      ? existingMonthStats.length
      : existingMonthStats.filter((row) => row?.source !== 'manual').length;
    const { inserted } = await replaceStatsRowsForDateRange({
      supabaseClient: supabase,
      tableName: 'shockwave_patient_logs',
      startDate: startOfMonthStr,
      endDate: endOfMonthStr,
      rows: rebuiltRowsForMonth,
      preserveManualSource: !effectiveOverwriteManual,
      isFallbackInsertError: isMissingSchedulerCellKeyError,
      mapFallbackRow: omitSchedulerCellKey,
    });

    if (emitEvent && typeof window !== 'undefined') {
      window.dispatchEvent(new Event('clinic-stats-updated'));
    }

    return {
      totalInserted: inserted,
      totalDeleted: deletedCount,
      totalUpdated: 0,
      totalUpdates: inserted + deletedCount,
      rebuiltRows: rebuiltRowsForMonth,
    };
  }

  let totalInserted = 0;
  let totalDeleted = 0;
  let totalUpdated = 0;

  for (let d = 1; d <= endDay; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    try {
      const result = await runTodayShockwaveScheduleToStatsSync({
        year,
        month,
        memos,
        therapists,
        monthlyTherapists,
        settings,
        targetDateStr: dateStr,
        overwriteManual: effectiveOverwriteManual,
        scheduleAuthoritative: false
      });
      if (!result.skipped) {
        totalInserted += result.insertedCount || 0;
        totalDeleted += result.deletedCount || 0;
        totalUpdated += result.updatedCount || 0;
      }
    } catch (e) {
      console.error(`Failed to sync shockwave schedule for ${dateStr}:`, e);
    }
  }

  // If we only synced up to today, delete any future scheduler records for this month
  if (upToToday && year === today.getFullYear() && month === today.getMonth() + 1) {
    const todayDateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    try {
      let query = supabase
        .from('shockwave_patient_logs')
        .delete()
        .gt('date', todayDateStr)
        .lte('date', endOfMonthStr);
      if (!effectiveOverwriteManual) {
        query = query.neq('source', 'manual');
      }
      const { error } = await query;
        
      if (error) console.error('Failed to cleanup future dates:', error);
    } catch (e) {
      console.error(e);
    }
  }

  if (emitEvent && typeof window !== 'undefined') {
    window.dispatchEvent(new Event('clinic-stats-updated'));
  }

  return { totalInserted, totalDeleted, totalUpdated, totalUpdates: totalInserted + totalDeleted + totalUpdated };
}

export function formatStatsRowForScheduler(row) {
  const patientName = String(row?.patient_name || '').trim();
  if (!patientName) return '';

  const cleanName = patientName.replace(/\*/g, '').trim();
  const chartNumber = String(row?.chart_number || '').trim();
  const visitCount = String(row?.visit_count || '').trim();
  const hasStar = patientName.includes('*');

  let suffix = '';
  if (visitCount === '-') suffix = '(-)';
  else if (hasStar && (!visitCount || visitCount === '1' || visitCount === '*')) suffix = '*';
  else if (visitCount) suffix = `(${visitCount})`;
  else if (hasStar) suffix = '*';

  const nameText = `${cleanName}${suffix}`;
  return chartNumber ? `${chartNumber}/${nameText}` : nameText;
}

export async function syncStatsDateToScheduler({ year, month, date, therapists }) {
  if (!date || !Array.isArray(therapists) || therapists.length === 0) {
    return { skipped: true, reason: 'missing_input' };
  }

  const weeks = generateShockwaveCalendar(year, month);
  let targetWeekIndex = -1;
  let targetDayIndex = -1;

  weeks.forEach((week, wIdx) => {
    week.forEach((dayInfo, dIdx) => {
      const key = `${dayInfo.year}-${String(dayInfo.month).padStart(2, '0')}-${String(dayInfo.day).padStart(2, '0')}`;
      if (key === date) {
        targetWeekIndex = wIdx;
        targetDayIndex = dIdx;
      }
    });
  });

  if (targetWeekIndex < 0 || targetDayIndex < 0) {
    return { skipped: true, reason: 'date_outside_visible_calendar' };
  }

  const therapistIndexMap = new Map();
  therapists.forEach((therapist, index) => {
    if (!therapist?.name) return;
    therapistIndexMap.set(therapist.name, index);
  });
  const therapistCols = therapists.map((_, index) => index);

  const { data: dayLogs, error: logsError } = await supabase
    .from('shockwave_patient_logs')
    .select('*')
    .eq('date', date)
    .order('created_at', { ascending: true });

  if (logsError) throw logsError;

  const { data: existingScheduleRows, error: existingScheduleError } = await supabase
    .from('shockwave_schedules')
    .select('*')
    .eq('year', year)
    .eq('month', month)
    .eq('week_index', targetWeekIndex)
    .eq('day_index', targetDayIndex)
    .in('col_index', therapistCols)
    .order('row_index', { ascending: true });

  if (existingScheduleError) throw existingScheduleError;

  const groupedByTherapist = Array.from({ length: therapists.length }, () => []);
  (dayLogs || []).forEach((row) => {
    const therapistIndex = therapistIndexMap.get(row?.therapist_name);
    if (typeof therapistIndex !== 'number') return;
    const content = formatStatsRowForScheduler(row);
    if (!content) return;
    groupedByTherapist[therapistIndex].push({
      content,
      cleanName: String(row?.patient_name || '').replace(/\*/g, '').trim(),
      body_part: row?.body_part || '',
      prescription: row?.prescription || '',
    });
  });
  const rowsToUpsert = [];
  groupedByTherapist.forEach((items, therapistIndex) => {
    const existingRowsForTherapist = (existingScheduleRows || []).filter(
      (row) => row?.col_index === therapistIndex
    );
    const placedRows = buildSchedulerRowPlacement(items, existingRowsForTherapist);

    placedRows.forEach(({ content, rowIndex, body_part, prescription }) => {
      const existingRow = existingRowsForTherapist.find((row) => row?.row_index === rowIndex);
      rowsToUpsert.push({
        year,
        month,
        week_index: targetWeekIndex,
        day_index: targetDayIndex,
        row_index: rowIndex,
        col_index: therapistIndex,
        content,
        body_part,
        prescription,
        bg_color: existingRow?.bg_color || null,
        merge_span: existingRow?.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null },
        updated_at: new Date().toISOString(),
      });
    });
  });

  if (rowsToUpsert.length > 0) {
    const { error: upsertError } = await supabase
      .from('shockwave_schedules')
      .upsert(rowsToUpsert, { onConflict: 'year,month,week_index,day_index,row_index,col_index' });
    if (upsertError) throw upsertError;
  }

  return {
    synced: true,
    date,
    insertedCount: rowsToUpsert.length,
    therapistCount: therapists.length,
  };
}
