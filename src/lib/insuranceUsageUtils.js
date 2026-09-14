import { generateShockwaveCalendar } from './calendarUtils.js';
import { getPrescriptionFromConfiguredDoseTag, getScheduleItemTreatmentGroup } from './prescriptionScheduleSettings.js';
import { getExplicitVisitSuffix, parseSchedulerPatientIdentity } from './schedulerCellTextUtils.js';
import { getScheduleDayDateKey, getScheduleRowSchedulerCellKey } from './schedulerHistoryCandidateUtils.js';
import { isTreatmentCancelBg } from './scheduleStatusUtils.js';
import { BODY_PART_PRESET_GROUPS } from './bodyPartPresetUtils.js';

export function getInsuranceBodyPart(value) {
  const label = String(value || '').normalize('NFKC').replace(/^\s*[•·]\s*/, '').trim();
  const compact = label.toLowerCase().replace(/\s/g, '');
  const diagnosis = compact.replace(/^(?:lt\.?|rt\.?|both\.?)/, '').replace(/\([^)]*\)/g, '');
  if (/^(?:경추근막통(?:증)?|요추\/(?:척추부|천추부)근막통(?:증)?)$/.test(diagnosis)) return '척추';
  for (const group of BODY_PART_PRESET_GROUPS) {
    if (group.items.some((item) => [item.label, ...(item.aliases || [])]
      .some((name) => diagnosis === name.toLowerCase().replace(/\s/g, '')))) return group.label;
  }
  const aliases = { shoulder: '어깨', elbow: '팔꿈치', hip: '고관절', knee: '무릎', 슬관절: '무릎', ankle: '발목', 발목관절: '발목', foot: '족부', cervical: '목', lumbar: '허리', spine: '척추', 척추부: '척추' };
  return aliases[compact] || label.replace(/\([^)]*\)/g, '').trim();
}

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

export function getShinjangSprayInsuranceCategory(prescription) {
  const text = String(prescription || '').normalize('NFKC').trim();
  const doseMatches = text.match(/\d+(?:\.\d+)?/g);
  if (doseMatches?.length === 1 && doseMatches[0].includes('.')) {
    return 'shockwave';
  }
  if (
    /신장분사.*[cC]/i.test(text)
    || /(?:^|[^a-zA-Z0-9가-힣])[cC](?:$|[^a-zA-Z0-9가-힣])/i.test(text)
    || /cryo|크라이오/i.test(text)
    || /[cC]/i.test(text)
  ) {
    return 'shockwave';
  }
  if (doseMatches?.length === 1) {
    return 'manual';
  }
  return 'shockwave';
}

