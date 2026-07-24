export const DEFAULT_SCHEDULE_STICKY_TOP_OFFSET = 76;
export const SCHEDULE_STICKY_HEADER_GAP = 10;

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
