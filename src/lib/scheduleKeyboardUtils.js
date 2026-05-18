export function isMetaEvent(event) {
  return Boolean(event?.metaKey || event?.ctrlKey);
}

function isKey(event, code, key) {
  const eventKey = typeof event?.key === 'string' ? event.key.toLowerCase() : '';
  return event?.code === code || eventKey === key;
}

export function isPatientHistoryShortcut(event) {
  return isMetaEvent(event) && isKey(event, 'KeyF', 'f');
}

export function isBodyPartMenuShortcut(event) {
  return isMetaEvent(event) && event?.key === 'Enter';
}

export function isTreatmentCompleteShortcut(event) {
  return isMetaEvent(event) && isKey(event, 'KeyS', 's');
}

export function isMergeShortcut(event) {
  return isMetaEvent(event) && isKey(event, 'KeyG', 'g');
}

export function isTreatmentCancelShortcut(event) {
  return isMetaEvent(event) && isKey(event, 'KeyD', 'd');
}

export function isHolidayBackgroundShortcut(event) {
  return isMetaEvent(event) && isKey(event, 'KeyB', 'b');
}

export function isGridNavigationKey(event) {
  return ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event?.key);
}

export function getEditingCellKeyAction(event) {
  if (event?.key === 'Escape') return 'close-edit';
  return 'allow-input';
}
