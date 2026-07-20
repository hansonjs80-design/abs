import { supabase } from './supabaseClient';
import { generateShockwaveCalendar, getTodayKST } from './calendarUtils';
import { normalizeNameForMatch } from './memoParser';
import { TREATMENT_COMPLETE_BG } from './schedulerUtils';
import {
  getPastLogsForPatient,
  sortPastLogsLatestFirst,
} from './patientHistoryMatchUtils';
import {
  buildScheduleStatsSyncMutation,
  fetchStatsRowsForDateRange,
  getStatsMonthDateRange,
  replaceStatsRowsForDateRange,
  shouldOverwriteExistingStatsForScheduleSync,
} from './scheduleStatsSyncUtils.js';

let todayManualTherapySyncQueue = Promise.resolve();

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

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toVisitNumber(value) {
  if (value === '-') return '-';
  const parsed = parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(parsed) ? String(parsed) : '';
}

export function formatMonthDay(dateText) {
  const parts = String(dateText || '').split('-');
  if (parts.length !== 3) return '';
  return `${parts[1]}/${parts[2]}`;
}

export function formatVisitLabel(value) {
  const normalized = toVisitNumber(value);
  if (normalized === '-') return '(-)';
  if (!normalized) return '';
  return `${normalized}회`;
}

export function parseManualTherapyEntry(rawContent, therapists, fallbackTherapistName = '') {
  const source = String(rawContent || '').trim();
  if (!source || !/\d{2,3}/.test(source)) return null;

  let chartNumber = '';
  let rest = source;

  if (source.includes('/')) {
    const [left, ...right] = source.split('/');
    if (/\d/.test(left)) {
      chartNumber = left.trim();
      rest = right.join('/').trim();
    }
  }

  let suffixToken = '';
  let visitCount = '';
  let isNewMarked = false;
  const suffixMatch = rest.match(/(\((-|\d+)\)|\*)\s*$/);
  if (suffixMatch) {
    const matchedVal = suffixMatch[2];
    const isDurationCandidate = matchedVal && /^(30|40|60|90|120|150|180)$/.test(matchedVal);

    if (suffixMatch[1] === '*' || !isDurationCandidate) {
      suffixToken = suffixMatch[1];
      visitCount = suffixToken === '*'
        ? '1'
        : suffixMatch[2] === '-'
          ? '-'
          : suffixMatch[2];
      isNewMarked = suffixToken === '*';
      rest = rest.slice(0, rest.length - suffixToken.length).trim();
    }
  }

  const sortedTherapists = [...(therapists || [])]
    .filter((item) => item?.name)
    .sort((a, b) => String(b.name).length - String(a.name).length);

  for (const therapist of sortedTherapists) {
    const pattern = "^(.*?)(?:\\s+)?(" + escapeRegExp(therapist.name) + ")\\s*\\(?\\s*(\\d{2,3})\\s*(?:분|min|m|Min)?\\s*\\)?\\s*$";
    const match = rest.match(new RegExp(pattern));
    if (!match) continue;

    const patientName = String(match[1] || '').trim();
    if (!patientName) continue;

    return {
      patientName: isNewMarked ? `${patientName}*` : patientName,
      therapistName: therapist.name,
      durationMinutes: match[3],
      durationLabel: `${match[3]}분`,
      chartNumber,
      visitCount,
    };
  }

  const fallbackRegex = /^(.*?)\s*\(?\s*(\d{2,3})\s*(?:분|min|m|Min)?\s*\)?\s*$/;
  const fallback = rest.match(fallbackRegex);
  if (!fallback) return null;

  const patientName = String(fallback[1] || '').trim();
  if (!patientName) return null;

  return {
    patientName: isNewMarked ? `${patientName}*` : patientName,
    therapistName: fallbackTherapistName,
    durationMinutes: fallback[2],
    durationLabel: `${fallback[2]}분`,
    chartNumber,
    visitCount,
  };
}

// 월별 치료사 설정에서 날짜별 치료사 이름 조회
function resolveManualTherapistName(slotIndex, day, therapists, monthlyTherapists) {
  if (monthlyTherapists && monthlyTherapists.length > 0) {
    const match = monthlyTherapists.find(
      (t) => t.slot_index === slotIndex && day >= t.start_day && day <= t.end_day
    );
    if (match !== undefined) return match.therapist_name || '';
  }
  return therapists?.[slotIndex]?.name || '';
}

