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
    return {
      toDeleteIds: safeExistingRows
        .filter((row) => {
          const rowKey = getRowCellKey(row);
          return !rowKey || !rebuiltCellKeys.has(rowKey);
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
