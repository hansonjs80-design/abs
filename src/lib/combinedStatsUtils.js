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

function normalizeIncentiveRates(values) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map(Number)
      .filter((value) => Number.isFinite(value) && value >= 0)
  )].sort((left, right) => left - right);
}

function buildStandardIncentiveRates(settings) {
  return getVisibleStandardPrescriptions(settings).length > 0
    ? normalizeIncentiveRates([settings?.incentive_percentage])
    : [];
}

function addShinjangIncentiveGroup(groupsByRate, rateValue, value = {}) {
  const rate = Math.max(0, Number(rateValue) || 0);
  const current = groupsByRate.get(rate) || {
    rate,
    count: 0,
    amount: 0,
    incentive: 0,
  };
  current.count += Math.max(0, Number(value?.count) || 0);
  current.amount += Math.max(0, Number(value?.amount) || 0);
  current.incentive += Math.max(0, Number(value?.incentive) || 0);
  groupsByRate.set(rate, current);
}

function sortShinjangIncentiveGroups(groupsByRate) {
  return [...groupsByRate.values()].sort((left, right) => left.rate - right.rate);
}

function buildShinjangIncentiveGroups(summary, initialRates = []) {
  const groupsByRate = new Map();
  normalizeIncentiveRates(initialRates).forEach((rate) => {
    addShinjangIncentiveGroup(groupsByRate, rate);
  });
  (Array.isArray(summary?.detailRows) ? summary.detailRows : []).forEach((row) => {
    if (Math.max(0, Number(row?.count) || 0) === 0) return;
    addShinjangIncentiveGroup(groupsByRate, row?.incentivePercentage, row);
  });
  return sortShinjangIncentiveGroups(groupsByRate);
}

