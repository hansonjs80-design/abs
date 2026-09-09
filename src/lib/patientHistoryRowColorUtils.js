// Derive the tint from the prescription so sorting and filtering never change it.
export function getPatientHistoryPrescriptionRowColor(prescription) {
  const label = String(prescription ?? '').trim();
  if (!label) return '#f8fafc';

  let hash = 2166136261;
  for (const character of label) {
    hash = Math.imul(hash ^ character.codePointAt(0), 16777619) >>> 0;
  }
  return `hsl(${hash % 360}, 70%, 93%)`;
}
