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
  preferredType = null,
} = {}) {
  const shortcutKey = getScheduleShortcutKey(event);
  const hidden = new Set(hiddenPrescriptions || []);

  // 1. 신장분사: 윈도우 Alt / 맥 Option + 숫자 또는 영문
  const isShinjangModifier = Boolean(
    event?.altKey && !event?.metaKey && !event?.ctrlKey && !event?.shiftKey
  );
  if (isShinjangModifier && /^[1-9A-Z]$/.test(shortcutKey)) {
    const prescription = findPrescriptionByShortcut(shinjangShortcuts, shortcutKey, hidden);
    if (prescription) {
      return { type: 'shinjang_spray', prescription, shortcutKey };
    }
  }

  // 기존 Ctrl/Cmd + Shift 신장분사 조합도 하위 호환 지원
  const isLegacyShinjangModifier = Boolean(
    (event?.metaKey || event?.ctrlKey) && event?.shiftKey && !event?.altKey
  );
  if (isLegacyShinjangModifier && /^[1-9A-Z]$/.test(shortcutKey)) {
    const prescription = findPrescriptionByShortcut(shinjangShortcuts, shortcutKey, hidden);
    if (prescription) {
      return { type: 'shinjang_spray', prescription, shortcutKey };
    }
  }

  // 2. 도수치료 및 충격파: 윈도우 Ctrl / 맥 Cmd + 숫자 또는 영문
  const isMetaModifier = Boolean(
    (event?.metaKey || event?.ctrlKey) && !event?.shiftKey && !event?.altKey
  );
  if (isMetaModifier && /^[1-9A-Z]$/.test(shortcutKey)) {
    if (preferredType === 'manual_therapy') {
      const manualPrescription = findPrescriptionByShortcut(manualShortcuts, shortcutKey, hidden);
      if (manualPrescription) {
        return { type: 'manual_therapy', prescription: manualPrescription, shortcutKey };
      }
      const shockwavePrescription = findPrescriptionByShortcut(shockwaveShortcuts, shortcutKey, hidden);
      if (shockwavePrescription) {
        return { type: 'shockwave', prescription: shockwavePrescription, shortcutKey };
      }
    } else {
      const shockwavePrescription = findPrescriptionByShortcut(shockwaveShortcuts, shortcutKey, hidden);
      if (shockwavePrescription) {
        return { type: 'shockwave', prescription: shockwavePrescription, shortcutKey };
      }
      const manualPrescription = findPrescriptionByShortcut(manualShortcuts, shortcutKey, hidden);
      if (manualPrescription) {
        return { type: 'manual_therapy', prescription: manualPrescription, shortcutKey };
      }
    }
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
