import { getEffectiveSettlementSettings, getEffectiveShinjangSpraySettings } from './settlementSettings.js';
import { buildDisplayTherapists } from './therapistDisplayUtils.js';
import {
  buildCryoAdjustedPrescriptionPrices,
  buildManualTherapySettlementSummary,
  normalizePrescriptionKey,
} from './shockwaveStatsCountUtils.js';
import {
  applyMonthlyShinjangSprayTherapists,
  buildShinjangSprayDefaultTherapists,
  buildShinjangSprayPrescriptions,
  buildShinjangSpraySettlementSummary,
  isShinjangSprayPrescription,
  mergeShinjangSprayLogs,
} from './shinjangSprayStatsUtils.js';

export const COMBINED_STATS_TREATMENTS = Object.freeze([
  { key: 'shockwave', label: '충격파' },
  { key: 'shinjang_spray', label: '신장분사' },
  { key: 'manual_therapy', label: '도수치료' },
]);

function getMapValue(values, prescription) {
  const normalizedPrescription = normalizePrescriptionKey(prescription);
  const match = Object.entries(values || {}).find(([key]) => (
    normalizePrescriptionKey(key) === normalizedPrescription
  ));
  return match?.[1];
}

function getVisibleStandardPrescriptions(settings) {
  const hiddenKeys = new Set(
    (Array.isArray(settings?.hidden_prescriptions) ? settings.hidden_prescriptions : [])
      .map(normalizePrescriptionKey)
      .filter(Boolean)
  );

  return (Array.isArray(settings?.prescriptions) ? settings.prescriptions : [])
    .filter((prescription) => {
      const key = normalizePrescriptionKey(prescription);
      return key && !hiddenKeys.has(key) && !isShinjangSprayPrescription(prescription);
    });
}

function addTherapist(therapistsByName, therapist, index) {
  const name = String(therapist?.name || therapist?.therapist_name || '').trim();
  if (!name || therapistsByName.has(name)) return;
  therapistsByName.set(name, {
    ...therapist,
    id: therapist?.key || therapist?.id || `combined-therapist-${index}-${name}`,
    key: therapist?.key || therapist?.id || `combined-therapist-${index}-${name}`,
    name,
    displayName: therapist?.displayName || name,
  });
}

export function buildCombinedStatsTherapists({
  shockwaveTherapists = [],
  manualTherapists = [],
  monthlyShockwaveTherapists = [],
  monthlyManualTherapists = [],
  monthlyShinjangTherapists = [],
  shinjangTherapistNames = null,
  shinjangRows = [],
} = {}) {
  const therapistsByName = new Map();
  const defaultShinjangTherapists = buildShinjangSprayDefaultTherapists({
    shockwaveTherapists,
    manualTherapists,
  });
  const standardCandidates = [
    ...buildDisplayTherapists(shockwaveTherapists, monthlyShockwaveTherapists),
    ...buildDisplayTherapists(manualTherapists, monthlyManualTherapists),
  ];
  const configuredShinjangNames = Array.isArray(shinjangTherapistNames)
    ? new Set(shinjangTherapistNames.map((name) => String(name || '').trim()).filter(Boolean))
    : null;
  const shinjangCandidates = [
    ...buildDisplayTherapists(defaultShinjangTherapists, monthlyShinjangTherapists),
    ...(Array.isArray(shinjangRows)
      ? shinjangRows.map((row) => ({ name: row?.therapist_name }))
      : []),
  ].filter((therapist) => (
    !configuredShinjangNames
    || configuredShinjangNames.has(String(therapist?.name || therapist?.therapist_name || '').trim())
  ));

  [...standardCandidates, ...shinjangCandidates]
    .forEach((therapist, index) => addTherapist(therapistsByName, therapist, index));
  return [...therapistsByName.values()];
}

