export const DEFAULT_SCHEDULE_TIME_COL_WIDTH = 41;
export const MIN_SCHEDULE_TIME_COL_WIDTH = 32;
export const MAX_SCHEDULE_TIME_COL_WIDTH = 120;

export function clampScheduleTimeColWidth(value) {
  const numericValue = Number(value);
  const safeValue = Number.isFinite(numericValue)
    ? numericValue
    : DEFAULT_SCHEDULE_TIME_COL_WIDTH;

  return Math.min(
    MAX_SCHEDULE_TIME_COL_WIDTH,
    Math.max(MIN_SCHEDULE_TIME_COL_WIDTH, Math.round(safeValue)),
  );
}
