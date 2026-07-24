export function normalizePrescriptionKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function statsPrescriptionsMatch(a, b) {
  return normalizePrescriptionKey(a) === normalizePrescriptionKey(b);
}

export function toStatsPrescriptionCount(value) {
  const parsed = parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
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

      const patientName = String(row?.patient_name || '').replace(/\*/g, '').trim();
      if (patientName) {
        const prescriptionPatientNames =
          current.patientNamesByPrescription[matchedPrescription] || [];
        current.patientNamesByPrescription[matchedPrescription] = prescriptionPatientNames;
        if (!prescriptionPatientNames.includes(patientName)) {
          prescriptionPatientNames.push(patientName);
        }

        const therapistPatientNames =
          current.patientNamesByTherapistPrescription[row.therapist_name] ||
          createEmptyPrescriptionPatientNames(safePrescriptions);
        current.patientNamesByTherapistPrescription[row.therapist_name] = therapistPatientNames;
        const therapistPrescriptionPatientNames =
          therapistPatientNames[matchedPrescription] || [];
        therapistPatientNames[matchedPrescription] = therapistPrescriptionPatientNames;
        if (!therapistPrescriptionPatientNames.includes(patientName)) {
          therapistPrescriptionPatientNames.push(patientName);
        }
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
          if (!patientNames.includes(patientName)) {
            patientNames.push(patientName);
          }
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
