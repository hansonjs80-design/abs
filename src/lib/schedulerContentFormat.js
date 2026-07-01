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

export function normalizeDoseTagInput(value) {
  return String(value || '').trim().replace(/[^0-9A-Za-z가-힣./-]/g, '').slice(0, 12);
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function getConfiguredDoseTagFromContent(text, doseTags = {}) {
  const normalized = normalize4060StarOrder(text);
  const tags = Array.from(new Set(Object.values(doseTags || {})
    .map((tag) => normalizeDoseTagInput(tag))
    .filter(Boolean)))
    .sort((a, b) => b.length - a.length);

  return tags.find((tag) => {
    const isSingleKoreanChar = /^[가-힣]$/.test(tag);
    const pattern = isSingleKoreanChar
      ? new RegExp(`[가-힣a-zA-Z]\\s+${escapeRegExp(tag)}\\**($|[(\\s])`, 'i')
      : new RegExp(`[가-힣a-zA-Z]\\s*${escapeRegExp(tag)}\\**($|[(\\s])`, 'i');
    return pattern.test(normalized);
  }) || '';
}

export function normalizeConfiguredDoseTagInContent(text, doseTags = {}) {
  const s = normalize4060StarOrder(text);
  if (!s) return s;

  const tags = Array.from(new Set(Object.values(doseTags || {})
    .map((tag) => normalizeDoseTagInput(tag))
    .filter(Boolean)))
    .sort((a, b) => b.length - a.length);

  for (const tag of tags) {
    const isSingleKoreanChar = /^[가-힣]$/.test(tag);
    const pattern = isSingleKoreanChar
      ? new RegExp(`([가-힣a-zA-Z])(\\s+)${escapeRegExp(tag)}(\\**)(?=$|[(\\s])`, 'i')
      : new RegExp(`([가-힣a-zA-Z])(\\s*)${escapeRegExp(tag)}(\\**)(?=$|[(\\s])`, 'i');
    if (pattern.test(s)) {
      return s.replace(pattern, `$1$2${tag}$3`);
    }
  }

  return s;
}

export function stripDoseTagFromContent(text, doseTag = '') {
  const normalizedTag = normalizeDoseTagInput(doseTag);
  if (!normalizedTag) return strip4060FromContent(text);

  const s = String(text || '').trim();
  if (!s) return s;
  const pattern = new RegExp(`([가-힣a-zA-Z])\\s*${escapeRegExp(normalizedTag)}(\\**)`, 'i');
  return normalize4060StarOrder(s).replace(pattern, '$1$2');
}

export function applyDoseTagToContent(text, doseTag, previousDoseTag = '') {
  const tag = normalizeDoseTagInput(doseTag);
  const stripped = stripDoseTagFromContent(text, previousDoseTag);
  if (!tag || !stripped) return stripped;

  const suffixMatch = String(stripped).trim().match(/(\((-|\d+)\)|\*)$/);
  const suffix = suffixMatch ? suffixMatch[0] : '';
  const base = suffix
    ? String(stripped).trim().slice(0, -suffix.length).trim()
    : String(stripped).trim();

  if (!base) return normalize4060StarOrder(`${stripped}${tag}`);
  return normalize4060StarOrder(`${base}${tag}${suffix}`);
}

/**
 * Extract the numeric dose tag from a prescription name.
 * e.g. "30분" → "30", "40분" → "40", "프리미엄" → ""
 */
export function extractDoseTagFromPrescription(prescription) {
  const clean = String(prescription || '').trim();
  if (!clean) return '';
  
  // 소수점을 포함한 숫자 패턴 매칭 (예: 1.5, 40, 60 등)
  const numMatch = clean.match(/(\d+(?:\.\d+)?)/);
  if (numMatch) return numMatch[1];

  // 숫자가 전혀 없는 경우, 허용된 문자열만 남겨서 태그로 반환
  return clean.replace(/[^0-9A-Za-z가-힣./-]/g, '').slice(0, 12);
}