async function runTodayManualTherapyScheduleToStatsSync({
  year,
  month,
  memos,
  therapists,
  monthlyTherapists,
  targetDateStr,
  overwriteManual = false,
  scheduleAuthoritative = true,
  pastDataCache = null,
  existingMonthStats = null,
  collectOnly = false
}) {
  if (!memos) {
    return { skipped: true, reason: 'missing_memos' };
  }

  const today = getTodayKST();
  const todayY = targetDateStr ? parseInt(targetDateStr.split('-')[0], 10) : today.getFullYear();
  const todayM = targetDateStr ? parseInt(targetDateStr.split('-')[1], 10) : today.getMonth() + 1;
  const todayD = targetDateStr ? parseInt(targetDateStr.split('-')[2], 10) : today.getDate();
  const todayDateStrFinal = targetDateStr || `${todayY}-${String(todayM).padStart(2, '0')}-${String(todayD).padStart(2, '0')}`;
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
  Object.entries(memos).forEach(([key, cell]) => {
    const [w, d, r, c] = key.split('-').map(Number);
    const dayInfo = weeks[w]?.[d];
    if (!dayInfo || !dayInfo.isCurrentMonth) return;
    if (dayInfo.year !== todayY || dayInfo.month !== todayM || dayInfo.day !== todayD) return;

    // 방문 완료된 셀만 통계에 포함
    if (String(cell?.bg_color || '').toLowerCase() !== TREATMENT_COMPLETE_BG.toLowerCase()) return;

    const therapistName = resolveManualTherapistName(c, dayInfo.day, therapists, monthlyTherapists);
    const parsed = parseManualTherapyEntry(cell?.content, therapists, therapistName);
    if (!parsed) return;

    newLogs.push({
      r,
      c,
      scheduler_cell_key: buildSchedulerCellKey(year, month, w, d, r, c),
      date: todayDateStrFinal,
      patient_name: parsed.patientName,
      chart_number: parsed.chartNumber || '',
      visit_count: parsed.visitCount || '',
      body_part: cell?.body_part || '',
      therapist_name: parsed.therapistName || therapistName,
      prescription: parsed.durationLabel,
      prescription_count: 1,
    });
  });

  newLogs.sort((a, b) => {
    if (a.r !== b.r) return a.r - b.r;
    return a.c - b.c;
  });

  const cleanNamesSet = new Set(newLogs.map((item) => normalizeNameForMatch(item.patient_name)));
  const queryNames = [];
  const chartNumbers = [];
  cleanNamesSet.forEach((name) => {
    if (!name) return;
    queryNames.push(name);
  });
  newLogs.forEach((item) => {
    if (item.chart_number) chartNumbers.push(String(item.chart_number).trim());
  });

  let pastData = [];
  if (pastDataCache) {
    if (queryNames.length > 0 || chartNumbers.length > 0) {
      pastData = pastDataCache.filter((row) => {
        const normalizedName = normalizeNameForMatch(row?.patient_name);
        const chartNumber = String(row?.chart_number || '').trim();
        return (
          (normalizedName && queryNames.includes(normalizedName)) ||
          (chartNumber && chartNumbers.includes(chartNumber))
        );
      });
    }
  } else {
    const [manualHistoryResult, shockwaveHistoryResult] = await Promise.all([
      supabase
        .from('manual_therapy_patient_logs')
        .select('patient_name, chart_number, visit_count, body_part, date')
        .order('date', { ascending: false }),
      supabase
        .from('shockwave_patient_logs')
        .select('patient_name, chart_number, visit_count, body_part, date')
        .order('date', { ascending: false }),
    ]);

    const combinedHistory = [
      ...(manualHistoryResult.data || []),
      ...(shockwaveHistoryResult.data || []),
    ];

    if (queryNames.length > 0 || chartNumbers.length > 0) {
      pastData = combinedHistory.filter((row) => {
        const normalizedName = normalizeNameForMatch(row?.patient_name);
        const chartNumber = String(row?.chart_number || '').trim();
        return (
          (normalizedName && queryNames.includes(normalizedName)) ||
          (chartNumber && chartNumbers.includes(chartNumber))
        );
      });
    }
  }

  newLogs.forEach((item) => {
    const patientLogs = getPastLogsForPatient(item, pastData, todayDateStrFinal);

    if (patientLogs.length > 0) {
      const lastLog = sortPastLogsLatestFirst(patientLogs)[0];
      if (!item.chart_number) item.chart_number = lastLog.chart_number || '';
      if (!item.body_part) item.body_part = lastLog.body_part || '';
      if (!item.visit_count) {
        const lastVisit = parseInt(String(lastLog.visit_count || '0'), 10);
        item.visit_count = lastVisit > 0 ? String(lastVisit + 1) : '1';
      }
    } else if (!item.visit_count) {
      item.visit_count = '1';
    }
  });

  let todayStats = [];
  if (existingMonthStats) {
    todayStats = existingMonthStats.filter((row) => row.date === todayDateStrFinal);
  } else {
    const { data } = await supabase
      .from('manual_therapy_patient_logs')
      .select('*')
      .eq('date', todayDateStrFinal);
    todayStats = data || [];
  }

  const rebuiltRows = newLogs.map((item) => ({
    scheduler_cell_key: item.scheduler_cell_key,
    date: item.date,
    patient_name: item.patient_name,
    chart_number: item.chart_number,
    visit_count: item.visit_count,
    body_part: item.body_part,
    therapist_name: item.therapist_name,
    prescription: item.prescription,
    prescription_count: item.prescription_count || 1,
    source: 'scheduler',
  }));

  const { toDeleteIds, rowsToUpsert } = buildScheduleStatsSyncMutation({
    existingRows: todayStats || [],
    rebuiltRows,
    overwriteExistingStats: effectiveOverwriteManual,
    isSameRow: (existing, newRow) => (
      existing.patient_name === newRow.patient_name &&
      String(existing.chart_number || '') === String(newRow.chart_number || '') &&
      String(existing.visit_count || '') === String(newRow.visit_count || '') &&
      String(existing.body_part || '') === String(newRow.body_part || '') &&
      existing.therapist_name === newRow.therapist_name &&
      existing.prescription === newRow.prescription &&
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
      toDeleteIds,
      rowsToUpsert,
      rebuiltRows,
      todayStats
    };
  }

  if (toDeleteIds.length > 0) {
    const { error: deleteError } = await supabase.from('manual_therapy_patient_logs').delete().in('id', toDeleteIds);
    if (deleteError) throw deleteError;
  }
  
  if (rowsToUpsert.length > 0) {
    const { error: upsertError } = await supabase
      .from('manual_therapy_patient_logs')
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
        const { error: fallbackDeleteError } = await supabase.from('manual_therapy_patient_logs').delete().in('id', fallbackDeleteIds);
        if (fallbackDeleteError) throw fallbackDeleteError;
      }
      const { error: fallbackInsertError } = await supabase.from('manual_therapy_patient_logs').insert(fallbackRows);
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

export async function syncTodayManualTherapyScheduleToStats(params) {
  const run = todayManualTherapySyncQueue.then(async () => {
    const res = await runTodayManualTherapyScheduleToStatsSync(params);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('clinic-stats-updated'));
    }
    return res;
  });
  todayManualTherapySyncQueue = run.catch(() => {});
  return run;
}

