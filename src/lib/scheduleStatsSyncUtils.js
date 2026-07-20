export function getScheduleStatsMonthValue(year, month) {
  const safeYear = Number(year);
  const safeMonth = Number(month);
  if (!Number.isFinite(safeYear) || !Number.isFinite(safeMonth)) return null;
  return safeYear * 12 + safeMonth;
}

export function shouldOverwriteExistingStatsForScheduleSync({
  year,
  month,
  overwriteManual = false,
  scheduleAuthoritative = false,
  today = new Date(),
} = {}) {
  if (scheduleAuthoritative) return true;
  if (overwriteManual) return true;

  const targetValue = getScheduleStatsMonthValue(year, month);
  const todayValue = getScheduleStatsMonthValue(today.getFullYear(), today.getMonth() + 1);
  if (targetValue === null || todayValue === null) return false;

  return targetValue < todayValue;
}

export function buildScheduleStatsSyncMutation({
  existingRows = [],
  rebuiltRows = [],
  overwriteExistingStats = false,
  getRowCellKey = (row) => row?.scheduler_cell_key,
  isSameRow = () => false,
} = {}) {
  const safeExistingRows = Array.isArray(existingRows) ? existingRows : [];
  const safeRebuiltRows = Array.isArray(rebuiltRows) ? rebuiltRows : [];
  const rebuiltCellKeys = new Set(safeRebuiltRows.map((row) => getRowCellKey(row)).filter(Boolean));

  if (overwriteExistingStats) {
    const seenExistingKeys = new Set();
    return {
      toDeleteIds: safeExistingRows
        .filter((row) => {
          const rowKey = getRowCellKey(row);
          if (!rowKey || !rebuiltCellKeys.has(rowKey)) return true;
          if (seenExistingKeys.has(rowKey)) return true;
          seenExistingKeys.add(rowKey);
          return false;
        })
        .map((row) => row?.id)
        .filter(Boolean),
      rowsToUpsert: safeRebuiltRows,
    };
  }

  const toDeleteIds = safeExistingRows
    .filter((row) => {
      if (row?.source === 'manual') return false;
      const rowKey = getRowCellKey(row);
      return !rowKey || !rebuiltCellKeys.has(rowKey);
    })
    .map((row) => row?.id)
    .filter(Boolean);

  const rowsToUpsert = safeRebuiltRows.filter((newRow) => {
    const newKey = getRowCellKey(newRow);
    const existing = safeExistingRows.find((oldRow) => getRowCellKey(oldRow) === newKey);
    if (!existing) return true;
    return !isSameRow(existing, newRow);
  });

  return {
    toDeleteIds,
    rowsToUpsert,
  };
}

export function getStatsMonthDateRange(year, month) {
  const safeYear = Number(year);
  const safeMonth = Number(month);
  if (!Number.isFinite(safeYear) || !Number.isFinite(safeMonth)) {
    return { startDate: '', endDate: '' };
  }

  const daysInMonth = new Date(safeYear, safeMonth, 0).getDate();
  return {
    startDate: `${safeYear}-${String(safeMonth).padStart(2, '0')}-01`,
    endDate: `${safeYear}-${String(safeMonth).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`,
  };
}

export async function fetchStatsRowsForDateRange({
  supabaseClient,
  tableName,
  startDate,
  endDate,
  select = '*',
  pageSize = 1000,
} = {}) {
  if (!supabaseClient || !tableName || !startDate || !endDate) return [];

  const rows = [];
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabaseClient
      .from(tableName)
      .select(select)
      .gte('date', startDate)
      .lte('date', endDate)
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) throw error;
    if (Array.isArray(data)) rows.push(...data);

    hasMore = Array.isArray(data) && data.length >= pageSize;
    page += 1;
  }

  return rows;
}

export async function replaceStatsRowsForDateRange({
  supabaseClient,
  tableName,
  startDate,
  endDate,
  rows = [],
  preserveManualSource = false,
  chunkSize = 500,
  isFallbackInsertError = () => false,
  mapFallbackRow = (row) => row,
} = {}) {
  if (!supabaseClient || !tableName || !startDate || !endDate) {
    return { deleted: 0, inserted: 0 };
  }

  let deleteQuery = supabaseClient
    .from(tableName)
    .delete()
    .gte('date', startDate)
    .lte('date', endDate);

  if (preserveManualSource) {
    deleteQuery = deleteQuery.neq('source', 'manual');
  }

  const { error: deleteError } = await deleteQuery;
  if (deleteError) throw deleteError;

  const safeRows = Array.isArray(rows) ? rows : [];
  let inserted = 0;

  for (let i = 0; i < safeRows.length; i += chunkSize) {
    const chunk = safeRows.slice(i, i + chunkSize);
    const { error: insertError } = await supabaseClient
      .from(tableName)
      .insert(chunk);

    if (insertError) {
      if (!isFallbackInsertError(insertError)) throw insertError;
      const fallbackRows = chunk.map(mapFallbackRow);
      const { error: fallbackInsertError } = await supabaseClient
        .from(tableName)
        .insert(fallbackRows);
      if (fallbackInsertError) throw fallbackInsertError;
    }

    inserted += chunk.length;
  }

  return { deleted: null, inserted };
}
