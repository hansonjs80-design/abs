import { supabase } from './supabaseClient';
import { generateShockwaveCalendar } from './calendarUtils';
import { formatStatsRowForScheduler, parseTherapyInfo } from './shockwaveSyncUtils';

function buildSchedulerRowPlacement(items, existingRows) {
  // Simple placement logic based on existing rows or next available row
  const parsedExistingRows = (existingRows || [])
    .map((row) => ({
      rowIndex: Number(row?.row_index),
      content: String(row?.content || '').trim(),
    }))
    .filter((row) => Number.isInteger(row.rowIndex))
    .sort((a, b) => a.rowIndex - b.rowIndex);

  const usedRowIndexes = new Set();
  const existingRowsByContent = new Map();

  parsedExistingRows.forEach((row) => {
    if (row.content) {
      const contentRows = existingRowsByContent.get(row.content) || [];
      contentRows.push(row.rowIndex);
      existingRowsByContent.set(row.content, contentRows);
    }
  });

  const findNextAvailableRow = (startRow) => {
    let candidate = Math.max(0, Number.isInteger(startRow) ? startRow : 0);
    while (usedRowIndexes.has(candidate)) candidate += 1;
    usedRowIndexes.add(candidate);
    return candidate;
  };

  return items.map((item, itemIndex) => {
    const content = String(item?.content || '').trim();
    
    let rowIndex = null;
    if (content) {
      const contentRows = existingRowsByContent.get(content) || [];
      const unusedRow = contentRows.find(r => !usedRowIndexes.has(r));
      if (unusedRow !== undefined) {
        rowIndex = unusedRow;
      }
    }

    if (rowIndex === null) {
      rowIndex = findNextAvailableRow(itemIndex);
    }
    usedRowIndexes.add(rowIndex);

    return { ...item, rowIndex };
  });
}

