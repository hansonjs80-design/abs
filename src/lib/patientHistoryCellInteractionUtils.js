import {
  findBodyPartPresetItem,
  replaceBodyPartPreset,
} from './bodyPartPresetUtils.js';
import {
  parsePatientHistoryBodyPartText,
  parsePatientHistoryMemoText,
} from './patientHistoryModalUtils.js';
import {
  formatBodyPartInput,
  normalizeBodyPartKey,
} from './schedulerUtils.js';

export const PATIENT_HISTORY_BODY_ACTION_TYPES = new Set([
  'bodyPart',
  'bodyPartAdd',
  'bodyPartRemove',
  'bodyPartDeleteValue',
  'bodyPartEdit',
  'bodyPartMove',
  'bodyPartClear',
  'bodyPartToggle',
  'bodyPartPreset',
]);

export const PATIENT_HISTORY_MEMO_ACTION_TYPES = new Set([
  'memoAdd',
  'memoRemove',
  'memoUpdate',
  'memoMove',
]);

export function normalizePatientHistoryCellValue(field, rawValue) {
  if (field === 'body_part') {
    return parsePatientHistoryBodyPartText(rawValue)
      .map((item) => formatBodyPartInput(item))
      .filter(Boolean)
      .join(', ');
  }
  if (field === 'memo') {
    return parsePatientHistoryMemoText(rawValue).join('\n');
  }
  return String(rawValue || '').trim();
}

export function getPatientHistoryCellClipboardText(field, rawValue) {
  if (field === 'body_part') {
    return parsePatientHistoryBodyPartText(rawValue).join('\n');
  }
  if (field === 'memo') {
    return parsePatientHistoryMemoText(rawValue).join('\n');
  }
  return String(rawValue || '');
}

const normalizeParts = (parts) => (
  (parts || []).map((part) => formatBodyPartInput(part)).filter(Boolean)
);

export function applyPatientHistoryBodyPartAction(rawValue, action = {}) {
  const currentParts = normalizeParts(parsePatientHistoryBodyPartText(rawValue));
  let nextParts = [...currentParts];

  switch (action.type) {
    case 'bodyPart':
      return normalizePatientHistoryCellValue('body_part', action.value);
    case 'bodyPartAdd': {
      const nextPart = formatBodyPartInput(action.value);
      if (nextPart) nextParts.push(nextPart);
      break;
    }
    case 'bodyPartRemove': {
      const targetIndex = Number(action.index);
      if (Number.isInteger(targetIndex)) {
        nextParts = nextParts.filter((_, index) => index !== targetIndex);
      }
      break;
    }
    case 'bodyPartDeleteValue': {
      const targetKey = normalizeBodyPartKey(action.value);
      nextParts = nextParts.filter((part) => normalizeBodyPartKey(part) !== targetKey);
      break;
    }
    case 'bodyPartEdit': {
      const targetIndex = Number(action.index);
      const nextPart = formatBodyPartInput(action.value);
      const sourceParts = Array.isArray(action.parts) && action.parts.length > 0
        ? normalizeParts(action.parts)
        : nextParts;
      if (Number.isInteger(targetIndex) && nextPart && targetIndex >= 0 && targetIndex < sourceParts.length) {
        nextParts = sourceParts.map((part, index) => (index === targetIndex ? nextPart : part));
      }
      break;
    }
    case 'bodyPartMove': {
      const fromIndex = Number(action.index);
      const offset = action.direction === 'up' ? -1 : action.direction === 'down' ? 1 : 0;
      const toIndex = fromIndex + offset;
      if (Number.isInteger(fromIndex) && offset !== 0 && fromIndex >= 0 && toIndex >= 0 && fromIndex < nextParts.length && toIndex < nextParts.length) {
        const [moved] = nextParts.splice(fromIndex, 1);
        nextParts.splice(toIndex, 0, moved);
      }
      break;
    }
    case 'bodyPartClear':
      nextParts = [];
      break;
    case 'bodyPartToggle': {
      const targetPart = formatBodyPartInput(action.value);
      const targetKey = normalizeBodyPartKey(targetPart);
      const targetIndex = nextParts.findIndex((part) => normalizeBodyPartKey(part) === targetKey);
      if (targetIndex >= 0) nextParts.splice(targetIndex, 1);
      else if (targetPart) nextParts.push(targetPart);
      break;
    }
    case 'bodyPartPreset': {
      const presetItem = findBodyPartPresetItem(action.presetId);
      if (presetItem) {
        nextParts = replaceBodyPartPreset(
          nextParts,
          presetItem,
          action.isSelected,
          action.directions,
        );
      }
      break;
    }
    default:
      return normalizePatientHistoryCellValue('body_part', rawValue);
  }

  return normalizeParts(nextParts).join(', ');
}

export function applyPatientHistoryMemoAction(rawValue, action = {}) {
  let nextItems = parsePatientHistoryMemoText(rawValue);

  switch (action.type) {
    case 'memoAdd': {
      const nextValue = String(action.value || '').trim();
      if (nextValue) nextItems = [...nextItems, nextValue];
      break;
    }
    case 'memoRemove': {
      const targetIndex = Number(action.index);
      if (Number.isInteger(targetIndex)) {
        nextItems = nextItems.filter((_, index) => index !== targetIndex);
      }
      break;
    }
    case 'memoUpdate': {
      const targetIndex = Number(action.index);
      if (Array.isArray(action.memos)) {
        nextItems = action.memos;
      } else if (Number.isInteger(targetIndex)) {
        nextItems = nextItems.map((item, index) => (
          index === targetIndex ? action.value : item
        ));
      }
      break;
    }
    case 'memoMove': {
      const fromIndex = Number(action.index);
      const offset = action.direction === 'up' ? -1 : action.direction === 'down' ? 1 : 0;
      const toIndex = fromIndex + offset;
      if (Number.isInteger(fromIndex) && offset !== 0 && fromIndex >= 0 && toIndex >= 0 && fromIndex < nextItems.length && toIndex < nextItems.length) {
        nextItems = [...nextItems];
        const [moved] = nextItems.splice(fromIndex, 1);
        nextItems.splice(toIndex, 0, moved);
      }
      break;
    }
    default:
      break;
  }

  return parsePatientHistoryMemoText(nextItems.join('\n')).join('\n');
}

export function isPatientHistoryEditorAction(field, action) {
  if (!action || typeof action !== 'object') return false;
  return field === 'body_part'
    ? PATIENT_HISTORY_BODY_ACTION_TYPES.has(action.type)
    : field === 'memo' && PATIENT_HISTORY_MEMO_ACTION_TYPES.has(action.type);
}
