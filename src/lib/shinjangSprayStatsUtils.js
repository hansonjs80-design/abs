import {
  normalizePrescriptionKey,
  statsPrescriptionsMatch,
  toStatsPrescriptionCount,
} from './shockwaveStatsCountUtils.js';

function normalizeMarkerText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('ko-KR')
    .replace(/\s+/g, '');
}

function getTimestamp(row) {
  const value = Date.parse(row?.created_at || '');
  return Number.isFinite(value) ? value : 0;
}

function buildFallbackRowKey(row, sourceType, index) {
  if (row?.id !== undefined && row?.id !== null && String(row.id).trim()) {
    return `${sourceType}:id:${row.id}`;
  }
  return [
    sourceType,
    row?.date,
    row?.therapist_name,
    row?.chart_number || row?.patient_name,
    normalizePrescriptionKey(row?.prescription),
    index,
  ].join(':');
}

function getNormalizedMapValue(values, prescription) {
  const entries = values && typeof values === 'object' && !Array.isArray(values)
    ? Object.entries(values)
    : [];
  const match = entries.find(([configuredPrescription]) => (
    statsPrescriptionsMatch(configuredPrescription, prescription)
  ));
  return match?.[1];
}

export function isShinjangSprayPrescription(value) {
  return normalizeMarkerText(value).includes('(신장분사)');
}

export function mergeShinjangSprayLogs({
  shockwaveRows = [],
  manualTherapyRows = [],
  shockwavePrescriptionPrices = {},
  manualTherapyPrescriptionPrices = {},
} = {}) {
  const candidates = [
    ...(Array.isArray(shockwaveRows) ? shockwaveRows : []).map((row) => ({
      ...row,
      treatment_type: 'shockwave',
      unit_price: Math.max(0, Number(getNormalizedMapValue(
        shockwavePrescriptionPrices,
        row?.prescription
      )) || 0),
    })),
    ...(Array.isArray(manualTherapyRows) ? manualTherapyRows : []).map((row) => ({
      ...row,
      treatment_type: 'manual_therapy',
      unit_price: Math.max(0, Number(getNormalizedMapValue(
        manualTherapyPrescriptionPrices,
        row?.prescription
      )) || 0),
    })),
  ].filter((row) => isShinjangSprayPrescription(row?.prescription));
  const rowsByKey = new Map();

  candidates.forEach((row, index) => {
    const schedulerCellKey = String(row?.scheduler_cell_key || '').trim();
    const key = schedulerCellKey
      ? `schedule:${schedulerCellKey}`
      : buildFallbackRowKey(row, row.treatment_type, index);
    const existing = rowsByKey.get(key);
    if (!existing || getTimestamp(row) >= getTimestamp(existing)) {
      rowsByKey.set(key, row);
    }
  });

  return [...rowsByKey.values()].sort((a, b) => (
    String(a?.date || '').localeCompare(String(b?.date || ''))
      || String(a?.therapist_name || '').localeCompare(String(b?.therapist_name || ''), 'ko-KR')
      || getTimestamp(a) - getTimestamp(b)
  ));
}

export function buildShinjangSprayPrescriptions({
  configuredPrescriptions = [],
  rows = [],
} = {}) {
  const prescriptionsByKey = new Map();
  const add = (value) => {
    const prescription = String(value || '').trim();
    if (!isShinjangSprayPrescription(prescription)) return;
    const key = normalizePrescriptionKey(prescription);
    if (!key || prescriptionsByKey.has(key)) return;
    prescriptionsByKey.set(key, prescription);
  };

  (Array.isArray(configuredPrescriptions) ? configuredPrescriptions : []).forEach(add);
  (Array.isArray(rows) ? rows : []).forEach((row) => add(row?.prescription));
  return [...prescriptionsByKey.values()];
}

export function buildShinjangSpraySettlementSummary({
  rows = [],
  prescriptions = [],
  therapists = [],
  prescriptionPrices = {},
  incentivePercentages = {},
} = {}) {
  const safeRows = Array.isArray(rows) ? rows.filter(Boolean) : [];
  const safePrescriptions = Array.isArray(prescriptions) ? prescriptions.filter(Boolean) : [];
  const safeTherapists = Array.isArray(therapists)
    ? therapists.filter((therapist) => therapist?.name)
    : [];
  const detailRows = [];

  safeTherapists.forEach((therapist) => {
    safePrescriptions.forEach((prescription) => {
      const matchingRows = safeRows.filter((row) => (
        row?.therapist_name === therapist.name
        && statsPrescriptionsMatch(row?.prescription, prescription)
      ));
      const count = matchingRows.reduce(
        (sum, row) => sum + toStatsPrescriptionCount(row?.prescription_count),
        0
      );
      if (count <= 0) return;

      const configuredUnitPrice = Math.max(
        0,
        Number(getNormalizedMapValue(prescriptionPrices, prescription)) || 0
      );
      const amount = matchingRows.reduce((sum, row) => {
        const rowCount = toStatsPrescriptionCount(row?.prescription_count);
        const unitPrice = Number.isFinite(Number(row?.unit_price))
          ? Math.max(0, Number(row.unit_price))
          : configuredUnitPrice;
        return sum + (rowCount * unitPrice);
      }, 0);
      const incentivePercentage = Math.max(
        0,
        Number(getNormalizedMapValue(incentivePercentages, prescription)) || 0
      );
      const incentive = Math.round(amount * incentivePercentage / 100);
      const treatmentTypes = [...new Set(
        matchingRows.map((row) => row?.treatment_type).filter(Boolean)
      )];
      const rowUnitPrices = [...new Set(
        matchingRows.map((row) => (
          Number.isFinite(Number(row?.unit_price))
            ? Math.max(0, Number(row.unit_price))
            : configuredUnitPrice
        ))
      )];

      detailRows.push({
        therapist: {
          ...therapist,
          id: therapist.key || therapist.id || therapist.name,
          displayName: therapist.displayName || therapist.name,
        },
        prescription,
        count,
        treatmentTypes,
        unitPrice: rowUnitPrices.length === 1 ? rowUnitPrices[0] : configuredUnitPrice,
        hasMixedUnitPrices: rowUnitPrices.length > 1,
        amount,
        incentivePercentage,
        incentive,
      });
    });
  });

  return {
    detailRows,
    grandTotalCount: detailRows.reduce((sum, row) => sum + row.count, 0),
    grandAmount: detailRows.reduce((sum, row) => sum + row.amount, 0),
    grandIncentive: detailRows.reduce((sum, row) => sum + row.incentive, 0),
  };
}
