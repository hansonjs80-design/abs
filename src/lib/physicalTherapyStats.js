import { generateCalendarGrid } from './calendarUtils.js';
import { getPTCalendarCount, getPTCountDisplayMemo } from './ptStaffCalendarCounts.js';

// Use the exact last-row display rule from StaffCalendar, without writing either source.
export function getPTStatsWeeks(year, month, memos, slotSettings, pt = {}) {
  return generateCalendarGrid(year, month).grid.map((week, wi) => {
    const slot = (Number(slotSettings?.week_slot_counts?.[String(wi)]) || 6) - 1;
    return week.map(day => {
      if (!day.isCurrentMonth) return null;
      const key = `${year}-${month}-${day.day}-${slot}`;
      const date = `${year}-${String(month).padStart(2, '0')}-${String(day.day).padStart(2, '0')}`;
      const count = getPTCalendarCount(pt.counts || {}, pt.settings, date);
      const memo = getPTCountDisplayMemo(memos[key], count, pt.overrides?.[date], key);
      const match = String(memo?.content || '').trim().match(/^(\d+|\d{1,3}(?:,\d{3})+)\s*명?$/);
      return { day: day.day, dow: day.dow, value: match ? Number(match[1].replaceAll(',', '')) : null };
    });
  });
}

export async function fetchPTStatsYear(client, year, signal) {
  const memos = {};
  // A whole year's staff memos exceed the API row limit; read every page in stable order.
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await client.from('staff_schedules')
      .select('year,month,day,slot_index,content').eq('year', year)
      .order('month').order('day').order('slot_index').range(offset, offset + 999).abortSignal(signal);
    if (error) throw error;
    for (const row of data || []) memos[`${year}-${row.month}-${row.day}-${row.slot_index}`] = row;
    if ((data || []).length < 1000) break;
  }
  const { data, error } = await client.from('staff_calendar_settings')
    .select('year,month,week_slot_counts').gte('year', year - 1).lte('year', year)
    .order('year').order('month').limit(24).abortSignal(signal);
  if (error) throw error;
  const settings = {};
  for (let month = 1; month <= 12; month++) {
    const current = data?.find(row => row.year === year && row.month === month);
    const previous = data?.find(row => row.year === (month === 1 ? year - 1 : year) && row.month === (month === 1 ? 12 : month - 1));
    settings[month] = current || previous || null;
  }
  return { memos, settings };
}
