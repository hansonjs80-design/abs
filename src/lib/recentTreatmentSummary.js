import { normalizePrescriptionKey, toStatsPrescriptionCount } from './shockwaveStatsCountUtils.js';

// Keep prescription quantities and starred visit rows while allowing the settlement price mode.
export function buildRecentTreatmentSummary(rows = [], prescriptions = [], prices = {}, rowPriceSource = false) {
  const groups = new Map(prescriptions.map((prescription) => [normalizePrescriptionKey(prescription), {
    label: prescription.replace(/^신장\s*분사\s*/, '신장 '), count: 0, amount: 0, newPatientCount: 0,
  }]));
  const normalizedPrices = new Map(Object.entries(prices).map(([key, value]) => [normalizePrescriptionKey(key), Number(value) || 0]));
  for (const row of rows) {
    const key = normalizePrescriptionKey(row.prescription);
    const group = groups.get(key);
    if (!group) continue;
    const count = toStatsPrescriptionCount(row.prescription_count);
    group.count += count;
    const unitPrice = typeof rowPriceSource === 'function'
      ? rowPriceSource(row)
      : rowPriceSource ? row.unit_price : normalizedPrices.get(key);
    group.amount += count * Math.max(0, Number(unitPrice) || 0);
    if (String(row.patient_name || '').includes('*')) group.newPatientCount += 1;
  }
  const details = [...groups.values()].filter((group) => group.count > 0);
  return details.reduce((total, group) => {
    for (const metric of ['count', 'amount', 'newPatientCount']) total[metric] += group[metric];
    return total;
  }, { count: 0, amount: 0, newPatientCount: 0, details });
}
