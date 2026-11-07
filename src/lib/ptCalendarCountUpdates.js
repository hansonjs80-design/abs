import { PT_STAFF_COUNT_SETTINGS_RECORD, isPTCountDate } from './ptStaffCalendarCounts.js';
import { PT_MANUAL_COUNT_PREFIX } from './ptManualCountOverrides.js';

export function isPTCalendarCountChangeRelevant(date, startDate, endDate) {
  if (date === PT_STAFF_COUNT_SETTINGS_RECORD) return true;
  if (typeof date !== 'string') return false;
  const targetDate = date.startsWith(PT_MANUAL_COUNT_PREFIX)
    ? date.slice(PT_MANUAL_COUNT_PREFIX.length) : date;
  return isPTCountDate(targetDate) && targetDate >= startDate && targetDate <= endDate;
}

// The PT app broadcasts only the changed date. Subscribing to postgres_changes
// without a filter would transfer the day's entire rows_data to every display.
// The hook's 30-second count query covers writers without broadcast support.
export function subscribePTCalendarCountChanges(client, startDate, endDate, refresh) {
  const channel = client.channel?.('pt-live-updates-v1');
  if (!channel) return null;
  channel.on('broadcast', { event: 'changed' }, ({ payload } = {}) => {
    if (isPTCalendarCountChangeRelevant(payload?.date, startDate, endDate)) refresh();
  });
  const receiveMetadata = ({ new: next, old: previous } = {}) => {
    if (isPTCalendarCountChangeRelevant(next?.date || previous?.date, startDate, endDate)) refresh();
  };
  channel.on('postgres_changes', {event:'*',schema:'public',table:'pt_daily_records',
    filter:`date=eq.${PT_STAFF_COUNT_SETTINGS_RECORD}`}, receiveMetadata);
  // ISO daily record keys start with digits and sort before this reserved
  // prefix. Only small metadata records can match, including on annual views.
  channel.on('postgres_changes', {event:'*',schema:'public',table:'pt_daily_records',
    filter:`date=gte.${PT_MANUAL_COUNT_PREFIX}${startDate}`}, receiveMetadata);
  channel.subscribe();
  return channel;
}