export async function syncUnifiedStatsDateToScheduler({ year, month, date }) {
  if (!date) return { skipped: true, reason: 'missing_date' };

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
  const targetDay = Number(String(date).slice(-2));

  // 1. Fetch shockwave therapists to map col_index
  const [
    { data: shockwaveTherapists, error: tError },
    { data: monthlyTherapists, error: mtError },
  ] = await Promise.all([
    supabase
      .from('shockwave_therapists')
      .select('*')
      .eq('is_active', true)
      .order('slot_index'),
    supabase
      .from('shockwave_monthly_therapists')
      .select('*')
      .eq('year', year)
      .eq('month', month)
      .eq('type', 'shockwave')
      .order('slot_index')
      .order('start_day'),
  ]);

  if (tError) throw tError;
  if (mtError) throw mtError;

  const monthlyMaxSlot = (monthlyTherapists || []).reduce(
    (max, item) => Math.max(max, Number(item?.slot_index) || 0),
    -1
  );
  const slotCount = Math.max(1, shockwaveTherapists.length, monthlyMaxSlot + 1);
  const therapistIndexMap = new Map();
  Array.from({ length: slotCount }, (_, index) => {
    const baseName = shockwaveTherapists[index]?.name;
    if (baseName) therapistIndexMap.set(baseName, index);
    const monthlyMatch = (monthlyTherapists || []).find(
      (item) => item.slot_index === index && targetDay >= item.start_day && targetDay <= item.end_day
    );
    if (monthlyMatch?.therapist_name) {
      therapistIndexMap.set(monthlyMatch.therapist_name, index);
    }
  });
  const therapistCols = Array.from({ length: slotCount }, (_, index) => index);

  // 2. Fetch all logs for the date
  const [
    { data: shockwaveLogs, error: sError },
    { data: manualLogs, error: mError }
  ] = await Promise.all([
    supabase.from('shockwave_patient_logs').select('*').eq('date', date),
    supabase.from('manual_therapy_patient_logs').select('*').eq('date', date)
  ]);

  if (sError) throw sError;
  if (mError) throw mError;

  // 3. Format into common structure
  const groupedByTherapist = Array.from({ length: slotCount }, () => []);

  (shockwaveLogs || []).forEach((row) => {
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

  (manualLogs || []).forEach((row) => {
    const therapistIndex = therapistIndexMap.get(row?.therapist_name);
    if (typeof therapistIndex !== 'number') return;
    
    // Build scheduler content for manual therapy
    const duration = String(row.prescription || '').replace(/분$/, '').trim();
    let suffix = '';
    if (row.visit_count && row.visit_count !== '-') suffix = `(${row.visit_count})`;
    else if (row.patient_name?.includes('*')) suffix = '*';
    
    const cleanName = String(row.patient_name || '').replace(/\*/g, '').trim();
    const prefix = row.chart_number ? `${row.chart_number}/` : '';
    const content = `${prefix}${cleanName} ${row.therapist_name || ''} ${duration}${suffix}`.trim();
    
    if (!content) return;
    groupedByTherapist[therapistIndex].push({
      content,
      cleanName,
      body_part: row?.body_part || '',
      prescription: row?.prescription || '',
    });
  });

  // 4. Fetch existing schedule rows for the day to preserve bg_color and merge_span
  const { data: existingScheduleRows, error: existingScheduleError } = await supabase
    .from('shockwave_schedules')
    .select('*')
    .eq('year', year)
    .eq('month', month)
    .eq('week_index', targetWeekIndex)
    .eq('day_index', targetDayIndex)
    .in('col_index', therapistCols);

  if (existingScheduleError) throw existingScheduleError;

  const parsedExistingRows = (existingScheduleRows || []).map(row => {
    let cleanName = '';
    if (row.content) {
      const parsed = parseTherapyInfo(row.content);
      cleanName = String(parsed?.patient_name || '').replace(/\*/g, '').trim();
    }
    return { ...row, cleanName };
  });

  const upsertPayload = [];

  groupedByTherapist.forEach((items, therapistIndex) => {
    const existingForTherapist = parsedExistingRows.filter(r => r.col_index === therapistIndex);
    const usedRowIndexes = new Set();
    const matchedExistingRowIds = new Set();

    // Helper to find next available row index
    const findNextAvailableRow = (start) => {
      let candidate = start || 0;
      while (usedRowIndexes.has(candidate) || existingForTherapist.some(r => r.row_index === candidate && !matchedExistingRowIds.has(r.id) && r.content)) {
        candidate++;
      }
      usedRowIndexes.add(candidate);
      return candidate;
    };

    items.forEach((item, itemIndex) => {
      // Find a matching existing row
      let matchedRow = existingForTherapist.find(r => 
        !matchedExistingRowIds.has(r.id) && 
        (r.content === item.content || (r.cleanName && r.cleanName === item.cleanName))
      );

      let rowIndex;
      let bg_color = null;
      let merge_span = { rowSpan: 1, colSpan: 1, mergedInto: null };

      if (matchedRow) {
        matchedExistingRowIds.add(matchedRow.id);
        rowIndex = matchedRow.row_index;
        bg_color = matchedRow.bg_color;
        merge_span = matchedRow.merge_span;
        usedRowIndexes.add(rowIndex);
      } else {
        rowIndex = findNextAvailableRow(itemIndex);
      }

      upsertPayload.push({
        year, month, week_index: targetWeekIndex, day_index: targetDayIndex,
        row_index: rowIndex, col_index: therapistIndex,
        content: item.content,
        body_part: item.body_part,
        prescription: item.prescription,
        bg_color,
        merge_span,
        updated_at: new Date().toISOString()
      });

    });

    // 통계 동기화는 스케줄을 채우는 방향으로만 동작한다.
    // 통계에 없다는 이유로 기존 스케줄 셀을 비우면 사용자가 직접 입력한 예약이 사라질 수 있다.
  });

  if (upsertPayload.length > 0) {
    const { error: upsertError } = await supabase
      .from('shockwave_schedules')
      .upsert(upsertPayload, { onConflict: 'year,month,week_index,day_index,row_index,col_index' });
    if (upsertError) throw upsertError;
  }

  return {
    synced: true,
    date,
    insertedCount: upsertPayload.length,
    therapistCount: slotCount,
  };
}
