export function getScheduleMemoKey(item) {
  if (!item) return '';
  return `${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`;
}

export function applyShockwaveMemoStateUpdate(prev, key, memo, shouldKeepMemo) {
  const next = { ...(prev || {}) };
  if (shouldKeepMemo(memo)) next[key] = memo;
  else delete next[key];
  return next;
}

export function rollbackShockwaveMemoState(prev, previousMemos) {
  const next = { ...(prev || {}) };
  Object.entries(previousMemos || {}).forEach(([key, memo]) => {
    if (memo === undefined) delete next[key];
    else next[key] = memo;
  });
  return next;
}

export function buildOptimisticShockwaveMemos(currentMemos, items, updatedAt) {
  const previousMemos = {};
  const optimisticMemos = {};

  (items || []).forEach((item) => {
    const key = getScheduleMemoKey(item);
    if (!key || key.includes('undefined')) return;
    previousMemos[key] = currentMemos?.[key];
    optimisticMemos[key] = {
      ...(currentMemos?.[key] || {}),
      ...item,
      updated_at: updatedAt,
    };
  });

  return { previousMemos, optimisticMemos };
}

function toFiniteInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

export function buildShockwaveScheduleDeleteFilters(items, chunkSize = 50) {
  const filters = [];
  let currentChunk = [];
  const seen = new Set();

  const flush = () => {
    if (currentChunk.length > 0) {
      filters.push(currentChunk.join(','));
      currentChunk = [];
    }
  };

  (items || []).forEach((item) => {
    const year = toFiniteInteger(item?.year);
    const month = toFiniteInteger(item?.month);
    const week = toFiniteInteger(item?.week_index);
    const day = toFiniteInteger(item?.day_index);
    const row = toFiniteInteger(item?.row_index);
    const col = toFiniteInteger(item?.col_index);
    if ([year, month, week, day, row, col].some((value) => value === null)) return;

    const dedupeKey = `${year}-${month}-${week}-${day}-${row}-${col}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);

    currentChunk.push(
      `and(year.eq.${year},month.eq.${month},week_index.eq.${week},day_index.eq.${day},row_index.eq.${row},col_index.eq.${col})`
    );
    if (currentChunk.length >= chunkSize) flush();
  });

  flush();
  return filters;
}
