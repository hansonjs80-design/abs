export const MOBILE_SCHEDULE_CELL_MIN_FONT_SIZE = 8;

const toPositiveNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};

export function getMobileScheduleCellFitFontSize({
  baseFontSize,
  contentWidth,
  contentHeight,
  availableWidth,
  availableHeight,
  minFontSize = MOBILE_SCHEDULE_CELL_MIN_FONT_SIZE,
  safetyFactor = 0.97,
}) {
  const baseSize = toPositiveNumber(baseFontSize);
  const measuredWidth = toPositiveNumber(contentWidth);
  const measuredHeight = toPositiveNumber(contentHeight);
  const usableWidth = toPositiveNumber(availableWidth);
  const usableHeight = toPositiveNumber(availableHeight);

  if (!baseSize || !measuredWidth || !measuredHeight || !usableWidth || !usableHeight) {
    return baseSize || 0;
  }

  if (measuredWidth <= usableWidth && measuredHeight <= usableHeight) {
    return baseSize;
  }

  const safeFactor = Math.min(1, Math.max(0.8, Number(safetyFactor) || 0.97));
  const scale = Math.min(
    1,
    usableWidth / measuredWidth,
    usableHeight / measuredHeight
  );
  const lowerBound = Math.min(
    baseSize,
    toPositiveNumber(minFontSize) || MOBILE_SCHEDULE_CELL_MIN_FONT_SIZE
  );
  const fittedSize = Math.max(lowerBound, baseSize * scale * safeFactor);

  return Math.floor(fittedSize * 10) / 10;
}
