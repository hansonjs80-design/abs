import { parseConfiguredManualTherapyEntry } from './manualTherapyEntryUtils.js';
import {
  getPrescriptionScheduleSettings,
  getScheduleItemTreatmentGroup,
  normalizePrescriptionGroupKey,
} from './prescriptionScheduleSettings.js';
import { getConfiguredDoseTagFromContent } from './schedulerContentFormat.js';
import { TREATMENT_COMPLETE_BG } from './schedulerUtils.js';

function normalizePrescriptionKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]/g, '');
}

function getPrescriptionDoseTags(prescriptions) {
  return (Array.isArray(prescriptions) ? prescriptions : [])
    .map((prescription) => {
      const match = String(prescription || '').match(/(\d{2,3})/);
      return match?.[1] || '';
    })
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
}

function parseSchedulerCellKey(value) {
  const parts = String(value || '').split(':');
  if (parts.length !== 6) return null;
  const [year, month, weekIndex, dayIndex, rowIndex, colIndex] = parts;
  if (!year || !month) return null;
  return {
    year: Number(year),
    month: Number(month),
    memoKey: [weekIndex, dayIndex, rowIndex, colIndex].join('-'),
  };
}

function getManualSchedulerPrescription(cell, settings, year, month) {
  const config = getPrescriptionScheduleSettings(settings, year, month);
  const manualPrescriptions = config.schedulerPrescriptions?.manualTherapy || [];
  const prescriptionByKey = new Map(
    manualPrescriptions.map((prescription) => [
      normalizePrescriptionGroupKey(prescription),
      prescription,
    ])
  );
  const explicitPrescription = prescriptionByKey.get(
    normalizePrescriptionGroupKey(cell?.prescription)
  );
  if (explicitPrescription) return explicitPrescription;

  const manualDoseTags = Object.fromEntries(
    manualPrescriptions
      .map((prescription) => [prescription, config.manualTherapy?.dose_tags?.[prescription]])
      .filter(([, doseTag]) => doseTag)
  );
  const contentDoseTag = getConfiguredDoseTagFromContent(cell?.content, manualDoseTags);
  if (!contentDoseTag) return '';

  return Object.entries(manualDoseTags).find(([, doseTag]) => (
    String(doseTag || '').toLowerCase() === String(contentDoseTag).toLowerCase()
  ))?.[0] || '';
}

function parseManualSchedulerContent(cell, prescriptions = [], options = {}) {
  const isCellObject = cell && typeof cell === 'object';
  const content = isCellObject ? cell.content : cell;
  const raw = String(content || '').trim();
  if (!raw) return null;

  const year = Number(options?.year);
  const month = Number(options?.month);
  const settings = options?.settings || {};
  if (isCellObject && year && month) {
    const treatmentGroup = getScheduleItemTreatmentGroup(cell, settings, year, month);
    if (treatmentGroup !== 'manual_therapy') return null;

    const configuredPrescription = getManualSchedulerPrescription(cell, settings, year, month);
    if (!configuredPrescription) return null;
    const config = getPrescriptionScheduleSettings(settings, year, month);
    const doseTag = config.manualTherapy?.dose_tags?.[configuredPrescription] || '';
    const parsed = parseConfiguredManualTherapyEntry(
      raw,
      '',
      configuredPrescription,
      doseTag
    );
    if (!parsed) return null;

    return {
      patient_name: parsed.patientName,
      chart_number: parsed.chartNumber,
      visit_count: parsed.visitCount,
      prescription: configuredPrescription,
      prescription_count: 1,
    };
  }

  let chartNumber = '';
  let namePart = raw;
  if (raw.includes('/')) {
    const [left, ...right] = raw.split('/');
    if (/\d/.test(left)) {
      chartNumber = left.trim();
      namePart = right.join('/').trim();
    }
  }

  let visitCount = '';
  let isNewMarked = false;
  const suffixMatch = namePart.match(/(\((-|\d+)\)|\*)\s*$/);
  if (suffixMatch) {
    const token = suffixMatch[1];
    visitCount = token === '*'
      ? '1'
      : suffixMatch[2] === '-'
        ? '-'
        : suffixMatch[2];
    isNewMarked = token === '*';
    namePart = namePart.slice(0, namePart.length - token.length).trim();
  }

  const activeDoseTags = getPrescriptionDoseTags(prescriptions);
  const explicitPrescription = isCellObject ? cell.prescription : '';
  const explicitDoseTag = activeDoseTags.find(
    (doseTag) => normalizePrescriptionKey(explicitPrescription) === normalizePrescriptionKey(`${doseTag}분`)
  );
  const matchedDoseTag = activeDoseTags.find((doseTag) => namePart.endsWith(doseTag)) || explicitDoseTag;
  if (!matchedDoseTag) return null;

  const patientName = namePart.endsWith(matchedDoseTag)
    ? namePart.slice(0, -matchedDoseTag.length).trim()
    : namePart.trim();
  if (!patientName) return null;

  return {
    patient_name: `${patientName}${isNewMarked ? '*' : ''}`,
    chart_number: chartNumber,
    visit_count: visitCount,
    prescription: `${matchedDoseTag}분`,
    prescription_count: 1,
  };
}

