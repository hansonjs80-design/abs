export function normalizeNameForMatch(value) {
  return String(value || '')
    .trim()
    .replace(/[*\d\s().-]/g, '')
    .toLowerCase();
}