function buildStandardTreatmentSummary({
  rows,
  therapists,
  settings,
}) {
  const prescriptions = getVisibleStandardPrescriptions(settings);
  const prescriptionKeys = new Set(prescriptions.map(normalizePrescriptionKey));
  const visibleRows = (Array.isArray(rows) ? rows : []).filter((row) => (
    !isShinjangSprayPrescription(row?.prescription)
    && prescriptionKeys.has(normalizePrescriptionKey(row?.prescription))
  ));
  const cryoAdjustedPrices = buildCryoAdjustedPrescriptionPrices({
    prescriptionPrices: settings?.prescription_prices,
    cryoPrescriptions: settings?.cryo_prescriptions,
    cryoPrices: settings?.cryo_prices,
  });

  return buildManualTherapySettlementSummary({
    rows: visibleRows,
    prescriptions,
    therapists,
    prescriptionPrices: cryoAdjustedPrices,
    incentivePercentage: settings?.incentive_percentage,
  });
}

function buildShinjangTreatmentSummary({
  shockwaveRows,
  manualTherapyRows,
  therapists,
  monthlyShinjangTherapists,
  settings,
  isAdmin,
}) {
  const mergedRows = mergeShinjangSprayLogs({
    shockwaveRows,
    manualTherapyRows,
    shockwavePrescriptionPrices: settings?.prescription_prices,
    manualTherapyPrescriptionPrices: settings?.prescription_prices,
    shockwaveCryoPrescriptions: settings?.cryo_prescriptions,
    shockwaveCryoPrices: settings?.cryo_prices,
    manualTherapyCryoPrescriptions: settings?.cryo_prescriptions,
    manualTherapyCryoPrices: settings?.cryo_prices,
  });
  const reassignedRows = applyMonthlyShinjangSprayTherapists(
    mergedRows,
    monthlyShinjangTherapists
  );
  const hiddenKeys = new Set(
    (Array.isArray(settings?.hidden_prescriptions) ? settings.hidden_prescriptions : [])
      .map(normalizePrescriptionKey)
      .filter(Boolean)
  );
  const prescriptions = buildShinjangSprayPrescriptions({
    configuredPrescriptions: settings?.prescriptions,
    rows: reassignedRows,
  }).filter((prescription) => {
    if (hiddenKeys.has(normalizePrescriptionKey(prescription))) return false;
    const incentivePercentage = Math.max(
      0,
      Number(getMapValue(settings?.prescription_incentive_percentages, prescription)) || 0
    );
    return isAdmin || incentivePercentage !== 15;
  });
  const visiblePrescriptionKeys = new Set(prescriptions.map(normalizePrescriptionKey));
  const configuredTherapistNames = Array.isArray(settings?.therapist_names)
    ? new Set(settings.therapist_names.map((name) => String(name || '').trim()).filter(Boolean))
    : null;
  const visibleRows = reassignedRows.filter((row) => (
    visiblePrescriptionKeys.has(normalizePrescriptionKey(row?.prescription))
    && (!configuredTherapistNames || configuredTherapistNames.has(String(row?.therapist_name || '').trim()))
  ));

  return {
    rows: visibleRows,
    settlement: buildShinjangSpraySettlementSummary({
      rows: visibleRows,
      prescriptions,
      therapists,
      prescriptionPrices: settings?.prescription_prices,
      incentivePercentages: settings?.prescription_incentive_percentages,
      isCryoAdjusted: true,
    }),
  };
}

function toTreatmentMap(summary, { sumPrescriptionIncentives = false } = {}) {
  return new Map(
    (Array.isArray(summary?.summaryByTherapist) ? summary.summaryByTherapist : [])
      .map((item) => [String(item?.therapist?.name || '').trim(), {
        count: Math.max(0, Number(item?.totalCount) || 0),
        amount: Math.max(0, Number(item?.amount) || 0),
        incentive: Math.max(
          0,
          sumPrescriptionIncentives
            ? Object.values(item?.incentivesByPrescription || {}).reduce(
                (sum, value) => sum + (Number(value) || 0),
                0
              )
            : Number(item?.incentive) || 0
        ),
      }])
      .filter(([name]) => name)
  );
}

function toShinjangTreatmentMap(summary) {
  const values = new Map();
  (Array.isArray(summary?.detailRows) ? summary.detailRows : []).forEach((row) => {
    const name = String(row?.therapist?.name || row?.therapist?.displayName || '').trim();
    if (!name) return;
    const current = values.get(name) || { count: 0, amount: 0, incentive: 0 };
    current.count += Math.max(0, Number(row?.count) || 0);
    current.amount += Math.max(0, Number(row?.amount) || 0);
    current.incentive += Math.max(0, Number(row?.incentive) || 0);
    values.set(name, current);
  });
  return values;
}

