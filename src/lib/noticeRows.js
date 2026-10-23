export const DEFAULT_NOTICE_ROW_COUNT = 6;
// The existing storage key reserves 100 slot indices for each month.
export const MAX_NOTICE_ROW_COUNT = 100;

export function getNoticeRowCount(notices, editingSlot = null, editValue = '') {
  let count = DEFAULT_NOTICE_ROW_COUNT;
  for (const notice of notices) {
    if (Number.isInteger(notice.slot_index) && notice.slot_index >= 0 && notice.slot_index < MAX_NOTICE_ROW_COUNT
      && String(notice.content ?? '').trim()) {
      count = Math.max(count, notice.slot_index + 2);
    }
  }
  if (Number.isInteger(editingSlot) && editingSlot >= 0 && editingSlot < MAX_NOTICE_ROW_COUNT) {
    // Keep an active editor mounted even when its last character is deleted.
    count = Math.max(count, editingSlot + (editValue.trim() ? 2 : 1));
  }
  return Math.min(count, MAX_NOTICE_ROW_COUNT);
}
