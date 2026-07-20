export function normalizeHistoryPatientName(value) {
  return String(value || '').replace(/\*/g, '').trim();
}

export function normalizeHistoryChartNumber(value) {
  return String(value || '').trim();
}

export function isSameHistoryPatient(current, past) {
  const currentChart = normalizeHistoryChartNumber(current?.chart_number);
  const pastChart = normalizeHistoryChartNumber(past?.chart_number);
  if (currentChart) return pastChart === currentChart;

  const currentName = normalizeHistoryPatientName(current?.patient_name);
  const pastName = normalizeHistoryPatientName(past?.patient_name);
  return Boolean(currentName && pastName && currentName === pastName);
}

export function getPastLogsForPatient(current, pastData, todayDate) {
  const targetDate = String(todayDate || '');
  return (pastData || []).filter((past) => {
    const pastDate = String(past?.date || '');
    return (
      pastDate &&
      (!targetDate || pastDate < targetDate) &&
      isSameHistoryPatient(current, past)
    );
  });
}

export function sortPastLogsLatestFirst(logs) {
  return [...(logs || [])].sort((a, b) => {
    const dateCompare = String(b?.date || '').localeCompare(String(a?.date || ''));
    if (dateCompare !== 0) return dateCompare;
    return (parseInt(String(b?.visit_count || '0'), 10) || 0) -
      (parseInt(String(a?.visit_count || '0'), 10) || 0);
  });
}
