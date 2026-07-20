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

function createEmptyPrescriptionCounts(prescriptions) {
  return Object.fromEntries(prescriptions.map((prescription) => [prescription, 0]));
}

function createEmptyTherapistCounts({ therapists, prescriptions }) {
  return Object.fromEntries(
    therapists.map((therapist) => [therapist.name, createEmptyPrescriptionCounts(prescriptions)])
  );
}

function createEmptyNewPatientCounts(therapists) {
  return Object.fromEntries(therapists.map((therapist) => [therapist.name, 0]));
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
          byTherapistPrescription: createEmptyTherapistCounts({
            therapists: safeTherapists,
            prescriptions: safePrescriptions,
          }),
          newPatientByTherapist: createEmptyNewPatientCounts(safeTherapists),
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
    }

    if (String(row?.patient_name || '').includes('*')) {
      newPatientTotal += 1;
      if (current) {
        current.newPatient += 1;
        current.newPatientByTherapist[row.therapist_name] =
          (current.newPatientByTherapist[row.therapist_name] || 0) + 1;
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
