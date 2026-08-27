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

export function collectUniqueScheduleMonthTargets(...targetGroups) {
  const seen = new Set();
  const targets = [];

  targetGroups.flat().filter(Boolean).forEach((target) => {
    const year = Number(target?.year);
    const month = Number(target?.month);
    if (!Number.isFinite(year) || !Number.isFinite(month)) return;

    const key = `${year}-${month}`;
    if (seen.has(key)) return;
    seen.add(key);
    targets.push({ year, month });
  });

  return targets;
}

export function canStorePreloadedScheduleView({
  expectedVersion,
  currentVersion,
  isComplete,
  hasRelocations,
}) {
  return (
    Number(expectedVersion) === Number(currentVersion) &&
    isComplete === true &&
    hasRelocations !== true
  );
}

export function getStaffScheduleViewKey(year, month, includeAdjacentMonths = false) {
  return `${Number(year)}-${Number(month)}-${includeAdjacentMonths ? 'adj' : 'single'}`;
}

export function isStaffScheduleViewReady(
  loadedViewKey,
  year,
  month,
  includeAdjacentMonths = false
) {
  return loadedViewKey === getStaffScheduleViewKey(
    year,
    month,
    includeAdjacentMonths
  );
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
    isComplete: hasCurrentMonthRows && missingTargets.length === 0,
  };
}

function isSameScheduleRow(left, right) {
  const rightId = right?.id;
  if (rightId !== undefined && rightId !== null && String(rightId) !== '') {
    if (String(left?.id ?? '') === String(rightId)) return true;
  }

  const coordinateKeys = [
    'year',
    'month',
    'week_index',
    'day_index',
    'row_index',
    'col_index',
  ];
  if (!coordinateKeys.every((key) => right?.[key] !== undefined && right?.[key] !== null)) {
    return false;
  }
  return coordinateKeys.every((key) => Number(left?.[key]) === Number(right[key]));
}

export function updateCachedScheduleRowsFromRealtime(cachedRows, item, { remove = false } = {}) {
  if (!Array.isArray(cachedRows) || !item) return cachedRows;

  const rowIndex = cachedRows.findIndex((row) => isSameScheduleRow(row, item));
  if (remove) {
    if (rowIndex < 0) return cachedRows;
    return cachedRows.filter((_, index) => index !== rowIndex);
  }

  if (rowIndex < 0) {
    return [...cachedRows, item];
  }

  const nextRows = [...cachedRows];
  nextRows[rowIndex] = {
    ...cachedRows[rowIndex],
    ...item,
  };
  return nextRows;
}

export function getScheduleRealtimePayloadKind(payload) {
  if (payload?.eventType === 'DELETE') return 'delete';
  if (
    payload?.new &&
    typeof payload.new === 'object' &&
    Object.keys(payload.new).length > 0
  ) {
    return 'upsert';
  }
  return 'unknown';
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
