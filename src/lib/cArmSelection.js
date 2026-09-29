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
  return Array.from({ length: bounds.bottom - bounds.top + 1 }, (_, r) => (
    Array.from({ length: bounds.right - bounds.left + 1 }, (_, c) => {
      const column = bounds.left + c;
      const person = document.radiographers[Math.floor(column / 2)];
      return person.days[bounds.top + r]?.[column % 2 === 0 ? 'first' : 'returning'] ?? '';
    }).join('\t')
  )).join('\n');
}

export function clearCArmSelection(document, bounds) {
  if (!bounds) return document;
  return { ...document, radiographers: document.radiographers.map((person, index) => {
    if (index * 2 > bounds.right || index * 2 + 1 < bounds.left) return person;
    const days = { ...person.days };
    for (let day = bounds.top; day <= bounds.bottom; day += 1) {
      days[day] = { ...days[day] };
      for (let offset = 0; offset < 2; offset += 1) {
        if (cArmCellSelected(bounds, day, index * 2 + offset)) days[day][offset === 0 ? 'first' : 'returning'] = null;
      }
    }
    return { ...person, days };
  }) };
}
