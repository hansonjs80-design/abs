import { supabase } from './supabaseClient';
import { generateShockwaveCalendar, getTodayKST } from './calendarUtils';
import { has4060Pattern } from './schedulerContentFormat';

let todaySchedulerSyncQueue = Promise.resolve();

// --- Google Sheets _ABBREV_MAP ---
export const ABBREV_MAP = {
  'b.': 'Both',
  'lt.hip': 'Lt. Hip',
  'rt.hip': 'Rt. Hip',
  'b.sh': 'Both Shoulder',
  'bsh': 'Both Shoulder',
  'rtfoot': 'Rt. Foot',
  'rt.foot': 'Rt. Foot',
  'ltfoot': 'Lt. Foot',
  'lt.foot': 'Lt. Foot',
  'rt.sh': 'Rt. Shoulder',
  'lt.sh': 'Lt. Shoulder',
  'lx': 'Lumbar',
  'b': 'Both',
  'tx': 'Thoracic',
  'cx': 'Cervical',
  'sh': 'Shoulder',
  'pf': 'Plantar Fasciitis',
  'pv': 'Pelvis',
  'deq': 'Deqervain',
  'quad': 'Quadriceps',
  'ham': 'Hamstring',
  'ut': 'Upper Trap',
  'pt': 'Patellar Tendon',
  'te': 'Tennis elbow',
  'ge': 'Golfer Elbow',
  'ta': 'Tibialis Anterior',
  'tp': 'Tibialis Posterior',
  'es': 'Erector Spine',
  'pl': 'Peroneus Longus',
  'pb': 'Peroneus Brevis',
  'rc': 'Rotator Cuff',
  'rt': 'Rt.',
  'lt': 'Lt.',
  'w': 'Wrist',
  'wx': 'Wrist',
  'e': 'Elbow',
  'f': 'Foot',
  'k': 'Knee',
  'ak': 'Ankle',
  'rtak': 'Rt. Ankle',
  'rt.ak': 'Rt. Ankle',
  'ltak': 'Lt. Ankle',
  'lt.ak': 'Lt. Ankle',
  'rtsh': 'Rt. Shoulder',
  'ltsh': 'Lt. Shoulder',
  'rtk': 'Rt. Knee',
  'ltk': 'Lt. Knee',
  'rtpv': 'Rt. Pelvis',
  'ltpv': 'Lt. Pelvis',
  'rtpf': 'Rt. Plantar Fasciitis',
  'ltpf': 'Lt. Plantar Fasciitis',
  'lte': 'Lt. Elbow',
  'lt.e': 'Lt. Elbow',
  'rte': 'Rt. Elbow',
  'rt.e': 'Rt. Elbow',
  'rtw': 'Rt. Wrist',
  'rt.w': 'Rt. Wrist',
  'ltw': 'Lt. Wrist',
  'lt.w': 'Lt. Wrist'
};

export const ALWAYS_UPPER = [
  'TMJ', 'SIJ', 'SI', 'ACL', 'PCL', 'MCL', 'LCL', 'SLAP', 'TOS', 'CTS', 'SCM', 
  'TFL', 'ITB', 'LBP', 'SC', 'SCJ', 'AC', 'ACJ', 'PFPS', 'GH', 'GHJ', 'MC', 
  'MCJ', 'MT', 'MTJ', 'MCP', 'ATFL', 'QL', 'MTP', 'FHL', 'TFCC'
];

