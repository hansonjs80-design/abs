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
  const [
    { data: existingScheduleRows, error: existingScheduleError },
    { data: existingMemos, error: memosError }
  ] = await Promise.all([
    supabase
      .from('shockwave_schedules')
      .select('*')
      .eq('year', year)
      .eq('month', month)
      .eq('week_index', targetWeekIndex)
      .eq('day_index', targetDayIndex)
      .in('col_index', therapistCols),
    supabase
      .from('shockwave_memos')
      .select('id, year, month, week_index, day_index, row_index, col_index, content, bg_color, merge_span, prescription, body_part')
      .eq('year', year)
      .eq('month', month)
      .eq('week_index', targetWeekIndex)
      .eq('day_index', targetDayIndex)
  ]);

  if (existingScheduleError) throw existingScheduleError;
  if (memosError) throw memosError;

  const parsedExistingRows = (existingScheduleRows || []).map(row => {
    let cleanName = '';
    if (row.content) {
      const parsed = parseTherapyInfo(row.content);
      cleanName = String(parsed?.patient_name || '').replace(/\*/g, '').trim();
    }
    return { ...row, cleanName };
  });

  const upsertPayload = [];
  const memosUpsertPayload = [];
  const deleteIds = []; // We won't delete rows, we will just clear their content

  groupedByTherapist.forEach((items, therapistIndex) => {
    const existingForTherapist = parsedExistingRows.filter(r => r.col_index === therapistIndex);
    const usedRowIndexes = new Set();
    const matchedExistingRowIds = new Set();
    const incomingNames = new Set(items.map((item) => String(item.cleanName || '').trim()).filter(Boolean));

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

      const existingMemo = existingMemos?.find(m => m.row_index === rowIndex && m.col_index === therapistIndex);
      if (existingMemo && (existingMemo.body_part !== item.body_part || existingMemo.prescription !== item.prescription)) {
        memosUpsertPayload.push({
          ...existingMemo,
          body_part: item.body_part,
          prescription: item.prescription,
          updated_at: new Date().toISOString()
        });
      }
    });

    // For existing rows that had content but were NOT matched, we clear their content
    existingForTherapist.forEach(r => {
      if (!matchedExistingRowIds.has(r.id) && r.content) {
        // 같은 날짜/치료사에 동일 환자가 여러 번 있는 경우, 통계 행 하나와 매칭되지 않았다는
        // 이유만으로 나머지 예약을 지우면 실제 스케줄 중복 예약이 1개로 줄어든다.
        // 동일 환자명으로 들어온 동기화가 있으면 기존 추가 예약은 유지한다.
        if (r.cleanName && incomingNames.has(r.cleanName)) return;

        upsertPayload.push({
          year, month, week_index: targetWeekIndex, day_index: targetDayIndex,
          row_index: r.row_index, col_index: r.col_index,
          content: '',
          body_part: null,
          prescription: null,
          bg_color: r.bg_color,
          merge_span: r.merge_span,
          updated_at: new Date().toISOString()
        });

        const existingMemo = existingMemos?.find(m => m.row_index === r.row_index && m.col_index === r.col_index);
        if (existingMemo && (existingMemo.body_part || existingMemo.prescription)) {
          memosUpsertPayload.push({
            ...existingMemo,
            body_part: null,
            prescription: null,
            updated_at: new Date().toISOString()
          });
        }
      }
    });
  });

  if (upsertPayload.length > 0) {
    const { error: upsertError } = await supabase
      .from('shockwave_schedules')
      .upsert(upsertPayload, { onConflict: 'year,month,week_index,day_index,row_index,col_index' });
    if (upsertError) throw upsertError;
  }

  if (memosUpsertPayload.length > 0) {
    const { error: memoUpsertError } = await supabase
      .from('shockwave_memos')
      .upsert(memosUpsertPayload, { onConflict: 'id' });
    if (memoUpsertError) throw memoUpsertError;
  }

  return {
    synced: true,
    date,
    insertedCount: upsertPayload.length,
    therapistCount: slotCount,
  };
}