export async function syncMonthManualTherapyScheduleToStats({
  year,
  month,
  memos,
  therapists,
  monthlyTherapists,
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

    Object.entries(memos || {}).forEach(([key, cell]) => {
      const [w, d, _r, c] = key.split('-').map(Number);
      const dayInfo = weeks[w]?.[d];
      if (!dayInfo || !dayInfo.isCurrentMonth) return;
      if (upToToday && year === today.getFullYear() && month === today.getMonth() + 1) {
        if (dayInfo.day > today.getDate()) return;
      }
      if (String(cell?.bg_color || '').toLowerCase() !== TREATMENT_COMPLETE_BG.toLowerCase()) return;

      const therapistName = resolveManualTherapistName(c, dayInfo.day, therapists, monthlyTherapists);
      const parsed = parseManualTherapyEntry(cell?.content, therapists, therapistName);
      if (!parsed) return;

      const normalizedName = normalizeNameForMatch(parsed.patientName);
      if (normalizedName) {
        patientNamesSet.add(normalizedName);
        patientNamesSet.add(`${normalizedName}*`);
      }
      if (parsed.chartNumber) chartNumbersSet.add(String(parsed.chartNumber).trim());
    });

    const historyQueries = [];
    const patientNames = Array.from(patientNamesSet);
    const chartNumbers = Array.from(chartNumbersSet);
    ['manual_therapy_patient_logs', 'shockwave_patient_logs'].forEach((tableName) => {
      if (patientNames.length > 0) {
        historyQueries.push(
          supabase
            .from(tableName)
            .select('patient_name, chart_number, visit_count, body_part, date')
            .in('patient_name', patientNames)
            .lt('date', startOfMonthStr)
            .order('date', { ascending: false })
        );
      }
      if (chartNumbers.length > 0) {
        historyQueries.push(
          supabase
            .from(tableName)
            .select('patient_name, chart_number, visit_count, body_part, date')
            .in('chart_number', chartNumbers)
            .lt('date', startOfMonthStr)
            .order('date', { ascending: false })
        );
      }
    });

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
      tableName: 'manual_therapy_patient_logs',
      startDate: startOfMonthStr,
      endDate: endOfMonthStr,
    });

    const rebuiltRowsForMonth = [];
    const dateErrors = [];

    for (let d = 1; d <= endDay; d++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      try {
        const result = await runTodayManualTherapyScheduleToStatsSync({
          year,
          month,
          memos,
          therapists,
          monthlyTherapists,
          targetDateStr: dateStr,
          overwriteManual: effectiveOverwriteManual,
          scheduleAuthoritative: false,
          pastDataCache: rollingPastData,
          existingMonthStats,
          collectOnly: true,
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
      throw new Error(`도수치료 월 통계 재계산 실패: ${dateErrors.join(', ')}`);
    }

    const deletedCount = effectiveOverwriteManual
      ? existingMonthStats.length
      : existingMonthStats.filter((row) => row?.source !== 'manual').length;
    const { inserted } = await replaceStatsRowsForDateRange({
      supabaseClient: supabase,
      tableName: 'manual_therapy_patient_logs',
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
    };
  }

  let totalInserted = 0;
  let totalDeleted = 0;
  let totalUpdated = 0;

  // 1단계: 월별 스케줄러 memos 전체를 분석하여, 완료된 도수치료 건의 고유 환자 명단(이름 및 차트 번호)을 수집합니다.
  const weeks = generateShockwaveCalendar(year, month);
  const patientNamesSet = new Set();
  const chartNumbersSet = new Set();

  Object.entries(memos || {}).forEach(([key, cell]) => {
    const [w, d, _r, c] = key.split('-').map(Number);
    const dayInfo = weeks[w]?.[d];
    if (!dayInfo || !dayInfo.isCurrentMonth) return;
    if (upToToday && year === today.getFullYear() && month === today.getMonth() + 1) {
      if (dayInfo.day > today.getDate()) return;
    }

    if (String(cell?.bg_color || '').toLowerCase() !== TREATMENT_COMPLETE_BG.toLowerCase()) return;

    const therapistName = resolveManualTherapistName(c, dayInfo.day, therapists, monthlyTherapists);
    const parsed = parseManualTherapyEntry(cell?.content, therapists, therapistName);
    if (!parsed) return;

    const norm = normalizeNameForMatch(parsed.patientName);
    if (norm) patientNamesSet.add(norm);
    if (parsed.chartNumber) chartNumbersSet.add(String(parsed.chartNumber).trim());
  });

  // 2단계: 수집된 환자들만을 대상으로 과거 히스토리 로그(manual + shockwave)를 단 1회 일괄 조회합니다.
  const namesArr = Array.from(patientNamesSet);
  const chartsArr = Array.from(chartNumbersSet);
  
  let manualHistory = [];
  let shockwaveHistory = [];

  if (namesArr.length > 0 || chartsArr.length > 0) {
    const orParts = [];
    if (namesArr.length > 0) {
      const safeNames = namesArr.map(n => n.replace(/,/g, '')).filter(Boolean);
      if (safeNames.length > 0) {
        orParts.push(`patient_name.in.(${safeNames.join(',')})`);
      }
    }
    if (chartsArr.length > 0) {
      const safeCharts = chartsArr.map(c => c.replace(/,/g, '')).filter(Boolean);
      if (safeCharts.length > 0) {
        orParts.push(`chart_number.in.(${safeCharts.join(',')})`);
      }
    }

    if (orParts.length > 0) {
      const orQuery = orParts.join(',');
      const [mHist, sHist] = await Promise.all([
        supabase
          .from('manual_therapy_patient_logs')
          .select('patient_name, chart_number, visit_count, body_part, date')
          .or(orQuery)
          .order('date', { ascending: false }),
        supabase
          .from('shockwave_patient_logs')
          .select('patient_name, chart_number, visit_count, body_part, date')
          .or(orQuery)
          .order('date', { ascending: false })
      ]);
      
      manualHistory = mHist.data || [];
      shockwaveHistory = sHist.data || [];
    }
  }

  const pastDataCache = [...manualHistory, ...shockwaveHistory];

  // 3단계: 해당 월 전체의 기존 통계 데이터를 단 1회 일괄 조회합니다.
  const { data: existingMonthStats, error: statsError } = await supabase
    .from('manual_therapy_patient_logs')
    .select('*')
    .gte('date', startOfMonthStr)
    .lte('date', endOfMonthStr);

  if (statsError) {
    console.error('Failed to fetch existing month stats:', statsError);
  }
  const statsCache = existingMonthStats || [];

  // 4단계: 일별 루프를 돌며 위에서 구성한 로컬 캐시를 사용해 변경 필요 데이터를 수집합니다. (DB 호출 없음)
  const allToDeleteIds = [];
  const allRowsToUpsert = [];

  for (let d = 1; d <= endDay; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    try {
      const result = await runTodayManualTherapyScheduleToStatsSync({
        year,
        month,
        memos,
        therapists,
        monthlyTherapists,
        targetDateStr: dateStr,
        overwriteManual: effectiveOverwriteManual,
        scheduleAuthoritative: false,
        pastDataCache,
        existingMonthStats: statsCache,
        collectOnly: true
      });

      if (!result.skipped) {
        if (result.toDeleteIds && result.toDeleteIds.length > 0) {
          allToDeleteIds.push(...result.toDeleteIds);
        }
        if (result.rowsToUpsert && result.rowsToUpsert.length > 0) {
          allRowsToUpsert.push(...result.rowsToUpsert);
        }
        totalInserted += result.insertedCount || 0;
        totalDeleted += result.deletedCount || 0;
        totalUpdated += result.updatedCount || 0;
      }
    } catch (e) {
      console.error(`Failed to gather sync data for ${dateStr}:`, e);
    }
  }

  // 5단계: 수집된 삭제 대상 ID들과 업서트 대상 행들을 일괄(Bulk) 쿼리로 처리합니다.
  if (allToDeleteIds.length > 0) {
    const chunkSize = 100;
    for (let i = 0; i < allToDeleteIds.length; i += chunkSize) {
      const chunk = allToDeleteIds.slice(i, i + chunkSize);
      const { error: delErr } = await supabase
        .from('manual_therapy_patient_logs')
        .delete()
        .in('id', chunk);
      if (delErr) {
        throw delErr;
      }
    }
  }

  if (allRowsToUpsert.length > 0) {
    const chunkSize = 100;
    for (let i = 0; i < allRowsToUpsert.length; i += chunkSize) {
      const chunk = allRowsToUpsert.slice(i, i + chunkSize);
      const { error: upsertError } = await supabase
        .from('manual_therapy_patient_logs')
        .upsert(chunk, { onConflict: 'scheduler_cell_key' });

      if (upsertError) {
        console.warn('Bulk upsert failed, retrying with fallback...', upsertError);
        if (!isSchedulerCellKeyUpsertUnsupportedError(upsertError)) throw upsertError;

        // Fallback: scheduler_cell_key 컬럼 또는 유니크 인덱스가 없는 구버전 스키마 대응
        const fallbackRows = isMissingSchedulerCellKeyError(upsertError)
          ? chunk.map(omitSchedulerCellKey)
          : chunk;
        const uniqueDates = Array.from(new Set(chunk.map(r => r.date)));
        
        for (const uDate of uniqueDates) {
          let fallbackDeleteQuery = supabase
            .from('manual_therapy_patient_logs')
            .delete()
            .eq('date', uDate);
          if (!effectiveOverwriteManual) {
            fallbackDeleteQuery = fallbackDeleteQuery.neq('source', 'manual');
          }
          const { error: fallbackDeleteError } = await fallbackDeleteQuery;
          if (fallbackDeleteError) throw fallbackDeleteError;
        }

        const { error: insErr } = await supabase
          .from('manual_therapy_patient_logs')
          .insert(fallbackRows);
        if (insErr) {
          throw insErr;
        }
      }
    }
  }

  // 6단계: 동기화를 오늘까지만 진행한 경우, 월말까지의 잔여 미래 데이터를 청소합니다.
  if (upToToday && year === today.getFullYear() && month === today.getMonth() + 1) {
    const todayDateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    
    try {
      let query = supabase
        .from('manual_therapy_patient_logs')
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

  // 7단계: 모든 벌크 연산 완료 후 이벤트를 단 1회 발생시켜 전역 상태를 업데이트합니다.
  if (emitEvent && typeof window !== 'undefined') {
    window.dispatchEvent(new Event('clinic-stats-updated'));
  }

  return { totalInserted, totalDeleted, totalUpdated, totalUpdates: totalInserted + totalDeleted + totalUpdated };
}
