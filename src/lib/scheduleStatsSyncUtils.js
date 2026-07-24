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
  const existingRowsByCellKey = new Map();

  safeExistingRows.forEach((row) => {
    const rowKey = getRowCellKey(row);
    if (!rowKey) return;
    const group = existingRowsByCellKey.get(rowKey) || [];
    group.push(row);
    existingRowsByCellKey.set(rowKey, group);
  });

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

  const keptSchedulerKeys = new Set();
  const toDeleteIds = safeExistingRows
    .filter((row) => {
      if (row?.source === 'manual') return false;
      const rowKey = getRowCellKey(row);
      if (!rowKey || !rebuiltCellKeys.has(rowKey)) return true;

      const rowsForKey = existingRowsByCellKey.get(rowKey) || [];
      if (rowsForKey.some((candidate) => candidate?.source === 'manual')) return true;
      if (keptSchedulerKeys.has(rowKey)) return true;

      keptSchedulerKeys.add(rowKey);
      return false;
    })
    .map((row) => row?.id)
    .filter(Boolean);

  const rowsToUpsert = safeRebuiltRows.filter((newRow) => {
    const newKey = getRowCellKey(newRow);
    const existingRowsForKey = existingRowsByCellKey.get(newKey) || [];
    if (existingRowsForKey.some((row) => row?.source === 'manual')) return false;

    const existing = existingRowsForKey.find((row) => row?.source !== 'manual');
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

function getReplaceableExistingIds(existingRows, overwriteExistingStats) {
  return (Array.isArray(existingRows) ? existingRows : [])
    .filter((row) => overwriteExistingStats || row?.source !== 'manual')
    .map((row) => row?.id)
    .filter(Boolean);
}

async function deleteRowsByIds({
  supabaseClient,
  tableName,
  ids,
  chunkSize,
}) {
  const safeIds = Array.from(new Set((Array.isArray(ids) ? ids : []).filter(Boolean)));
  for (let index = 0; index < safeIds.length; index += chunkSize) {
    const chunk = safeIds.slice(index, index + chunkSize);
    const { error } = await supabaseClient
      .from(tableName)
      .delete()
      .in('id', chunk);
    if (error) throw error;
  }
  return safeIds.length;
}

/**
 * 통계 동기화 변경을 저장 성공 → 오래된 행 정리 순서로 적용합니다.
 * 저장이 실패하면 기존 행은 건드리지 않고, 정리 실패 시에도 새 행과 기존 행이
 * 함께 남을 뿐 기존 데이터가 먼저 사라지지 않습니다.
 */
export async function applyScheduleStatsMutation({
  supabaseClient,
  tableName,
  existingRows = [],
  toDeleteIds = [],
  rowsToUpsert = [],
  overwriteExistingStats = false,
  chunkSize = 100,
  isFallbackUpsertError = () => false,
  mapFallbackRow = (row) => row,
} = {}) {
  if (!supabaseClient || !tableName) {
    throw new Error('통계 동기화 저장 대상이 올바르지 않습니다.');
  }

  const safeChunkSize = Number.isInteger(chunkSize) && chunkSize > 0 ? chunkSize : 100;
  const safeRowsToUpsert = Array.isArray(rowsToUpsert) ? rowsToUpsert : [];
  let usedFallback = false;
  let fallbackError = null;
  let successfulUpsertChunks = 0;

  for (let index = 0; index < safeRowsToUpsert.length; index += safeChunkSize) {
    const chunk = safeRowsToUpsert.slice(index, index + safeChunkSize);

    if (!usedFallback) {
      const { error: upsertError } = await supabaseClient
        .from(tableName)
        .upsert(chunk, { onConflict: 'scheduler_cell_key' });

      if (!upsertError) {
        successfulUpsertChunks += 1;
        continue;
      }
      if (!isFallbackUpsertError(upsertError)) throw upsertError;
      if (successfulUpsertChunks > 0) throw upsertError;
      usedFallback = true;
      fallbackError = upsertError;
    }

    const fallbackRows = chunk.map((row) => mapFallbackRow(row, fallbackError));
    const { error: fallbackInsertError } = await supabaseClient
      .from(tableName)
      .insert(fallbackRows);
    if (fallbackInsertError) throw fallbackInsertError;
  }

  const cleanupIds = usedFallback
    ? [
        ...toDeleteIds,
        ...getReplaceableExistingIds(existingRows, overwriteExistingStats),
      ]
    : toDeleteIds;
  const deleted = await deleteRowsByIds({
    supabaseClient,
    tableName,
    ids: cleanupIds,
    chunkSize: safeChunkSize,
  });

  return {
    deleted,
    upserted: safeRowsToUpsert.length,
    usedFallback,
  };
}

export async function replaceStatsRowsForDateRange({
  supabaseClient,
  tableName,
  startDate,
  endDate,
  rows = [],
  existingRows = null,
  preserveManualSource = false,
  chunkSize = 500,
  isFallbackInsertError = () => false,
  mapFallbackRow = (row) => row,
} = {}) {
  if (!supabaseClient || !tableName || !startDate || !endDate) {
    return { deleted: 0, inserted: 0 };
  }

  const safeRows = Array.isArray(rows) ? rows : [];
  const safeExistingRows = Array.isArray(existingRows)
    ? existingRows
    : await fetchStatsRowsForDateRange({
        supabaseClient,
        tableName,
        startDate,
        endDate,
      });
  const { toDeleteIds, rowsToUpsert } = buildScheduleStatsSyncMutation({
    existingRows: safeExistingRows,
    rebuiltRows: safeRows,
    overwriteExistingStats: !preserveManualSource,
  });
  const result = await applyScheduleStatsMutation({
    supabaseClient,
    tableName,
    existingRows: safeExistingRows,
    toDeleteIds,
    rowsToUpsert,
    overwriteExistingStats: !preserveManualSource,
    chunkSize,
    isFallbackUpsertError: isFallbackInsertError,
    mapFallbackRow,
  });

  return { deleted: result.deleted, inserted: result.upserted };
}
