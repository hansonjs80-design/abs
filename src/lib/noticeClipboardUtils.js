export function parseNoticePasteValues(text, availableSlots) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  if (lines.at(-1) === '' && lines.length > 1) lines.pop();
  return lines.slice(0, Math.max(0, availableSlots)).map((line) => line.split('\t')[0].trim());
}

export function getNoticeSelectionIndices(selection) {
  if (!selection) return [];
  const first = Math.min(selection.anchor, selection.focus);
  const last = Math.max(selection.anchor, selection.focus);
  return Array.from({ length: last - first + 1 }, (_, offset) => first + offset);
}

export function createNoticeClipboard(notices, indices, year, month) {
  const entries = [...indices].sort((a, b) => a - b).map(index => ({
    index,
    content: notices.find(notice => notice.slot_index === index)?.content || '',
  }));
  const values = entries.map(entry => entry.content);
  return { entries, values, text: values.join('\n'), year, month };
}

export async function pasteNoticeClipboard({ text, index, slotCount, year, month, clipboard, cut, saveNotice, isCutSourceUnchanged }) {
  if (!Number.isInteger(index) || index < 0 || index >= slotCount) return false;
  const localCopy = clipboard && text === clipboard.text ? clipboard : null;
  // Keep selected trailing blank cells, which plain text alone cannot distinguish
  // from the final newline appended by spreadsheet applications.
  const allValues = localCopy?.values || parseNoticePasteValues(text, slotCount);
  const values = allValues.slice(0, slotCount - index);
  const isLocalCut = cut && text === (cut.text ?? cut.content)
    && cut.year === year && cut.month === month;
  const sources = isLocalCut ? (cut.entries || [{ index: cut.index, content: cut.content }]) : [];
  if (!values.length || (isLocalCut && values.length < allValues.length)) return false;

  const offsets = values.map((_, offset) => offset);
  // Move overlapping ranges from the far end, so a source is copied before
  // another destination can overwrite it, including when a later save fails.
  if (isLocalCut && index > sources[0].index) offsets.reverse();
  try {
    for (const offset of offsets) {
      if (!await saveNotice(index + offset, values[offset], year, month)) return false;
    }
    for (const source of sources) {
      if (source.index >= index && source.index < index + values.length) continue;
      const snapshot = { ...source, year: cut.year, month: cut.month };
      if (!isCutSourceUnchanged(snapshot)) continue;
      if (!await saveNotice(source.index, '', cut.year, cut.month)) return false;
    }
    return true;
  } catch {
    // Never clear the remaining cut sources after a rejected destination save.
    return false;
  }
}
