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

function getMemoTime(memo) {
  const time = memo?.updated_at ? new Date(memo.updated_at).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function isLikelySameMovedMemo(left, right) {
  return normalizeText(left?.content) &&
    normalizeText(left?.content) === normalizeText(right?.content) &&
    normalizeText(left?.prescription) === normalizeText(right?.prescription) &&
    normalizeText(left?.body_part) === normalizeText(right?.body_part) &&
    normalizeText(left?.bg_color) === normalizeText(right?.bg_color);
}

export function applyRealtimeShockwaveMemoUpdate(prev, key, memo, shouldKeepMemo) {
  const next = { ...(prev || {}) };
  if (!shouldKeepMemo(memo)) {
    delete next[key];
    return next;
  }

  const [week, day, , col] = String(key).split('-');
  const incomingTime = getMemoTime(memo);
  const duplicateKeys = Object.entries(next)
    .filter(([candidateKey, candidate]) => {
      if (candidateKey === key) return false;
      const [candidateWeek, candidateDay, , candidateCol] = String(candidateKey).split('-');
      if (candidateWeek !== week || candidateDay !== day || candidateCol !== col) return false;
      if (!isLikelySameMovedMemo(candidate, memo)) return false;
      const candidateTime = getMemoTime(candidate);
      return incomingTime === 0 || candidateTime === 0 || candidateTime <= incomingTime;
    })
    .map(([candidateKey]) => candidateKey);

  if (duplicateKeys.length === 1) {
    delete next[duplicateKeys[0]];
  }

  next[key] = memo;
  return next;
}
