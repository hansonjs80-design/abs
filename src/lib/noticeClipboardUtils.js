export function parseNoticePasteValues(text, availableSlots) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  if (lines.at(-1) === '' && lines.length > 1) lines.pop();
  return lines.slice(0, Math.max(0, availableSlots)).map((line) => line.split('\t')[0].trim());
}

export async function pasteNoticeClipboard({ text, index, slotCount, year, month, cut, saveNotice, isCutSourceUnchanged }) {
  const values = parseNoticePasteValues(text, slotCount - index);
  const results = await Promise.all(values.map((value, offset) => saveNotice(index + offset, value, year, month)));
  const succeeded = results.length > 0 && results.every(Boolean);
  if (succeeded && cut && text === cut.content && cut.year === year && cut.month === month
    && (cut.index < index || cut.index >= index + values.length) && isCutSourceUnchanged(cut)) {
    return saveNotice(cut.index, '', cut.year, cut.month);
  }
  return succeeded;
}
