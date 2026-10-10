// Read-only integration. Staff memos are never updated by this module.
export const PT_STAFF_COUNT_SETTINGS_RECORD = '__pt_staff_calendar_count_settings_v1__';

export function isPTCountDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function normalizePTCountSettings(value) {
  if (!value || !['today', 'all', 'from'].includes(value.scope)) return null;
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') return null;
  if (value.scope !== 'all' && !isPTCountDate(value.startDate)) return null;
  return { enabled: value.enabled !== false, scope: value.scope, startDate: value.scope === 'all' ? null : value.startDate };
}

export function getPTCalendarCount(counts, settings, date) {
  const normalized = normalizePTCountSettings(settings);
  if (!normalized || !normalized.enabled || !isPTCountDate(date) || (normalized.startDate && date < normalized.startDate)) return null;
  const count = counts[date];
  return Number.isInteger(count) && count >= 0 ? count : null;
}

export async function fetchPTCalendarCounts(client, startDate, endDate, signal) {
  if (!isPTCountDate(startDate) || !isPTCountDate(endDate)) throw new Error('Invalid calendar range');
  const settingsQuery = client.from('pt_daily_records').select('rows_data')
    .eq('date', PT_STAFF_COUNT_SETTINGS_RECORD).limit(1).abortSignal(signal);
  const settingsResult = await settingsQuery;
  if (settingsResult.error) throw settingsResult.error;
  const settings = normalizePTCountSettings(settingsResult.data?.[0]?.rows_data?.[0]?.staffCalendarCounts);
  // Continue polling only the scope while disabled so re-enabling is noticed.
  if (!settings || !settings.enabled) return { counts: {}, settings };
  const countsQuery = client.from('pt_daily_records').select('date,total_count')
    .gte('date', startDate).lte('date', endDate).order('date').limit(100).abortSignal(signal);
  const countsResult = await countsQuery;
  if (countsResult.error) throw countsResult.error;
  const counts = {};
  for (const record of countsResult.data || []) {
    if (isPTCountDate(record.date) && Number.isInteger(record.total_count) && record.total_count >= 0) {
      counts[record.date] = record.total_count;
    }
  }
  return { counts, settings };
}

export function getPTCountDisplayMemo(memo, count) {
  if (count === null) return memo;
  return { ...memo, content: `${count}명` };
}
