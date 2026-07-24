import { normalizeNameForMatch } from './nameMatchUtils.js';

function comparePatientLogRecency(a, b) {
  const dateCompare = String(b?.date || '').localeCompare(String(a?.date || ''));
  if (dateCompare !== 0) return dateCompare;

  const aVisit = Number.parseInt(a?.visit_count || '0', 10) || 0;
  const bVisit = Number.parseInt(b?.visit_count || '0', 10) || 0;
  if (aVisit !== bVisit) return bVisit - aVisit;

  return String(b?.created_at || '').localeCompare(String(a?.created_at || ''));
}

export function buildShockwavePatientHistoryIndex(logs = []) {
  const logsByPatientName = new Map();
  let latestDate = '';

  (Array.isArray(logs) ? logs : []).forEach((log) => {
    if (!log) return;
    const date = String(log.date || '');
    if (date > latestDate) latestDate = date;

    const normalizedName = normalizeNameForMatch(log.patient_name);
    if (!normalizedName) return;
    const patientLogs = logsByPatientName.get(normalizedName) || [];
    patientLogs.push(log);
    logsByPatientName.set(normalizedName, patientLogs);
  });

  logsByPatientName.forEach((patientLogs) => {
    patientLogs.sort(comparePatientLogRecency);
  });

  return { latestDate, logsByPatientName };
}

export function findLatestPatientHistoryLog(index, patientName, excludedId) {
  const normalizedName = normalizeNameForMatch(patientName);
  if (!normalizedName) return null;
  const patientLogs = index?.logsByPatientName?.get(normalizedName) || [];
  return patientLogs.find((log) => log?.id !== excludedId) || null;
}
