import { cArmColumns } from './cArmStats.js';

export function cArmSelectionBounds(selection) {
  if (!selection) return null;
  return {
    top: Math.min(selection.anchor.row, selection.end.row),
    bottom: Math.max(selection.anchor.row, selection.end.row),
    left: Math.min(selection.anchor.col, selection.end.col),
    right: Math.max(selection.anchor.col, selection.end.col),
  };
}

export function cArmCellSelected(bounds, row, col) {
  return Boolean(bounds && row >= bounds.top && row <= bounds.bottom && col >= bounds.left && col <= bounds.right);
}

export function copyCArmSelection(document, bounds) {
  if (!bounds) return '';
  const cols = cArmColumns(document);
  const colCount = Math.max(1, cols.length);
  return Array.from({ length: bounds.bottom - bounds.top + 1 }, (_, r) => (
    Array.from({ length: bounds.right - bounds.left + 1 }, (_, c) => {
      const column = bounds.left + c;
      const personIndex = Math.floor(column / colCount);
      const person = document.radiographers[personIndex];
      if (!person) return '';
      const colId = cols[column % colCount]?.id;
      return person.days[bounds.top + r]?.[colId] ?? '';
    }).join('\t')
  )).join('\n');
}

export function clearCArmSelection(document, bounds) {
  if (!bounds) return document;
  const cols = cArmColumns(document);
  const colCount = Math.max(1, cols.length);
  return {
    ...document,
    radiographers: document.radiographers.map((person, index) => {
      const startCol = index * colCount;
      const endCol = startCol + colCount - 1;
      if (startCol > bounds.right || endCol < bounds.left) return person;
      const days = { ...person.days };
      for (let day = bounds.top; day <= bounds.bottom; day += 1) {
        days[day] = { ...days[day] };
        for (let offset = 0; offset < colCount; offset += 1) {
          if (cArmCellSelected(bounds, day, startCol + offset)) {
            const colId = cols[offset]?.id;
            days[day][colId] = null;
          }
        }
      }
      return { ...person, days };
    }),
  };
}
