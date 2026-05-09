/**
 * Scheduler cell content formatting helpers.
 * These helpers keep manual-therapy duration tags (e.g. 30, 40, 60, 90 …)
 * and new-patient marks in one canonical order: name40* / name60*.
 *
 * The digit pattern matches any 2-3 digit number after a Korean/English
 * character so that newly configured prescriptions (e.g. "30분") are
 * automatically supported without code changes.
 */

export function has4060Pattern(text) {
  return /[가-힣a-zA-Z]\s*\*?\s*(\d{2,3})\**($|[(\s])/.test(String(text || ''));
}

export function get4060PrescriptionFromContent(text) {
  const normalized = normalize4060StarOrder(text);
  const match = normalized.match(/[가-힣a-zA-Z]\s*(\d{2,3})\**($|[(\s])/);
  return match ? `${match[1]}분` : '';
}

export function normalize4060StarOrder(text) {
  return String(text || '').replace(/([가-힣a-zA-Z])\s*\*\s*(\d{2,3})(?=$|[\s(])/g, '$1$2*');
}

export function strip4060FromContent(text) {
  const s = String(text || '').trim();
  if (!s) return s;
  if (!has4060Pattern(s)) return s;
  return normalize4060StarOrder(s).replace(/([가-힣a-zA-Z])\s*(\d{2,3})(\**)/, '$1$3');
}

/**
 * Extract the numeric dose tag from a prescription name.
 * e.g. "30분" → "30", "40분" → "40", "프리미엄" → ""
 */
export function extractDoseTagFromPrescription(prescription) {
  const match = String(prescription || '').match(/(\d{2,3})/);
  return match ? match[1] : '';
}
