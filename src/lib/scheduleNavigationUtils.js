export const DEFAULT_SCHEDULE_STICKY_TOP_OFFSET = 76;
export const SCHEDULE_STICKY_HEADER_GAP = 10;
const SCHEDULE_SCROLL_END_TOLERANCE_PX = 2;

export function getScheduleWheelWeekDirection(event) {
  const hasShortcutModifier = Boolean(event?.ctrlKey || event?.metaKey);
  if (!hasShortcutModifier || event?.altKey || event?.shiftKey) return 0;

  const deltaY = Number(event?.deltaY);
  if (!Number.isFinite(deltaY) || deltaY === 0) return 0;
  return deltaY < 0 ? -1 : 1;
}

export function getVisibleScheduleWeekIndex(weekTops, anchorY, scrollMetrics = null) {
  if (!Array.isArray(weekTops) || weekTops.length === 0) return -1;

  const resolvedAnchorY = Number(anchorY);
  if (!Number.isFinite(resolvedAnchorY)) return -1;

  let firstWeekIdx = -1;
  let lastWeekIdx = -1;
  let currentWeekIdx = -1;
  weekTops.forEach((weekTop, idx) => {
    const resolvedWeekTop = Number(weekTop);
    if (!Number.isFinite(resolvedWeekTop)) return;
    if (firstWeekIdx < 0) firstWeekIdx = idx;
    lastWeekIdx = idx;
    if (resolvedWeekTop <= resolvedAnchorY) currentWeekIdx = idx;
  });

  const scrollY = Number(scrollMetrics?.scrollY);
  const viewportHeight = Number(scrollMetrics?.viewportHeight);
  const scrollHeight = Number(scrollMetrics?.scrollHeight);
  const isAtScrollableEnd = Number.isFinite(scrollY)
    && Number.isFinite(viewportHeight)
    && Number.isFinite(scrollHeight)
    && viewportHeight > 0
    && scrollHeight > viewportHeight
    && scrollY + viewportHeight >= scrollHeight - SCHEDULE_SCROLL_END_TOLERANCE_PX;
  if (isAtScrollableEnd && lastWeekIdx >= 0) return lastWeekIdx;

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