export function toProperCase(str) {
  if (!str) return str;
  return str.split(/([,\/\- ]+)/).map(tok => {
    if (/^[,\/\- ]+$/.test(tok)) return tok;
    const lower = tok.toLowerCase();
    if (ABBREV_MAP.hasOwnProperty(lower)) return ABBREV_MAP[lower];
    const upper = tok.toUpperCase();
    if (ALWAYS_UPPER.includes(upper)) return upper;
    return tok.charAt(0).toUpperCase() + tok.slice(1).toLowerCase();
  }).join('');
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

  return {
    patient_name: name,
    chart_number: chart,
    visit_count: visit, 
    body_part: "", // To be auto-filled by sync logic
    original: s
  };
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

async function runTodayShockwaveScheduleToStatsSync({ year, month, memos, therapists, monthlyTherapists, targetDateStr, overwriteManual = false }) {
  if (!memos) {
    return { skipped: true, reason: 'missing_memos' };
  }

  const today = getTodayKST();
  const todayY = targetDateStr ? parseInt(targetDateStr.split('-')[0], 10) : today.getFullYear();
  const todayM = targetDateStr ? parseInt(targetDateStr.split('-')[1], 10) : today.getMonth() + 1;
  const todayD = targetDateStr ? parseInt(targetDateStr.split('-')[2], 10) : today.getDate();
  const todayDateStrFinal = targetDateStr || `${todayY}-${String(todayM).padStart(2, '0')}-${String(todayD).padStart(2, '0')}`;

  if (!targetDateStr && (todayY !== year || todayM !== month)) {
    return { skipped: true, reason: 'today_outside_current_month', todayDateStr: todayDateStrFinal };
  }

  const weeks = generateShockwaveCalendar(year, month);
  const newLogs = [];

  Object.entries(memos).forEach(([key, cell]) => {
    const [w, d, r, c] = key.split('-').map(Number);
    const dayInfo = weeks[w]?.[d];
    if (!dayInfo || !dayInfo.isCurrentMonth) return;
    if (dayInfo.year !== todayY || dayInfo.month !== todayM || dayInfo.day !== todayD) return;

    const parsed = parseTherapyInfo(cell?.content);
    if (!parsed) return;

    const therapistName = resolveTherapistName(c, dayInfo.day, therapists, monthlyTherapists);
    newLogs.push({
      r,
      c,
      date: todayDateStrFinal,
      patient_name: parsed.patient_name,
      chart_number: parsed.chart_number || '',
      visit_count: parsed.visit_count || '',
      body_part: cell?.body_part || parsed.body_part || '',
      therapist_name: therapistName,
      prescription: cell?.prescription || '',
      prescription_count: cell?.prescription ? 1 : null,
    });
  });

  newLogs.sort((a, b) => {
    if (a.r !== b.r) return a.r - b.r;
    return a.c - b.c;
  });

  const cleanNamesSet = new Set(newLogs.map((l) => l.patient_name.replace(/\*/g, '')));
  const queryNames = [];
  cleanNamesSet.forEach((name) => {
    queryNames.push(name);
    queryNames.push(`${name}*`);
  });

  let pastData = [];
  if (queryNames.length > 0) {
    const { data } = await supabase
      .from('shockwave_patient_logs')
      .select('patient_name, chart_number, visit_count, body_part, date')
      .in('patient_name', queryNames)
      .order('date', { ascending: false });

    pastData = data || [];
  }

  newLogs.forEach((item) => {
    const cleanName = item.patient_name.replace(/\*/g, '');
    const patientLogs = pastData.filter(
      (past) => past.patient_name.replace(/\*/g, '') === cleanName && past.date !== todayDateStrFinal
    );

    if (patientLogs.length > 0) {
      patientLogs.sort((a, b) => {
        if (a.date !== b.date) return b.date.localeCompare(a.date);
        return (parseInt(b.visit_count || '0', 10) || 0) - (parseInt(a.visit_count || '0', 10) || 0);
      });

      const lastLog = patientLogs[0];
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

  const { data: todayStats } = await supabase
    .from('shockwave_patient_logs')
    .select('*')
    .eq('date', todayDateStrFinal);

  const schedulerEntriesForCopying = (todayStats || []).filter((row) => row.source !== 'manual');
  const existingGroups = {};
  schedulerEntriesForCopying.forEach((row) => {
    const key = (row.patient_name || '').replace(/\*/g, '');
    if (!existingGroups[key]) existingGroups[key] = [];
    existingGroups[key].push(row);
  });

  const rebuiltSchedulerRows = [];

  newLogs.forEach((item) => {
    const key = item.patient_name.replace(/\*/g, '');
    const old = existingGroups[key]?.shift() || null;

    const out = {
      date: item.date,
      patient_name: item.patient_name,
      chart_number: item.chart_number,
      visit_count: item.visit_count,
      body_part: item.body_part,
      therapist_name: item.therapist_name,
      prescription: item.prescription || old?.prescription || '',
      prescription_count: item.prescription_count !== null ? item.prescription_count : old?.prescription_count || '',
      source: 'scheduler',
    };

    rebuiltSchedulerRows.push(out);
  });

  const toDeleteIds = (todayStats || [])
    .filter((row) => overwriteManual ? true : row.source !== 'manual')
    .map((row) => row.id)
    .filter(Boolean);

  if (toDeleteIds.length > 0) {
    await supabase.from('shockwave_patient_logs').delete().in('id', toDeleteIds);
  }
  if (rebuiltSchedulerRows.length > 0) {
    await supabase.from('shockwave_patient_logs').insert(rebuiltSchedulerRows);
  }

  return {
    skipped: false,
    todayDateStr: todayDateStrFinal,
    extractedCount: newLogs.length,
    insertedCount: rebuiltSchedulerRows.length,
    updatedCount: 0,
    deletedCount: toDeleteIds.length,
    totalUpdates: rebuiltSchedulerRows.length + toDeleteIds.length,
  };
}

export async function syncTodayShockwaveScheduleToStats(params) {
  const run = todaySchedulerSyncQueue.then(() => runTodayShockwaveScheduleToStatsSync(params));
  todaySchedulerSyncQueue = run.catch(() => {});
  return run;
}

export async function syncMonthShockwaveScheduleToStats({ year, month, memos, therapists, monthlyTherapists, upToToday = false, overwriteManual = false }) {
  const today = getTodayKST();
  const daysInMonth = new Date(year, month, 0).getDate();
  let endDay = daysInMonth;
  
  if (upToToday && year === today.getFullYear() && month === today.getMonth() + 1) {
    endDay = today.getDate();
  }

  let totalInserted = 0;
  let totalDeleted = 0;
  let totalUpdated = 0;

  for (let d = 1; d <= endDay; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    try {
      const result = await syncTodayShockwaveScheduleToStats({
        year,
        month,
        memos,
        therapists,
        monthlyTherapists,
        targetDateStr: dateStr,
        overwriteManual
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
    const nextMonthDate = new Date(year, month, 1);
    const endOfMonthStr = `${year}-${String(month).padStart(2, '0')}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`;
    
    try {
      const { error } = await supabase
        .from('shockwave_patient_logs')
        .delete()
        .gt('date', todayDateStr)
        .lte('date', endOfMonthStr)
        .neq('source', 'manual');
        
      if (error) console.error('Failed to cleanup future dates:', error);
    } catch (e) {
      console.error(e);
    }
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
