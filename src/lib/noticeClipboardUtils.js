export function parseNoticePasteValues(text, availableSlots) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  if (lines.at(-1) === '' && lines.length > 1) lines.pop();
  return lines.slice(0, Math.max(0, availableSlots)).map((line) => line.split('\t')[0].trim());
}
