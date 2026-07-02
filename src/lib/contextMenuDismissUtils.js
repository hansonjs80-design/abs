export const CONTEXT_MENU_DISMISS_GRACE_MS = 350;

export function isSchedulerCellContextMenuTarget(target) {
  return Boolean(target?.closest?.('.sw-cell'));
}

export function shouldIgnoreContextMenuDismissEvent(contextMenu, event, now = Date.now()) {
  if (!contextMenu) return false;
  if (event?.button === 2) return true;

  const openedAt = Number(contextMenu.openedAt || 0);
  if (!openedAt) return false;

  const elapsed = now - openedAt;
  return elapsed >= 0 && elapsed < CONTEXT_MENU_DISMISS_GRACE_MS;
}
