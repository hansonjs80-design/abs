import { convertKoreanQwertyMistypeToEnglish } from './keyboardLayoutUtils.js';

export function isMetaEvent(event) {
  return Boolean(event?.metaKey || event?.ctrlKey);
}

export function normalizeScheduleShortcutValue(value) {
  const rawKey = String(value || '').trim();
  if (!rawKey) return '';
  if (rawKey === 'Spacebar' || rawKey === ' ') return ' ';
  if (rawKey.length === 1) {
    return convertKoreanQwertyMistypeToEnglish(rawKey).toUpperCase();
  }
  return rawKey.toUpperCase();
}

export function getScheduleShortcutKey(event) {
  const code = String(event?.code || '');
  const digitMatch = code.match(/^(?:Digit|Numpad)([0-9])$/);
  if (digitMatch) return digitMatch[1];

  const alphaMatch = code.match(/^Key([A-Z])$/);
  if (alphaMatch) return alphaMatch[1];

  if (code === 'Space') return ' ';

  const rawKey = typeof event?.key === 'string' ? event.key.trim() : '';
  if (!rawKey) return '';
  return normalizeScheduleShortcutValue(rawKey);
}

function isKey(event, code, key) {
  return event?.code === code || getScheduleShortcutKey(event) === String(key || '').toUpperCase();
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

export function isSameReservationGroupShortcut(event) {
  return isMetaEvent(event) && isKey(event, 'KeyQ', 'q');
}

export function isGridNavigationKey(event) {
  return ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event?.key);
}

export function getEditingCellKeyAction(event) {
  if (event?.key === 'Escape') return 'close-edit';
  return 'allow-input';
}
