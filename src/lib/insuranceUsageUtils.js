import { generateShockwaveCalendar } from './calendarUtils.js';
import { getScheduleItemTreatmentGroup } from './prescriptionScheduleSettings.js';
import { parseSchedulerPatientIdentity } from './schedulerCellTextUtils.js';
import { getScheduleDayDateKey, getScheduleRowSchedulerCellKey } from './schedulerHistoryCandidateUtils.js';
import { isTreatmentCancelBg } from './scheduleStatusUtils.js';

// Clinic tracking rule, not an insurer's coverage/claim determination.
export const INSURANCE_USAGE_COLORS = { shockwave: '#2563eb', manual: '#92400e' };
export const INSURANCE_USAGE_LABELS = { shockwave: '충격파', manual: '도수치료' };
export const INSURANCE_USAGE_START_DATE = '2026-07-01';
export function getInsurancePatient(row = {}) {
  const parsed = parseSchedulerPatientIdentity(row.content || '');
  const chart = String(row.chart_number ?? parsed.patientChart ?? '').trim();
  const name = String(row.patient_name ?? parsed.patientName ?? '').replace(/\*/g, '').trim();
  return { chart, name, key: chart && name ? JSON.stringify([chart, name]) : '' };
}

export function isInsuranceSelfPay(prescription) {
  return /\(\s*본인\s*\)/.test(String(prescription || '').normalize('NFKC'));
}

export function normalizeInsuranceRecord(row, settings) {
  if (!row) return null;
  const patient = getInsurancePatient(row);
  if (!patient.key) return null;
  const isSchedule = row.week_index != null;
  const day = isSchedule
    ? generateShockwaveCalendar(Number(row.year), Number(row.month))?.[Number(row.week_index)]?.[Number(row.day_index)]
    : null;
  // Adjacent-month calendar cells are representations, not extra appointments.
  if (isSchedule && !day?.isCurrentMonth) return null;
  const date = isSchedule ? getScheduleDayDateKey(day) : String(row.date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const group = getScheduleItemTreatmentGroup(row, settings, Number(date.slice(0, 4)), Number(date.slice(5, 7)))
    || ({ manual: 'manual_therapy', shockwave: 'shockwave', shinjang: 'shinjang_spray' }[row.history_group || row.type]);
  const prescription = String(row.prescription || '').normalize('NFKC');
  const shinjangDose = prescription.match(/\d+(?:\.\d+)?/g);
  const category = group === 'shinjang_spray'
    ? (shinjangDose?.length === 1 ? (shinjangDose[0].includes('.') ? 'shockwave' : 'manual') : '')
    : ({ manual_therapy: 'manual', shockwave: 'shockwave' }[group] || '');
  if (!category) return null;
  const key = isSchedule ? getScheduleRowSchedulerCellKey(row)
    : row.scheduler_cell_key || `${row.type || row.history_group}:${row.id}`;
  const excluded = Boolean(row.merge_span?.mergedInto || isTreatmentCancelBg(row.bg_color) || row.cancelled);
  return {
    key, date, patient: patient.key, category, prescription, group,
    order: isSchedule ? Number(row.row_index) * 1000 + Number(row.col_index) : Number(row.sort_index ?? 1e9),
    contributes: date >= INSURANCE_USAGE_START_DATE && !excluded && group !== 'shinjang_spray' && !isInsuranceSelfPay(prescription),
    excluded,
    selfPay: isInsuranceSelfPay(prescription),
    visit: String(row.visit_count || ''),
  };
}

export function buildInsuranceRecords({ scheduleRows = [], historyLogs = [], settings } = {}) {
  const schedule = scheduleRows.map((row) => normalizeInsuranceRecord(row, settings)).filter(Boolean);
  const records = new Map(schedule.map((row) => [row.key, row]));
  const fingerprint = (row) => JSON.stringify([row.patient, row.date, row.group, row.prescription]);
  const scheduleFingerprints = new Set(schedule.map(fingerprint));
  for (const log of historyLogs) {
    // Scheduler-linked logs mirror the schedule; deleted/cancelled cells must not reappear.
    if (log.scheduler_cell_key || log.source === 'scheduler') continue;
    const row = normalizeInsuranceRecord(log, settings);
    if (!row || scheduleFingerprints.has(fingerprint(row))) continue;
    records.set(row.key, row);
  }
  return [...records.values()];
}

function anniversary(anchor, year) {
  const month = Number(anchor.slice(5, 7));
  const day = Math.min(Number(anchor.slice(8, 10)), new Date(Date.UTC(year, month, 0)).getUTCDate());
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function getInsuranceUsage(records, targetRow, settings) {
  const target = normalizeInsuranceRecord(targetRow, settings);
  if (!target) return null;
  const existing = records.find((row) => row.key === target.key)
    || records.find((row) => row.patient === target.patient && row.date === target.date
      && row.group === target.group && row.prescription === target.prescription
      && targetRow.week_index == null && !targetRow.scheduler_cell_key);
  if (existing) {
    target.key = existing.key;
    target.order = existing.order;
    if (existing.excluded) target.contributes = false;
  }
  // A proposed edit replaces its own cell, so neither editing nor cut/paste adds a duplicate.
  const candidates = records.filter((row) => row.key !== target.key
    && row.patient === target.patient && row.category === target.category);
  candidates.push(target);
  const chronological = candidates.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order || a.key.localeCompare(b.key));
  const year = Number(target.date.slice(0, 4));
  const first = chronological.find((row) => row.contributes && row.date <= target.date);
  const empty = { category: target.category, count: 0, selfPay: target.selfPay, periodStart: '', periodEnd: '' };
  if (target.date < INSURANCE_USAGE_START_DATE) return empty;
  if (!first && target.category !== 'manual') return empty;
  const periodYear = target.category === 'manual' ? year : target.date >= anniversary(first.date, year) ? year : year - 1;
  const periodStart = target.category === 'manual' ? `${year}-01-01` : anniversary(first.date, periodYear);
  const periodEnd = target.category === 'manual' ? `${year + 1}-01-01` : anniversary(first.date, periodYear + 1);
  const targetIndex = chronological.findIndex((row) => row.key === target.key);
  const count = chronological.slice(0, targetIndex + 1).filter((row) => row.contributes && row.date >= periodStart && row.date < periodEnd).length;
  return { category: target.category, count, selfPay: target.selfPay, periodStart, periodEnd };
}

export function localInsuranceScheduleRows(memos, year, month) {
  return Object.entries(memos || {}).map(([key, memo]) => {
    const [week_index, day_index, row_index, col_index] = key.split('-').map(Number);
    return { ...memo, year, month, week_index, day_index, row_index, col_index };
  });
}

export function overlayInsuranceScheduleRows(...sources) {
  const rows = new Map();
  sources.flat().forEach((row) => rows.set(getScheduleRowSchedulerCellKey(row), row));
  return [...rows.values()];
}
