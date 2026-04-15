import { supabase } from './supabaseClient';
import { generateShockwaveCalendar, getTodayKST } from './calendarUtils';
import { has4060Pattern } from './memoParser';

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
  const visitMatch = name.match(/\((\d+)\)$/);
  if (visitMatch) {
    visit = visitMatch[1];
    name = name.replace(/\(\d+\)$/, '').trim();
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

async function runTodayShockwaveScheduleToStatsSync({ year, month, memos, therapists }) {
  if (!memos) {
    return { skipped: true, reason: 'missing_memos' };
  }

  const today = getTodayKST();
  const todayY = today.getFullYear();
  const todayM = today.getMonth() + 1;
  const todayD = today.getDate();
  const todayDateStr = `${todayY}-${String(todayM).padStart(2, '0')}-${String(todayD).padStart(2, '0')}`;

  if (todayY !== year || todayM !== month) {
    return { skipped: true, reason: 'today_outside_current_month', todayDateStr };
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

    const therapistName = therapists?.[c]?.name || `치료사 ${c + 1}`;
    newLogs.push({
      r,
      c,
      date: todayDateStr,
      patient_name: parsed.patient_name,
      chart_number: parsed.chart_number || '',
      visit_count: parsed.visit_count || '',
      body_part: parsed.body_part || '',
      therapist_name: therapistName,
      prescription: '',
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
      (past) => past.patient_name.replace(/\*/g, '') === cleanName && past.date !== todayDateStr
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
    .eq('date', todayDateStr);

  const schedulerEntries = (todayStats || []).filter((row) => row.source !== 'manual');
  const existingGroups = {};
  schedulerEntries.forEach((row) => {
    const key = row.patient_name.replace(/\*/g, '');
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
      prescription: old?.prescription || '',
      prescription_count: old?.prescription_count || '',
      source: 'scheduler',
    };

    rebuiltSchedulerRows.push(out);
  });

  const toDeleteIds = schedulerEntries.map((row) => row.id).filter(Boolean);

  if (toDeleteIds.length > 0) {
    await supabase.from('shockwave_patient_logs').delete().in('id', toDeleteIds);
  }
  if (rebuiltSchedulerRows.length > 0) {
    await supabase.from('shockwave_patient_logs').insert(rebuiltSchedulerRows);
  }

  return {
    skipped: false,
    todayDateStr,
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

function formatStatsRowForScheduler(row) {
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

  const { data: dayLogs, error: logsError } = await supabase
    .from('shockwave_patient_logs')
    .select('*')
    .eq('date', date)
    .order('created_at', { ascending: true });

  if (logsError) throw logsError;

  const groupedByTherapist = Array.from({ length: therapists.length }, () => []);
  (dayLogs || []).forEach((row) => {
    const therapistIndex = therapistIndexMap.get(row?.therapist_name);
    if (typeof therapistIndex !== 'number') return;
    const content = formatStatsRowForScheduler(row);
    if (!content) return;
    groupedByTherapist[therapistIndex].push(content);
  });

  const therapistCols = therapists.map((_, index) => index);
  const { error: deleteError } = await supabase
    .from('shockwave_schedules')
    .delete()
    .eq('year', year)
    .eq('month', month)
    .eq('week_index', targetWeekIndex)
    .eq('day_index', targetDayIndex)
    .in('col_index', therapistCols);

  if (deleteError) throw deleteError;

  const rowsToInsert = [];
  groupedByTherapist.forEach((items, therapistIndex) => {
    items.forEach((content, rowIndex) => {
      rowsToInsert.push({
        year,
        month,
        week_index: targetWeekIndex,
        day_index: targetDayIndex,
        row_index: rowIndex,
        col_index: therapistIndex,
        content,
        bg_color: null,
        merge_span: { rowSpan: 1, colSpan: 1 },
      });
    });
  });

  if (rowsToInsert.length > 0) {
    const { error: insertError } = await supabase
      .from('shockwave_schedules')
      .insert(rowsToInsert);
    if (insertError) throw insertError;
  }

  return {
    synced: true,
    date,
    insertedCount: rowsToInsert.length,
    therapistCount: therapists.length,
  };
}
