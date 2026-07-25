export const DEFAULT_SCHEDULE_STICKY_TOP_OFFSET = 76;
export const SCHEDULE_STICKY_HEADER_GAP = 10;

export function getScheduleWheelWeekDirection(event) {
  const hasShortcutModifier = Boolean(event?.ctrlKey || event?.metaKey);
  if (!hasShortcutModifier || event?.altKey || event?.shiftKey) return 0;

  const deltaY = Number(event?.deltaY);
  if (!Number.isFinite(deltaY) || deltaY === 0) return 0;
  return deltaY < 0 ? -1 : 1;
}

export function getVisibleScheduleWeekIndex(weekTops, anchorY) {
  if (!Array.isArray(weekTops) || weekTops.length === 0) return -1;

  const resolvedAnchorY = Number(anchorY);
  if (!Number.isFinite(resolvedAnchorY)) return -1;

  let firstWeekIdx = -1;
  let currentWeekIdx = -1;
  weekTops.forEach((weekTop, idx) => {
    const resolvedWeekTop = Number(weekTop);
    if (!Number.isFinite(resolvedWeekTop)) return;
    if (firstWeekIdx < 0) firstWeekIdx = idx;
    if (resolvedWeekTop <= resolvedAnchorY) currentWeekIdx = idx;
  });

  return currentWeekIdx >= 0 ? currentWeekIdx : firstWeekIdx;
}

export function getScheduleStickyTopOffset(documentObject) {
  const resolvedDocument = documentObject
    || (typeof document !== 'undefined' ? document : null);
  const headerRect = resolvedDocument
    ?.querySelector?.('.top-tabs-shell')
    ?.getBoundingClientRect?.();
  const headerBottom = Number(headerRect?.bottom);

  if (!Number.isFinite(headerBottom) || headerBottom <= 0) {
    return DEFAULT_SCHEDULE_STICKY_TOP_OFFSET;
  }

  return Math.ceil(headerBottom + SCHEDULE_STICKY_HEADER_GAP);
}
