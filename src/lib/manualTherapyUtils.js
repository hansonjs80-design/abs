import { supabase } from './supabaseClient';
import { generateShockwaveCalendar, getTodayKST } from './calendarUtils';
import { normalizeNameForMatch } from './memoParser';

let todayManualTherapySyncQueue = Promise.resolve();

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
  if (!source || !/(40|60)/.test(source)) return null;

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
  const suffixMatch = rest.match(/(\((-|\d+)\)|\*)\s*$/);
  if (suffixMatch) {
    suffixToken = suffixMatch[1];
    visitCount = suffixToken === '*'
      ? '1'
      : suffixMatch[2] === '-'
        ? '-'
        : suffixMatch[2];
    rest = rest.slice(0, rest.length - suffixToken.length).trim();
  }

  const sortedTherapists = [...(therapists || [])]
    .filter((item) => item?.name)
    .sort((a, b) => String(b.name).length - String(a.name).length);

  for (const therapist of sortedTherapists) {
    const match = rest.match(
      new RegExp(`^(.*?)(?:\\s+)?(${escapeRegExp(therapist.name)})\\s*(40|60)$`)
    );
    if (!match) continue;

    const patientName = String(match[1] || '').trim();
    if (!patientName) continue;

    return {
      patientName,
      therapistName: therapist.name,
      durationMinutes: match[3],
      durationLabel: `${match[3]}분`,
      chartNumber,
      visitCount,
    };
  }

  const fallback = rest.match(/^(.*?)(40|60)$/);
  if (!fallback) return null;

  const patientName = String(fallback[1] || '').trim();
  if (!patientName) return null;

  return {
    patientName,
    therapistName: fallbackTherapistName,
    durationMinutes: fallback[2],
    durationLabel: `${fallback[2]}분`,
    chartNumber,
    visitCount,
  };
}

async function runTodayManualTherapyScheduleToStatsSync({ year, month, memos, therapists }) {
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

    const therapistName = therapists?.[c]?.name || '';
    const parsed = parseManualTherapyEntry(cell?.content, therapists, therapistName);
    if (!parsed) return;

    newLogs.push({
      r,
      c,
      date: todayDateStr,
      patient_name: parsed.patientName,
      chart_number: parsed.chartNumber || '',
      visit_count: parsed.visitCount || '',
      body_part: '',
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

  newLogs.forEach((item) => {
    const normalizedName = normalizeNameForMatch(item.patient_name);
    const patientLogs = pastData.filter(
      (past) => {
        const sameChart = item.chart_number && String(past?.chart_number || '').trim() === String(item.chart_number).trim();
        const sameName = normalizedName && normalizeNameForMatch(past?.patient_name) === normalizedName;
        return (sameChart || sameName) && past.date !== todayDateStr;
      }
    );

    if (patientLogs.length > 0) {
      patientLogs.sort((a, b) => {
        if (a.date !== b.date) return String(b.date || '').localeCompare(String(a.date || ''));
        return (parseInt(String(b.visit_count || '0'), 10) || 0) - (parseInt(String(a.visit_count || '0'), 10) || 0);
      });

      const lastLog = patientLogs[0];
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

  const { data: todayStats } = await supabase
    .from('manual_therapy_patient_logs')
    .select('*')
    .eq('date', todayDateStr);

  const schedulerEntries = (todayStats || []).filter((row) => row.source !== 'manual');
  const toDeleteIds = schedulerEntries.map((row) => row.id).filter(Boolean);

  const rebuiltRows = newLogs.map((item) => ({
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

  if (toDeleteIds.length > 0) {
    await supabase.from('manual_therapy_patient_logs').delete().in('id', toDeleteIds);
  }
  if (rebuiltRows.length > 0) {
    await supabase.from('manual_therapy_patient_logs').insert(rebuiltRows);
  }

  return {
    skipped: false,
    todayDateStr,
    extractedCount: newLogs.length,
    insertedCount: rebuiltRows.length,
    updatedCount: 0,
    deletedCount: toDeleteIds.length,
    totalUpdates: rebuiltRows.length + toDeleteIds.length,
  };
}

export async function syncTodayManualTherapyScheduleToStats(params) {
  const run = todayManualTherapySyncQueue.then(() => runTodayManualTherapyScheduleToStatsSync(params));
  todayManualTherapySyncQueue = run.catch(() => {});
  return run;
}
