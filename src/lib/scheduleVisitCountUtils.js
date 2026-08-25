/**
 * Increments the visit suffix used by scheduler copy/paste and history apply.
 * Numeric visits increase by one, a new-patient star becomes visit two, and
 * unsupported or special suffixes remain unchanged.
 */
export function incrementSessionCount(text) {
  const value = String(text || '').trim();
  if (!value) return value;

  const numericMatch = value.match(/^(.+?\/.*?[가-힣a-zA-Z])(\d{2,3})?(\(\d+\))$/);
  if (numericMatch) {
    const prefix = numericMatch[1];
    const doseTag = numericMatch[2] || '';
    const count = parseInt(numericMatch[3].replace(/[()]/g, ''), 10);
    return `${prefix}${doseTag}(${count + 1})`;
  }

  const starMatch = value.match(/^(.+?\/.*?[가-힣a-zA-Z])(\d{2,3})?(\*+)$/);
  if (starMatch) {
    const prefix = starMatch[1];
    const doseTag = starMatch[2] || '';
    return `${prefix}${doseTag}(2)`;
  }

  return value;
}
