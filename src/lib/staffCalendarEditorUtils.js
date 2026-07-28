export function getStaffMemoDisplayText({
  content = '',
  holidayName = '',
  isEditing = false,
  isDepartmentHidden = false,
} = {}) {
  if (isEditing || isDepartmentHidden) return '';
  return content || holidayName || '';
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
