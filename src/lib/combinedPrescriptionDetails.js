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

// Sum the category totals once, independent of expanded prescription rows.
export function buildCombinedRateTotals(summary, isAdmin = false) {
  return (isAdmin ? [7, 15] : [7]).map((rate) => {
    const values = [
      summary?.treatmentTotals?.[rate === 7 ? 'shockwave' : 'manual_therapy'],
      ...(summary?.shinjangIncentiveGroups || []).filter((group) => Number(group.rate) === rate),
    ];
    return values.reduce((total, value) => {
      for (const metric of ['count', 'amount', 'incentive']) total[metric] += Number(value?.[metric]) || 0;
      return total;
    }, { rate, count: 0, amount: 0, incentive: 0 });
  });
}


export function getCombinedSummaryAnchorIndex(therapists = [], layoutMode = 'horizontal') {
  const name = layoutMode === 'vertical' ? '주한솔' : '김세령';
  const index = therapists.findIndex((item) => [item.therapist?.name, item.therapist?.displayName]
    .some((value) => String(value || '').trim().replace(/\s*치료사$/, '') === name));
  return index >= 0 ? index : layoutMode === 'vertical' ? 0 : therapists.length - 1;
}
