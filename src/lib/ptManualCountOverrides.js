// Metadata only: the actual manual text stays in staff_schedules.content.
import { isPTCountDate } from './ptStaffCalendarCounts.js';
export const PT_MANUAL_COUNT_PREFIX = '__pt_staff_manual_count_v1__';

export async function savePTManualCountOverride(client, date, memoKey, content, sourceCount, signal) {
  if (!isPTCountDate(date) || typeof memoKey !== 'string' || typeof content !== 'string' ||
      !Number.isInteger(sourceCount) || sourceCount < 0) throw new Error('Invalid manual count');
  const override = { memoKey, content, sourceCount, active: true, revision: `${Date.now()}-${Math.random()}` };
  const { error } = await client.from('pt_daily_records').upsert({
    date: PT_MANUAL_COUNT_PREFIX + date,
    rows_data: [override], total_count: 0, updated_at: new Date().toISOString(),
  }, { onConflict: 'date' }).abortSignal(signal);
  if (error) throw error;
  return override;
}

export async function loadPTManualCountOverrides(client, startDate, endDate, counts, signal, invalidated = new Set()) {
  const { data, error } = await client.from('pt_daily_records').select('date,rows_data')
    .gte('date', PT_MANUAL_COUNT_PREFIX + startDate).lte('date', PT_MANUAL_COUNT_PREFIX + endDate)
    .order('date').limit(100).abortSignal(signal);
  if (error) throw error;
  const overrides = {};
  let delayed = false;
  for (const record of data || []) {
    if (!record.date?.startsWith(PT_MANUAL_COUNT_PREFIX)) continue;
    const date = record.date.slice(PT_MANUAL_COUNT_PREFIX.length);
    const value = record.rows_data?.[0];
    if (!value || typeof value.memoKey !== 'string' || typeof value.content !== 'string' ||
        typeof value.active !== 'boolean' || typeof value.revision !== 'string' ||
        !Number.isInteger(value.sourceCount) || value.sourceCount < 0) continue;
    const signature = `${date}/${value.revision}`;
    const changed = Number.isInteger(counts[date]) && counts[date] !== value.sourceCount;
    if (value.active && (changed || invalidated.has(signature))) {
      invalidated.add(signature);
      overrides[date] = { ...value, active: false };
      // A count returning to an earlier value must not resurrect an old edit.
      // Compare the revision so another device's newer edit is never invalidated.
      try {
        const result = await client.from('pt_daily_records').update({ rows_data: [overrides[date]], updated_at: new Date().toISOString() })
          .eq('date', record.date).contains('rows_data', [{ revision: value.revision }]).abortSignal(signal);
        if (result.error) delayed = true;
      } catch { delayed = true; }
    } else overrides[date] = value;
  }
  return { overrides, delayed };
}
