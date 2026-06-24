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
