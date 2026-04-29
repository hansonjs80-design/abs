/**
 * Scheduler cell content formatting helpers.
 * These helpers keep manual-therapy duration tags (40/60) and new-patient marks
 * in one canonical order: name40* / name60*.
 */

export function has4060Pattern(text) {
  return /[가-힣a-zA-Z]\s*\*?\s*(40|60)\**($|[(\s])/.test(String(text || ''));
}

export function normalize4060StarOrder(text) {
  return String(text || '').replace(/([가-힣a-zA-Z])\s*\*\s*(40|60)(?=$|[\s(])/g, '$1$2*');
}

export function strip4060FromContent(text) {
  const s = String(text || '').trim();
  if (!s) return s;
  if (!has4060Pattern(s)) return s;
  return normalize4060StarOrder(s).replace(/([가-힣a-zA-Z])\s*(40|60)(\**)/, '$1$3');
}
