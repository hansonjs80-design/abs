// Aggregate already-settled values; do not round or calculate incentives again.
export function buildCombinedPrescriptionDetails(summary, treatment, rate, isAdmin = false) {
  if (treatment === 'manual_therapy' && !isAdmin) return [];
  const groups = new Map();
  for (const therapist of summary?.therapists || []) {
    for (const row of therapist.prescriptionGroups?.[treatment] || []) {
      if (!(Number(row.count) > 0)) continue;
      if (rate !== undefined && Number(row.rate) !== Number(rate)) continue;
      if (treatment === 'shinjang_spray' && !isAdmin && Number(row.rate) === 15) continue;
      const prescription = String(row.prescription || '').trim();
      const key = JSON.stringify([prescription, Number(row.rate)]);
      if (!groups.has(key)) groups.set(key, {
        key,
        label: treatment === 'shinjang_spray' ? prescription.replace(/^신장\s*분사\s*/, '신장 ') : prescription,
        count: 0, amount: 0, incentive: 0,
      });
      const group = groups.get(key);
      for (const metric of ['count', 'amount', 'incentive']) group[metric] += Number(row[metric]) || 0;
    }
  }
  return [...groups.values()];
}
