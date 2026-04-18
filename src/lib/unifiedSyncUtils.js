import { supabase } from './supabaseClient';
import { generateShockwaveCalendar } from './calendarUtils';
import { formatStatsRowForScheduler } from './shockwaveSyncUtils';

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

  // 1. Fetch shockwave therapists to map col_index
  const { data: shockwaveTherapists, error: tError } = await supabase
    .from('shockwave_therapists')
    .select('*')
    .eq('is_active', true)
    .order('slot_index');

  if (tError) throw tError;

  const therapistIndexMap = new Map();
  shockwaveTherapists.forEach((t, index) => therapistIndexMap.set(t.name, index));
  const therapistCols = shockwaveTherapists.map((_, index) => index);

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
  const groupedByTherapist = Array.from({ length: shockwaveTherapists.length }, () => []);

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

  // 4. Update scheduler
  const { data: existingScheduleRows, error: existingScheduleError } = await supabase
    .from('shockwave_schedules')
    .select('row_index, col_index, content')
    .eq('year', year)
    .eq('month', month)
    .eq('week_index', targetWeekIndex)
    .eq('day_index', targetDayIndex)
    .in('col_index', therapistCols);

  if (existingScheduleError) throw existingScheduleError;

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
    const existingRowsForTherapist = (existingScheduleRows || []).filter(
      (row) => row?.col_index === therapistIndex
    );
    const placedRows = buildSchedulerRowPlacement(items, existingRowsForTherapist);

    placedRows.forEach(({ content, rowIndex, body_part, prescription }) => {
      rowsToInsert.push({
        year,
        month,
        week_index: targetWeekIndex,
        day_index: targetDayIndex,
        row_index: rowIndex,
        col_index: therapistIndex,
        content,
        body_part,
        prescription,
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
    therapistCount: shockwaveTherapists.length,
  };
}