export function normalizeInsuranceRecord(row, settings, allowAdjacentMonth = false) {
  if (!row) return null;
  const patient = getInsurancePatient(row);
  if (!patient.key) return null;
  const year = Number(row.year || (row.date && String(row.date).slice(0, 4)));
  const month = Number(row.month || (row.date && String(row.date).slice(5, 7)));
  const isSchedule = row.week_index != null && Number.isFinite(year) && Number.isFinite(month);
  const day = isSchedule
    ? generateShockwaveCalendar(year, month)?.[Number(row.week_index)]?.[Number(row.day_index)]
    : null;
  // Adjacent-month calendar cells are representations, not extra appointments.
  if (isSchedule && day && !day.isCurrentMonth && !allowAdjacentMonth) return null;
  const date = isSchedule && day ? getScheduleDayDateKey(day) : String(row.date || '').slice(0, 10);
  if (!/\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const group = getScheduleItemTreatmentGroup(row, settings, Number(date.slice(0, 4)), Number(date.slice(5, 7)))
    || ({ manual: 'manual_therapy', shockwave: 'shockwave', shinjang: 'shinjang_spray' }[row.history_group || row.type]);
  const prescription = String(
    row.prescription
    || (settings && getPrescriptionFromConfiguredDoseTag(settings, Number(date.slice(0, 4)), Number(date.slice(5, 7)), row.content))
    || ''
  ).normalize('NFKC');
  const category = group === 'shinjang_spray'
    ? getShinjangSprayInsuranceCategory(prescription)
    : ({ manual_therapy: 'manual', shockwave: 'shockwave' }[group] || '');
  if (!category) return null;
  const key = isSchedule ? getScheduleRowSchedulerCellKey(row)
    : row.scheduler_cell_key || `${row.type || row.history_group}:${row.id}`;
  const excluded = Boolean(row.merge_span?.mergedInto || isTreatmentCancelBg(row.bg_color) || row.cancelled);
  return {
    key, date, patient: patient.key, category, prescription, group, isSchedule,
    adjacentMonth: isSchedule && Boolean(day && !day.isCurrentMonth),
    bodyParts: [...new Set(String(row.body_part || '').normalize('NFKC').split(/[,\r\n]+/)
      .map(getInsuranceBodyPart)
      .filter(Boolean))],
    order: isSchedule ? Number(row.row_index) * 1000 + Number(row.col_index) : Number(row.sort_index ?? 1e9),
    contributes: date >= INSURANCE_USAGE_START_DATE && !excluded && (!isSchedule || /^\d+$/.test(getExplicitVisitSuffix(row.content || '').replace(/[()]/g, ''))) && group !== 'shinjang_spray' && !isInsuranceSelfPay(prescription),
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

export function getInsuranceUsage(records, targetRow, settings, categoryOverride) {
  const target = normalizeInsuranceRecord(targetRow, settings, true);
  if (!target) return null;
  const existing = records.find((row) => row.key === target.key)
    || records.find((row) => row.patient === target.patient && row.date === target.date
      && ((target.adjacentMonth && row.order === target.order)
        || (row.isSchedule && row.group === target.group && row.prescription === target.prescription
          && targetRow.week_index == null && !targetRow.scheduler_cell_key)));
  if (existing) {
    target.key = existing.key;
    target.order = existing.order;
    if (existing.excluded) target.contributes = false;
  }
  if (categoryOverride && target.category !== categoryOverride) {
    target.category = categoryOverride;
    target.contributes = false;
    target.group = 'shinjang_spray';
  }
  // A proposed edit replaces its own cell, so neither editing nor cut/paste adds a duplicate.
  const candidates = records.filter((row) => row.key !== target.key
    && row.patient === target.patient && row.category === target.category);
  candidates.push(target);
  const chronological = candidates.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order || a.key.localeCompare(b.key));
  const year = Number(target.date.slice(0, 4));
  const targetIndex = chronological.findIndex((row) => row.key === target.key);
  const preceding = chronological.slice(0, targetIndex + 1);
  const first = preceding.find((row) => row.contributes);
  const isShinjang = target.group === 'shinjang_spray';
  const empty = { category: target.category, count: 0, selfPay: target.selfPay, periodStart: '', periodEnd: '', isShinjang, hasHistory: false };
  if (target.date < INSURANCE_USAGE_START_DATE) return empty;
  if (!first && target.category !== 'manual') return empty;
  const periodYear = target.category === 'manual' ? year : target.date >= anniversary(first.date, year) ? year : year - 1;
  const periodStart = target.category === 'manual' ? `${year}-01-01` : anniversary(first.date, periodYear);
  const periodEnd = target.category === 'manual' ? `${year + 1}-01-01` : anniversary(first.date, periodYear + 1);
  const eligible = preceding.filter((row) => row.contributes && row.date >= periodStart && row.date < periodEnd);
  const count = eligible.length;
  const parts = new Map();
  if (target.category === 'shockwave') {
    for (const row of eligible) {
      for (const label of row.bodyParts?.length ? row.bodyParts : ['부위 미입력']) {
        const key = label.toLowerCase().replace(/\s/g, '');
        const entry = parts.get(key) || { key, label, count: 0, limit: 6 };
        entry.count += 1;
        parts.set(key, entry);
      }
    }
  }
  const bodyParts = [...parts.values()];
  const limit = target.category === 'manual' ? 15 : bodyParts.length > 1 ? 12 : 6;
  const targetParts = target.bodyParts.length ? target.bodyParts : ['부위 미입력'];
  const targetKeys = new Set(targetParts.map((label) => label.toLowerCase().replace(/\s/g, '')));
  const exceededParts = bodyParts.filter((part) => part.count > part.limit && targetKeys.has(part.key));
  return { category: target.category, count, limit, bodyParts, exceededParts,
    overLimit: count > limit || exceededParts.length > 0,
    selfPay: target.selfPay, periodStart, periodEnd, isShinjang, hasHistory: Boolean(first) };
}

export function formatInsuranceUsage(usage, showLimit = false) {
  if (usage.category !== 'shockwave') return showLimit ? `${usage.count}회(${usage.count}/15)` : `${usage.count}회`;
  const parts = usage.bodyParts || [];
  if (!parts.length) return `${usage.count}회`;
  const total = usage.count > 12 ? `${usage.count}/12회` : `${usage.count}회`;
  return `${total}(${parts.map((part) => `${part.label} ${part.count}/6`).join(', ')})`;
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
