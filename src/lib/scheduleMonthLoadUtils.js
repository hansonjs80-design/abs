export function partitionVisibleScheduleMonthTargets(targets, currentYear, currentMonth) {
  const safeTargets = Array.isArray(targets) ? targets.filter(Boolean) : [];
  const currentTarget = safeTargets.find((target) => (
    Number(target?.year) === Number(currentYear) &&
    Number(target?.month) === Number(currentMonth)
  )) || { year: Number(currentYear), month: Number(currentMonth) };

  return {
    currentTarget,
    adjacentTargets: safeTargets.filter((target) => target !== currentTarget),
  };
}

export function collectVisibleScheduleMonthRows(
  targets,
  currentYear,
  currentMonth,
  getCachedRows
) {
  const safeTargets = Array.isArray(targets) ? targets.filter(Boolean) : [];
  const rows = [];
  const missingTargets = [];
  let hasCurrentMonthRows = false;

  safeTargets.forEach((target) => {
    const cachedRows = typeof getCachedRows === 'function'
      ? getCachedRows(target)
      : null;
    if (!Array.isArray(cachedRows)) {
      missingTargets.push(target);
      return;
    }

    rows.push(...cachedRows);
    if (
      Number(target?.year) === Number(currentYear) &&
      Number(target?.month) === Number(currentMonth)
    ) {
      hasCurrentMonthRows = true;
    }
  });

  return {
    rows,
    missingTargets,
    hasCurrentMonthRows,
  };
}

export function shiftScheduleMonth(year, month, delta) {
  const absoluteMonth = Number(year) * 12 + (Number(month) - 1) + Number(delta);
  return {
    year: Math.floor(absoluteMonth / 12),
    month: ((absoluteMonth % 12) + 12) % 12 + 1,
  };
}

export function shouldKeepScheduleMounted({
  currentMonthReady,
  lastLoadedMonthKey,
  loadError,
}) {
  if (currentMonthReady) return true;
  return Boolean(lastLoadedMonthKey) && !loadError;
}

export function normalizeLoadedScheduleMonthKey(loadedMonthKey, year, month) {
  const canonicalKey = `${Number(year)}-${String(Number(month)).padStart(2, '0')}`;
  const contextKey = `${Number(year)}-${Number(month)}`;
  return loadedMonthKey === canonicalKey || loadedMonthKey === contextKey
    ? canonicalKey
    : String(loadedMonthKey || '');
}
