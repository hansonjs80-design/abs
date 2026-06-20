export function isMergedChildScheduleItem(item) {
  return Boolean(item?.merge_span?.mergedInto);
}

export function sanitizeShockwaveScheduleItemForDisplay(item) {
  if (!item || !isMergedChildScheduleItem(item)) return item;
  return {
    ...item,
    content: '',
    bg_color: null,
    prescription: null,
    body_part: null,
  };
}

export function isIntentionalClearScheduleItem(item) {
  return Boolean(item?.merge_span?.meta?.intentional_clear === true);
}
