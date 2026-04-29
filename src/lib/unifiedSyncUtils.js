export async function syncUnifiedStatsDateToScheduler({ year, month, date } = {}) {
  return {
    skipped: true,
    reason: 'stats_to_scheduler_disabled',
    year,
    month,
    date,
  };
}
