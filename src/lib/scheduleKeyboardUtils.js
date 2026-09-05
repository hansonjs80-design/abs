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

export function formatScheduleShortcutLabel(value, modifier = 'Ctrl') {
  const normalized = normalizeScheduleShortcutValue(value);
  if (!normalized) return '';
  const keyLabel = normalized === ' ' ? 'Space' : normalized;
  return String(modifier).startsWith('⌘') ? `${modifier}${keyLabel}` : `${modifier}+${keyLabel}`;
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

function findPrescriptionByShortcut(shortcuts, shortcutKey, hiddenPrescriptions) {
  return Object.keys(shortcuts || {}).find((prescription) => (
    normalizeScheduleShortcutValue(shortcuts[prescription]) === shortcutKey
      && !hiddenPrescriptions.has(prescription)
  ));
}

export function resolveSchedulePrescriptionShortcut(event, {
  manualShortcuts = {},
  shockwaveShortcuts = {},
  shinjangShortcuts = {},
  hiddenPrescriptions = [],
} = {}) {
  const shortcutKey = getScheduleShortcutKey(event);
  const hidden = new Set(hiddenPrescriptions || []);
  const isManualModifier = Boolean(
    event?.altKey && !event?.metaKey && !event?.ctrlKey && !event?.shiftKey
  );

  if (isManualModifier && /^[1-9]$/.test(shortcutKey)) {
    const prescription = findPrescriptionByShortcut(manualShortcuts, shortcutKey, hidden);
    return prescription
      ? { type: 'manual_therapy', prescription, shortcutKey }
      : null;
  }

  const isShinjangModifier = Boolean(
    (event?.metaKey || event?.ctrlKey) && event?.shiftKey && !event?.altKey
  );
  if (isShinjangModifier && /^[1-9A-Z]$/.test(shortcutKey)) {
    const prescription = findPrescriptionByShortcut(shinjangShortcuts, shortcutKey, hidden);
    return prescription
      ? { type: 'shinjang_spray', prescription, shortcutKey }
      : null;
  }

  const isShockwaveModifier = Boolean(
    (event?.metaKey || event?.ctrlKey) && !event?.shiftKey && !event?.altKey
  );
  if (isShockwaveModifier && /^[1-9A-Z]$/.test(shortcutKey)) {
    const prescription = findPrescriptionByShortcut(shockwaveShortcuts, shortcutKey, hidden);
    return prescription
      ? { type: 'shockwave', prescription, shortcutKey }
      : null;
  }

  return null;
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

export function isMemoMenuShortcut(event) {
  return isMetaEvent(event) && (
    event?.code === 'Equal' ||
    event?.code === 'NumpadAdd' ||
    event?.key === '+' ||
    event?.key === '='
  );
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

export function getShiftArrowMoveDelta(event) {
  if (!event?.shiftKey) return null;
  switch (event.key) {
    case 'ArrowUp':
      return { rowDelta: -1, colDelta: 0 };
    case 'ArrowDown':
      return { rowDelta: 1, colDelta: 0 };
    case 'ArrowLeft':
      return { rowDelta: 0, colDelta: -1 };
    case 'ArrowRight':
      return { rowDelta: 0, colDelta: 1 };
    default:
      return null;
  }
}

export function getEditingCellKeyAction(event) {
  if (event?.key === 'Escape') return 'close-edit';
  return 'allow-input';
}