export function normalizeManualTherapyLogRow(row, prescriptions = []) {
  if (!row || typeof row !== 'object') return row;

  const rawName = String(row.patient_name || '');
  const hasNewMark = rawName.includes('*');
  const nameWithoutStar = rawName.replace(/\*/g, '').trim();
  if (!nameWithoutStar) return row;

  const activeDoseTags = getPrescriptionDoseTags(prescriptions);
  const matchedDoseTag = activeDoseTags.find((doseTag) => nameWithoutStar.endsWith(doseTag));
  if (!matchedDoseTag) return row;

  const cleanName = nameWithoutStar.slice(0, -matchedDoseTag.length).trim();
  if (!cleanName) return row;

  const inferredPrescription = `${matchedDoseTag}분`;
  const hasMatchingPrescription = normalizePrescriptionKey(row.prescription) === normalizePrescriptionKey(inferredPrescription);

  return {
    ...row,
    patient_name: `${cleanName}${hasNewMark ? '*' : ''}`,
    prescription: hasMatchingPrescription || !row.prescription ? inferredPrescription : row.prescription,
    prescription_count: row.prescription_count || (hasMatchingPrescription || !row.prescription ? 1 : row.prescription_count),
  };
}

export function normalizeManualTherapyLogRows(rows, prescriptions = [], options = {}) {
  const memos = options?.memos && typeof options.memos === 'object' ? options.memos : {};
  const year = Number(options?.year);
  const month = Number(options?.month);
  const scheduleAuthoritative = options?.scheduleAuthoritative === true;

  return (Array.isArray(rows) ? rows : []).map((row) => {
    const keyInfo = parseSchedulerCellKey(row?.scheduler_cell_key);
    const targetsSelectedMonth = Boolean(
      keyInfo &&
      (!year || keyInfo.year === year) &&
      (!month || keyInfo.month === month)
    );
    const scheduleCell = keyInfo
      && targetsSelectedMonth
      ? memos[keyInfo.memoKey]
      : null;
    const scheduleTreatmentGroup = scheduleCell
      ? getScheduleItemTreatmentGroup(scheduleCell, options?.settings || {}, keyInfo.year, keyInfo.month)
      : '';
    const isScheduleBackedRow = row?.source !== 'manual' && Boolean(
      row?.source === 'scheduler' || keyInfo
    );

    if (scheduleAuthoritative && isScheduleBackedRow) {
      const isCompleted = String(scheduleCell?.bg_color || '').toLowerCase()
        === TREATMENT_COMPLETE_BG.toLowerCase();
      if (!targetsSelectedMonth || !scheduleCell || !isCompleted || scheduleTreatmentGroup !== 'manual_therapy') {
        return null;
      }
    }
    if (scheduleCell && scheduleTreatmentGroup === 'shockwave') return null;

    const scheduleOverride = scheduleCell
      ? parseManualSchedulerContent(scheduleCell, prescriptions, {
          settings: options?.settings,
          year: keyInfo.year,
          month: keyInfo.month,
        })
      : null;
    if (scheduleAuthoritative && isScheduleBackedRow && !scheduleOverride) return null;
    const normalized = normalizeManualTherapyLogRow(row, prescriptions);

    if (!scheduleOverride) return normalized;

    return {
      ...normalized,
      ...scheduleOverride,
      chart_number: scheduleOverride.chart_number || normalized.chart_number || '',
      body_part: scheduleCell.body_part || normalized.body_part || '',
    };
  }).filter(Boolean);
}