function addTreatmentValues(values) {
  return values.reduce((total, item) => ({
    count: total.count + (Number(item?.count) || 0),
    amount: total.amount + (Number(item?.amount) || 0),
    incentive: total.incentive + (Number(item?.incentive) || 0),
  }), { count: 0, amount: 0, incentive: 0 });
}

export function buildCombinedStatsMonthSummary({
  year,
  month,
  shockwaveRows = [],
  manualTherapyRows = [],
  shockwaveTherapists = [],
  manualTherapists = [],
  monthlyShockwaveTherapists = [],
  monthlyManualTherapists = [],
  monthlyShinjangTherapists = [],
  settings = {},
  isAdmin = false,
} = {}) {
  const shockwaveSettings = getEffectiveSettlementSettings(settings, year, month, 'shockwave');
  const manualSettings = getEffectiveSettlementSettings(settings, year, month, 'manual_therapy');
  const shinjangSettings = getEffectiveShinjangSpraySettings(settings, year, month);
  const shinjangSourceRows = applyMonthlyShinjangSprayTherapists(
    mergeShinjangSprayLogs({
      shockwaveRows,
      manualTherapyRows,
      shockwavePrescriptionPrices: shinjangSettings.prescription_prices,
      manualTherapyPrescriptionPrices: shinjangSettings.prescription_prices,
      shockwaveCryoPrescriptions: shinjangSettings.cryo_prescriptions,
      shockwaveCryoPrices: shinjangSettings.cryo_prices,
      manualTherapyCryoPrescriptions: shinjangSettings.cryo_prescriptions,
      manualTherapyCryoPrices: shinjangSettings.cryo_prices,
    }),
    monthlyShinjangTherapists
  );
  const therapists = buildCombinedStatsTherapists({
    shockwaveTherapists,
    manualTherapists,
    monthlyShockwaveTherapists,
    monthlyManualTherapists,
    monthlyShinjangTherapists,
    shinjangTherapistNames: shinjangSettings.therapist_names,
    shinjangRows: shinjangSourceRows,
  });
  const shockwaveSettlement = buildStandardTreatmentSummary({
    rows: shockwaveRows,
    therapists,
    settings: shockwaveSettings,
  });
  const manualSettlement = buildStandardTreatmentSummary({
    rows: manualTherapyRows,
    therapists,
    settings: manualSettings,
  });
  const shinjangResult = buildShinjangTreatmentSummary({
    shockwaveRows,
    manualTherapyRows,
    therapists,
    monthlyShinjangTherapists,
    settings: shinjangSettings,
    isAdmin,
  });
  const treatmentMaps = {
    // 충격파 결산은 기존 탭과 동일하게 처방별 인센티브를 반올림한 뒤 합산한다.
    shockwave: toTreatmentMap(shockwaveSettlement, { sumPrescriptionIncentives: true }),
    shinjang_spray: toShinjangTreatmentMap(shinjangResult.settlement),
    manual_therapy: toTreatmentMap(manualSettlement),
  };
  const therapistSummaries = therapists.map((therapist) => {
    const treatments = Object.fromEntries(COMBINED_STATS_TREATMENTS.map(({ key }) => [
      key,
      treatmentMaps[key].get(therapist.name) || { count: 0, amount: 0, incentive: 0 },
    ]));
    return {
      therapist,
      treatments,
      total: addTreatmentValues(Object.values(treatments)),
    };
  });
  const grandTotal = addTreatmentValues(therapistSummaries.map((item) => item.total));

  return {
    monthKey: `${Number(year)}-${String(Number(month)).padStart(2, '0')}`,
    label: `${Number(year)}년 ${String(Number(month)).padStart(2, '0')}월`,
    therapists: therapistSummaries,
    totalCount: grandTotal.count,
    amount: grandTotal.amount,
    incentive: grandTotal.incentive,
  };
}

export function buildCombinedStatsRecentTotal(monthSummaries = []) {
  return addTreatmentValues(
    (Array.isArray(monthSummaries) ? monthSummaries : []).map((summary) => ({
      count: summary?.totalCount,
      amount: summary?.amount,
      incentive: summary?.incentive,
    }))
  );
}
