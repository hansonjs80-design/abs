export function normalizePrescriptionKey(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('ko-KR')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

export function statsPrescriptionsMatch(a, b) {
  return normalizePrescriptionKey(a) === normalizePrescriptionKey(b);
}

export function toStatsPrescriptionCount(value) {
  const parsed = parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export function buildCryoAdjustedPrescriptionPrices({
  prescriptionPrices = {},
  cryoPrescriptions = [],
  cryoPrices = {},
} = {}) {
  const priceEntries = prescriptionPrices && typeof prescriptionPrices === 'object' && !Array.isArray(prescriptionPrices)
    ? prescriptionPrices
    : {};
  const cryoPrescriptionKeys = new Set(
    (Array.isArray(cryoPrescriptions) ? cryoPrescriptions : [])
      .map(normalizePrescriptionKey)
      .filter(Boolean)
  );
  const normalizedCryoPriceMap = new Map(
    Object.entries(cryoPrices && typeof cryoPrices === 'object' && !Array.isArray(cryoPrices) ? cryoPrices : {})
      .map(([prescription, amount]) => [
        normalizePrescriptionKey(prescription),
        Math.max(0, Number(amount) || 0),
      ])
  );

  return Object.fromEntries(
    Object.entries(priceEntries).map(([prescription, amount]) => {
      const prescriptionKey = normalizePrescriptionKey(prescription);
      const basePrice = Math.max(0, Number(amount) || 0);
      const cryoPrice = cryoPrescriptionKeys.has(prescriptionKey)
        ? normalizedCryoPriceMap.get(prescriptionKey) || 0
        : 0;
      return [prescription, Math.max(0, basePrice - cryoPrice)];
    })
  );
}

export function getShockwaveSettlementPrintColumnWeight(prescription) {
  const compactLabel = String(prescription || '').replace(/\s+/g, '');
  const isLongLabel = /[()[\]{}]/.test(compactLabel) || Array.from(compactLabel).length >= 6;
  return isLongLabel ? 1.1 : 0.9;
}

export function buildShockwaveSettlementPrintColumnWidths(
  prescriptionGroups,
  valueAreaPercent = 81,
) {
  const columns = (Array.isArray(prescriptionGroups) ? prescriptionGroups : [])
    .flatMap((group) => {
      const prescriptions = Array.isArray(group?.prescriptions) ? group.prescriptions : [];
      const isSingleTherapistColumn = prescriptions.length === 1;
      return prescriptions.map((prescription) => ({
        prescription,
        isSingleTherapistColumn,
      }));
    });
  const weights = columns.map(({ prescription, isSingleTherapistColumn }) => (
    getShockwaveSettlementPrintColumnWeight(prescription)
    * (isSingleTherapistColumn ? 1.25 : 1)
  ));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (totalWeight <= 0) return [];

  return columns.map((column, index) => ({
    ...column,
    widthPercent: (Number(valueAreaPercent) || 0) * (weights[index] / totalWeight),
  }));
}

export function buildStatsDisplayPrescriptions({
  configuredPrescriptions = [],
  rows = [],
  hiddenPrescriptions = [],
} = {}) {
  const safeConfiguredPrescriptions = Array.isArray(configuredPrescriptions)
    ? configuredPrescriptions
    : [];
  const hiddenKeys = new Set(
    (Array.isArray(hiddenPrescriptions) ? hiddenPrescriptions : [])
      .map(normalizePrescriptionKey)
      .filter(Boolean)
  );
  const prescriptionsByKey = new Map();

  const addPrescription = (value) => {
    const prescription = String(value || '').trim();
    const key = normalizePrescriptionKey(prescription);
    if (!key || hiddenKeys.has(key) || prescriptionsByKey.has(key)) return;
    prescriptionsByKey.set(key, prescription);
  };

  const hasConfiguredPrescriptions = safeConfiguredPrescriptions
    .some((prescription) => normalizePrescriptionKey(prescription));

  if (hasConfiguredPrescriptions) {
    safeConfiguredPrescriptions.forEach(addPrescription);
  } else {
    (Array.isArray(rows) ? rows : [])
      .forEach((row) => addPrescription(row?.prescription));
  }

  return [...prescriptionsByKey.values()];
}

export function buildTherapistPrescriptionDisplayGroups({
  rows = [],
  prescriptions = [],
  therapists = [],
  sharedPrescriptionLimit = 4,
  emptyTherapistPrescriptionLimit = 3,
} = {}) {
  const safeRows = Array.isArray(rows) ? rows.filter(Boolean) : [];
  const safePrescriptions = Array.isArray(prescriptions) ? prescriptions.filter(Boolean) : [];
  const safeTherapists = Array.isArray(therapists) ? therapists.filter(Boolean) : [];

  if (safePrescriptions.length <= sharedPrescriptionLimit) {
    return safeTherapists.map((therapist) => ({
      therapist,
      prescriptions: [...safePrescriptions],
    }));
  }

  const globalTotals = createEmptyPrescriptionCounts(safePrescriptions);
  const totalsByTherapist = new Map(
    safeTherapists.map((therapist) => [
      therapist.name,
      createEmptyPrescriptionCounts(safePrescriptions),
    ])
  );

  safeRows.forEach((row) => {
    const matchedPrescription = safePrescriptions.find((prescription) =>
      statsPrescriptionsMatch(row?.prescription, prescription)
    );
    if (!matchedPrescription) return;

    const count = toStatsPrescriptionCount(row?.prescription_count);
    globalTotals[matchedPrescription] += count;

    const therapistTotals = totalsByTherapist.get(row?.therapist_name);
    if (therapistTotals) {
      therapistTotals[matchedPrescription] += count;
    }
  });

  const prescriptionOrder = new Map(
    safePrescriptions.map((prescription, index) => [prescription, index])
  );
  const fallbackPrescriptions = [...safePrescriptions]
    .sort((a, b) => (
      (globalTotals[b] || 0) - (globalTotals[a] || 0) ||
      (prescriptionOrder.get(a) || 0) - (prescriptionOrder.get(b) || 0)
    ))
    .slice(0, Math.min(emptyTherapistPrescriptionLimit, safePrescriptions.length));

  return safeTherapists.map((therapist) => {
    const therapistTotals = totalsByTherapist.get(therapist.name) || {};
    const usedPrescriptions = safePrescriptions.filter(
      (prescription) => (therapistTotals[prescription] || 0) > 0
    );

    return {
      therapist,
      prescriptions: usedPrescriptions.length > 0
        ? usedPrescriptions
        : [...fallbackPrescriptions],
    };
  });
}

function createEmptyPrescriptionCounts(prescriptions) {
  return Object.fromEntries(prescriptions.map((prescription) => [prescription, 0]));
}

function createEmptyTherapistCounts({ therapists, prescriptions }) {
  return Object.fromEntries(
    therapists.map((therapist) => [therapist.name, createEmptyPrescriptionCounts(prescriptions)])
  );
}

function createEmptyPrescriptionPatientNames(prescriptions) {
  return Object.fromEntries(prescriptions.map((prescription) => [prescription, []]));
}

function createEmptyTherapistPrescriptionPatientNames({ therapists, prescriptions }) {
  return Object.fromEntries(
    therapists.map((therapist) => [
      therapist.name,
      createEmptyPrescriptionPatientNames(prescriptions),
    ])
  );
}

function createEmptyNewPatientCounts(therapists) {
  return Object.fromEntries(therapists.map((therapist) => [therapist.name, 0]));
}

function createEmptyNewPatientNames(therapists) {
  return Object.fromEntries(therapists.map((therapist) => [therapist.name, []]));
}

function appendTooltipPatientName(patientNames, value) {
  const rawName = String(value || '').trim();
  const cleanName = rawName.replace(/\*/g, '').trim();
  if (!cleanName) return;

  const isNewPatient = rawName.includes('*');
  const displayName = `${cleanName}${isNewPatient ? '*' : ''}`;
  const existingIndex = patientNames.findIndex(
    (name) => String(name || '').replace(/\*/g, '').trim() === cleanName
  );

  if (existingIndex < 0) {
    patientNames.push(displayName);
  } else if (isNewPatient && !String(patientNames[existingIndex] || '').includes('*')) {
    patientNames[existingIndex] = displayName;
  }
}

export function buildShockwaveCountSummaries({
  rows = [],
  prescriptions = [],
  therapists = [],
} = {}) {
  const safeRows = Array.isArray(rows) ? rows.filter(Boolean) : [];
  const safePrescriptions = Array.isArray(prescriptions) ? prescriptions.filter(Boolean) : [];
  const safeTherapists = Array.isArray(therapists) ? therapists.filter(Boolean) : [];
  const totalsByTherapist = new Map();

  safeTherapists.forEach((therapist) => {
    totalsByTherapist.set(therapist.name, {
      total: 0,
      byPres: createEmptyPrescriptionCounts(safePrescriptions),
    });
  });

  const dateSummaries = new Map();
  let grandTotal = 0;
  let newPatientTotal = 0;

  safeRows.forEach((row) => {
    const date = String(row?.date || '');
    const current = date
      ? dateSummaries.get(date) || {
          total: 0,
          newPatient: 0,
          byPrescription: createEmptyPrescriptionCounts(safePrescriptions),
          patientNamesByPrescription: createEmptyPrescriptionPatientNames(safePrescriptions),
          byTherapistPrescription: createEmptyTherapistCounts({
            therapists: safeTherapists,
            prescriptions: safePrescriptions,
          }),
          patientNamesByTherapistPrescription: createEmptyTherapistPrescriptionPatientNames({
            therapists: safeTherapists,
            prescriptions: safePrescriptions,
          }),
          newPatientByTherapist: createEmptyNewPatientCounts(safeTherapists),
          newPatientNamesByTherapist: createEmptyNewPatientNames(safeTherapists),
        }
      : null;

    const matchedPrescription = safePrescriptions.find((prescription) =>
      statsPrescriptionsMatch(row?.prescription, prescription)
    );
    const therapistTotal = totalsByTherapist.get(row?.therapist_name);
    if (!matchedPrescription || !therapistTotal) {
      if (current) dateSummaries.set(date, current);
      return;
    }

    const count = toStatsPrescriptionCount(row?.prescription_count);
    grandTotal += count;
    therapistTotal.total += count;
    therapistTotal.byPres[matchedPrescription] = (therapistTotal.byPres[matchedPrescription] || 0) + count;

    if (current) {
      current.total += count;
      current.byPrescription[matchedPrescription] = (current.byPrescription[matchedPrescription] || 0) + count;
      if (!current.byTherapistPrescription[row.therapist_name]) {
        current.byTherapistPrescription[row.therapist_name] = createEmptyPrescriptionCounts(safePrescriptions);
      }
      current.byTherapistPrescription[row.therapist_name][matchedPrescription] =
        (current.byTherapistPrescription[row.therapist_name][matchedPrescription] || 0) + count;

      const patientName = String(row?.patient_name || '').trim();
      if (patientName.replace(/\*/g, '').trim()) {
        const prescriptionPatientNames =
          current.patientNamesByPrescription[matchedPrescription] || [];
        current.patientNamesByPrescription[matchedPrescription] = prescriptionPatientNames;
        appendTooltipPatientName(prescriptionPatientNames, patientName);

        const therapistPatientNames =
          current.patientNamesByTherapistPrescription[row.therapist_name] ||
          createEmptyPrescriptionPatientNames(safePrescriptions);
        current.patientNamesByTherapistPrescription[row.therapist_name] = therapistPatientNames;
        const therapistPrescriptionPatientNames =
          therapistPatientNames[matchedPrescription] || [];
        therapistPatientNames[matchedPrescription] = therapistPrescriptionPatientNames;
        appendTooltipPatientName(therapistPrescriptionPatientNames, patientName);
      }
    }

    if (String(row?.patient_name || '').includes('*')) {
      newPatientTotal += 1;
      if (current) {
        current.newPatient += 1;
        current.newPatientByTherapist[row.therapist_name] =
          (current.newPatientByTherapist[row.therapist_name] || 0) + 1;
        const patientName = String(row?.patient_name || '').replace(/\*/g, '').trim();
        if (patientName) {
          const patientNames = current.newPatientNamesByTherapist[row.therapist_name] || [];
          current.newPatientNamesByTherapist[row.therapist_name] = patientNames;
          appendTooltipPatientName(patientNames, row.patient_name);
        }
      }
    }

    if (current) dateSummaries.set(date, current);
  });

  return {
    dateSummaries,
    grandTotal,
    newPatientTotal,
    therapistTotals: safeTherapists.map((therapist) =>
      totalsByTherapist.get(therapist.name) || { total: 0, byPres: {} }
    ),
  };
}

export function buildManualTherapySettlementSummary({
  rows = [],
  prescriptions = [],
  therapists = [],
  prescriptionPrices = {},
  incentivePercentage = 0,
} = {}) {
  const safeRows = Array.isArray(rows) ? rows.filter(Boolean) : [];
  const safePrescriptions = Array.isArray(prescriptions) ? prescriptions.filter(Boolean) : [];
  const safeTherapists = Array.isArray(therapists) ? therapists.filter((item) => item?.name) : [];
  const priceEntries = prescriptionPrices && typeof prescriptionPrices === 'object' && !Array.isArray(prescriptionPrices)
    ? prescriptionPrices
    : {};
  const normalizedPriceMap = new Map(
    Object.entries(priceEntries).map(([prescription, amount]) => [
      normalizePrescriptionKey(prescription),
      Number(amount) || 0,
    ])
  );
  const incentiveRate = (Number(incentivePercentage) || 0) / 100;

  const summaryByTherapist = safeTherapists.map((therapist) => {
    const countsByPrescription = createEmptyPrescriptionCounts(safePrescriptions);

    safeRows.forEach((entry) => {
      if (entry?.therapist_name !== therapist.name) return;
      const matchedPrescription = safePrescriptions.find((prescription) => (
        statsPrescriptionsMatch(prescription, entry?.prescription)
      ));
      if (!matchedPrescription) return;
      countsByPrescription[matchedPrescription] += toStatsPrescriptionCount(entry?.prescription_count);
    });

    const totalCount = safePrescriptions.reduce(
      (sum, prescription) => sum + (countsByPrescription[prescription] || 0),
      0
    );
    const amountsByPrescription = Object.fromEntries(
      safePrescriptions.map((prescription) => [
        prescription,
        (countsByPrescription[prescription] || 0)
          * (normalizedPriceMap.get(normalizePrescriptionKey(prescription)) || 0),
      ])
    );
    const amount = safePrescriptions.reduce(
      (sum, prescription) => sum + (amountsByPrescription[prescription] || 0),
      0
    );
    const incentivesByPrescription = Object.fromEntries(
      safePrescriptions.map((prescription) => [
        prescription,
        Math.round((amountsByPrescription[prescription] || 0) * incentiveRate),
      ])
    );

    return {
      therapist: {
        ...therapist,
        id: therapist.key || therapist.id || therapist.name,
        name: therapist.displayName || therapist.name,
      },
      countsByPrescription,
      amountsByPrescription,
      incentivesByPrescription,
      totalCount,
      amount,
      incentive: Math.round(amount * incentiveRate),
    };
  });

  const sumByPrescription = (field) => Object.fromEntries(
    safePrescriptions.map((prescription) => [
      prescription,
      summaryByTherapist.reduce(
        (sum, item) => sum + (item[field]?.[prescription] || 0),
        0
      ),
    ])
  );

  return {
    summaryByTherapist,
    grandPrescriptionCounts: sumByPrescription('countsByPrescription'),
    grandPrescriptionAmounts: sumByPrescription('amountsByPrescription'),
    grandPrescriptionIncentives: sumByPrescription('incentivesByPrescription'),
    grandTotalCount: summaryByTherapist.reduce((sum, item) => sum + item.totalCount, 0),
    grandAmount: summaryByTherapist.reduce((sum, item) => sum + item.amount, 0),
    grandIncentive: summaryByTherapist.reduce((sum, item) => sum + item.incentive, 0),
  };
}