function buildShinjangIncentiveGroupsByTherapist(summary) {
  const groupsByTherapist = new Map();
  (Array.isArray(summary?.detailRows) ? summary.detailRows : []).forEach((row) => {
    if (Math.max(0, Number(row?.count) || 0) === 0) return;
    const name = String(row?.therapist?.name || row?.therapist?.displayName || '').trim();
    if (!name) return;
    const groupsByRate = groupsByTherapist.get(name) || new Map();
    addShinjangIncentiveGroup(groupsByRate, row?.incentivePercentage, row);
    groupsByTherapist.set(name, groupsByRate);
  });
  return new Map(
    [...groupsByTherapist.entries()].map(([name, groupsByRate]) => [
      name,
      sortShinjangIncentiveGroups(groupsByRate),
    ])
  );
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
  const configuredShinjangNames = Array.isArray(shinjangTherapistNames) && shinjangTherapistNames.length > 0
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
  const configuredTherapistNames = Array.isArray(settings?.therapist_names) && settings.therapist_names.length > 0
    ? new Set(settings.therapist_names.map((name) => String(name || '').trim()).filter(Boolean))
    : null;
  const visibleRows = reassignedRows.filter((row) => (
    visiblePrescriptionKeys.has(normalizePrescriptionKey(row?.prescription))
    && (!configuredTherapistNames || configuredTherapistNames.has(String(row?.therapist_name || '').trim()))
  ));

  return {
    rows: visibleRows,
    prescriptions,
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
    // 전체 통계의 도수치료 결산은 관리자에게만 공개한다. 일반 계정의 합계에도
    // 도수치료 금액이 섞이지 않도록 화면 렌더링 전 집계 단계에서 제외한다.
    manual_therapy: isAdmin ? toTreatmentMap(manualSettlement) : new Map(),
  };
  const shockwaveIncentiveRates = buildStandardIncentiveRates(shockwaveSettings);
  const manualIncentiveRates = buildStandardIncentiveRates(manualSettings);
  const shinjangConfiguredRates = shinjangResult.prescriptions
    .map((prescription) => (
      getMapValue(shinjangSettings?.prescription_incentive_percentages, prescription)
    ))
    .filter((rate) => isAdmin || Number(rate) !== 15);
  const shinjangIncentiveGroups = buildShinjangIncentiveGroups(
    shinjangResult.settlement,
    shinjangConfiguredRates
  );
  const shinjangIncentiveGroupsByTherapist = buildShinjangIncentiveGroupsByTherapist(
    shinjangResult.settlement,
    shinjangConfiguredRates
  );
  // 각 치료사별 신장분사 처방목록 이름(prescription)별 실적 매핑
  const shinjangDetailByTherapistAndPrescription = new Map();
  (Array.isArray(shinjangResult.settlement?.detailRows) ? shinjangResult.settlement.detailRows : []).forEach((row) => {
    const name = String(row?.therapist?.name || row?.therapist?.displayName || '').trim();
    if (!name) return;
    const key = `${name}:::${normalizePrescriptionKey(row?.prescription)}`;
    shinjangDetailByTherapistAndPrescription.set(key, row);
  });
  const therapistSummaries = therapists.map((therapist) => {
    const treatments = Object.fromEntries(COMBINED_STATS_TREATMENTS.map(({ key }) => [
      key,
      treatmentMaps[key].get(therapist.name) || { count: 0, amount: 0, incentive: 0 },
    ]));
    const shinjangPrescriptionGroups = shinjangResult.prescriptions.map((prescription) => {
      const key = `${therapist.name}:::${normalizePrescriptionKey(prescription)}`;
      const found = shinjangDetailByTherapistAndPrescription.get(key);
      const configuredRate = Math.max(
        0,
        Number(getMapValue(shinjangSettings?.prescription_incentive_percentages, prescription)) || 0
      );
      const rate = found?.incentivePercentage !== undefined ? Number(found.incentivePercentage) : configuredRate;
      return {
        prescription,
        rate,
        count: Math.max(0, Number(found?.count) || 0),
        amount: Math.max(0, Number(found?.amount) || 0),
        incentive: Math.max(0, Number(found?.incentive) || 0),
        rates: [rate],
      };
    });
    return {
      therapist,
      treatments,
      incentiveRates: {
        shockwave: treatments.shockwave.count > 0 ? shockwaveIncentiveRates : [],
        shinjang_spray: (shinjangIncentiveGroupsByTherapist.get(therapist.name) || [])
          .map((group) => group.rate),
        manual_therapy: isAdmin && treatments.manual_therapy.count > 0
          ? manualIncentiveRates
          : [],
      },
      shinjangIncentiveGroups: shinjangIncentiveGroupsByTherapist.get(therapist.name) || [],
      shinjangPrescriptionGroups,
      configuredShinjangRates: shinjangConfiguredRates,
      total: addTreatmentValues(Object.values(treatments)),
    };
  });
  const treatmentTotals = Object.fromEntries(COMBINED_STATS_TREATMENTS.map(({ key }) => [
    key,
    addTreatmentValues(therapistSummaries.map((item) => item.treatments[key])),
  ]));
  const grandTotal = addTreatmentValues(Object.values(treatmentTotals));

  return {
    monthKey: `${Number(year)}-${String(Number(month)).padStart(2, '0')}`,
    label: `${Number(year)}년 ${String(Number(month)).padStart(2, '0')}월`,
    therapists: therapistSummaries,
    treatmentTotals,
    shinjangIncentiveGroups,
    total: grandTotal,
    totalCount: grandTotal.count,
    amount: grandTotal.amount,
    incentive: grandTotal.incentive,
  };
}

export function buildCombinedStatsRecentBreakdown(monthSummaries = []) {
  const summaries = Array.isArray(monthSummaries) ? monthSummaries : [];
  const treatmentTotals = Object.fromEntries(COMBINED_STATS_TREATMENTS.map(({ key }) => [
    key,
    addTreatmentValues(summaries.map((summary) => summary?.treatmentTotals?.[key])),
  ]));
  const shinjangGroupsByRate = new Map();
  summaries.forEach((summary) => {
    (Array.isArray(summary?.shinjangIncentiveGroups)
      ? summary.shinjangIncentiveGroups
      : []
    ).forEach((group) => {
      addShinjangIncentiveGroup(shinjangGroupsByRate, group?.rate, group);
    });
  });

  return {
    treatmentTotals,
    shinjangIncentiveGroups: sortShinjangIncentiveGroups(shinjangGroupsByRate),
    total: addTreatmentValues(Object.values(treatmentTotals)),
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
