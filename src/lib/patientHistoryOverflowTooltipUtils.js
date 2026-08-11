export function formatPatientHistoryOverflowTooltipItems(items = []) {
  return (Array.isArray(items) ? items : [items])
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .join('\n');
}

export function getPatientHistoryOverflowTooltipPosition({
  anchorRect,
  tooltipRect,
  viewportWidth,
  viewportHeight,
  margin = 12,
  gap = 8,
}) {
  const maxLeft = Math.max(margin, viewportWidth - tooltipRect.width - margin);
  const centeredLeft = anchorRect.left + (anchorRect.width / 2) - (tooltipRect.width / 2);
  const left = Math.min(Math.max(centeredLeft, margin), maxLeft);

  const belowTop = anchorRect.bottom + gap;
  const aboveTop = anchorRect.top - gap - tooltipRect.height;
  const maxTop = Math.max(margin, viewportHeight - tooltipRect.height - margin);
  const top = belowTop + tooltipRect.height <= viewportHeight - margin
    ? belowTop
    : (aboveTop >= margin ? aboveTop : Math.min(Math.max(belowTop, margin), maxTop));

  return { left, top };
}
