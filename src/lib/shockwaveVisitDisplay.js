import { normalizeNameForMatch } from './nameMatchUtils.js';
import { getEffectiveShinjangSpraySettings } from './settlementSettings.js';
import { normalizePrescriptionKey } from './shockwaveStatsCountUtils.js';
import { getPatientHistoryTreatmentGroup } from './patientHistoryModalUtils.js';
import { isShinjangSprayPrescription } from './shinjangSprayStatsUtils.js';

const identity = (row) => String(row.chart_number || '').trim()
  ? `chart:${String(row.chart_number).trim()}` : `name:${normalizeNameForMatch(row.patient_name)}`;
const bodyKey = (value) => String(value || '').normalize('NFKC').toLowerCase().split(/[,\n]+/).map((part) => part.replace(/\s+/g, '')).filter(Boolean).sort().join('|');
const visitNumber = (value) => String(value).trim() === '*' ? 1 : /^\d+$/.test(String(value).trim()) ? Number(value) : null;
const label = (visit, shinjang) => `${visit}회${shinjang ? `(신장분사${shinjang}회)` : ''}`;

// A treatment series requires the same patient, exact body parts, and consecutive
// recorded visit numbers. Shinjang is a subset of that sequence, never an addition.
export function buildShockwaveVisitDisplay(rows, history, settings) {
  const groups = new Map();
  const monthRates = new Map();
  const merged = new Map();
  for (const row of [...history, ...rows]) {
    const key = row.scheduler_cell_key || `${row._table || 'shockwave_patient_logs'}:${row.id}`;
    if (!merged.has(key) || !merged.get(key)._schedule) merged.set(key, row);
  }
  for (const row of merged.values()) {
    const body = bodyKey(row.body_part);
    if (!row.date || !body || row._excluded) continue;
    const month = row.date.slice(0, 7);
    const [year, monthNumber] = month.split('-').map(Number);
    if (!monthRates.has(month)) {
      const effective = getEffectiveShinjangSpraySettings(settings, year, monthNumber);
      monthRates.set(month, new Map(Object.entries(effective.prescription_incentive_percentages || {}).map(([key, value]) => [normalizePrescriptionKey(key), Number(value)])));
    }
    const isShinjang = isShinjangSprayPrescription(row.prescription);
    const isShinjang7 = isShinjang && monthRates.get(month).get(normalizePrescriptionKey(row.prescription)) === 7;
    const treatment = getPatientHistoryTreatmentGroup({ ...row, type: row._table === 'manual_therapy_patient_logs' ? 'manual' : 'shockwave', settings, year, month: monthNumber });
    const allowed = isShinjang7 || (!isShinjang && treatment === 'shockwave');
    const patient = identity(row);
    if (patient === 'name:') continue;
    const key = `${patient}:${body}`;
    const group = groups.get(key) || [];
    group.push({ ...row, visit: visitNumber(row.visit_count), isShinjang7, allowed });
    groups.set(key, group);
  }
  const byRow = {};
  const latestByRow = {};
  const rowKeys = new Map(rows.map((row) => [row.scheduler_cell_key || `shockwave_patient_logs:${row.id}`, row]));
  const getSourceId = (row) => {
    const source = rowKeys.get(row.scheduler_cell_key || `${row._table || 'shockwave_patient_logs'}:${row.id}`);
    return source && identity(source) === identity(row) && bodyKey(source.body_part) === bodyKey(row.body_part) ? source.id : undefined;
  };
  for (const group of groups.values()) {
    group.sort((a, b) => a.date.localeCompare(b.date) || (a.visit || 0) - (b.visit || 0));
    let series = [];
    const finish = () => {
      let shinjang = 0;
      const counted = new Set();
      for (const row of series) {
        const key = `${row.date}:${row.visit}`;
        if (row.isShinjang7 && !counted.has(key)) { shinjang++; counted.add(key); }
        const id = getSourceId(row);
        if (id !== undefined && shinjang > 0) byRow[id] = label(row.visit, shinjang);
      }
      if (shinjang > 0) for (const row of series) {
        const id = getSourceId(row);
        if (id !== undefined) latestByRow[id] = label(series.at(-1).visit, shinjang);
      }
      series = [];
    };
    for (const row of group) {
      const prev = series.at(-1);
      const connected = prev && (row.visit === prev.visit + 1 || (row.visit === prev.visit && row.date === prev.date));
      if (!row.allowed || !row.visit || (prev && !connected)) finish();
      if (row.allowed && row.visit) series.push(row);
    }
    finish();
  }
  return { byRow, latestByRow };
}
