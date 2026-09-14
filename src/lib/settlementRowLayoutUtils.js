// Merge only adjacent, known keys. Call separately for each table/group.
export function getConsecutiveRowSpan(rows, index, getKey) {
  const key = getKey(rows[index]);
  if (key == null) return 1;
  if (index > 0 && getKey(rows[index - 1]) === key) return 0;
  let span = 1;
  while (index + span < rows.length && getKey(rows[index + span]) === key) span += 1;
  return span;
}
