export function getStaffMemoDisplayText({
  content = '',
  holidayName = '',
  isEditing = false,
  isDepartmentHidden = false,
} = {}) {
  if (isEditing || isDepartmentHidden) return '';
  return content || holidayName || '';
}

export function getStaffHolidayDisplayStyle({
  holidayName = '',
  content = '',
  isOtherMonth = false,
} = {}) {
  if (!holidayName || content) return {};
  return {
    color: isOtherMonth ? 'var(--cal-other-month-text)' : '#e53e3e',
    fontWeight: 600,
  };
}

export function getStaffMemoEditorPosition(
  cellRect = {},
  containerRect = {},
  { scrollLeft = 0, scrollTop = 0 } = {}
) {
  return {
    left: Number(cellRect.left || 0) - Number(containerRect.left || 0) + Number(scrollLeft || 0),
    top: Number(cellRect.top || 0) - Number(containerRect.top || 0) + Number(scrollTop || 0),
  };
}

export function getStaffMemoEditorColors({
  backgroundColor = '',
  fontColor = '',
  computedBackgroundColor = '',
  computedColor = '',
} = {}) {
  const renderedBackground = String(computedBackgroundColor || '').trim();
  const hasRenderedBackground = (
    renderedBackground
    && renderedBackground !== 'transparent'
    && !/^rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)$/i.test(renderedBackground)
  );
  const baseBackground =
    String(backgroundColor || '').trim()
    || (hasRenderedBackground ? renderedBackground : '')
    || 'var(--bg-input, #fff)';

  return {
    background: `color-mix(in srgb, ${baseBackground} 88%, white 12%)`,
    color:
      String(fontColor || '').trim()
      || String(computedColor || '').trim()
      || 'var(--text-primary, #000)',
  };
}
