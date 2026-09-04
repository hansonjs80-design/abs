const BODY_PART_PRESET_DIRECTION_MAP = {
  left: 'Lt.',
  right: 'Rt.',
};

export const BODY_PART_PRESET_DIRECTIONS = [
  { id: 'left', label: 'L' },
  { id: 'right', label: 'R' },
];

export const BODY_PART_PRESET_GROUPS = [
  {
    id: 'shoulder',
    label: '어깨',
    items: [
      {
        id: 'calcific-tendinitis',
        label: '석회성건염',
        aliases: ['석회성 건염'],
        code: 'M6521',
      },
      { id: 'rotator-cuff-tendinopathy', label: '회전근개건병증', code: 'M751' },
    ],
  },
  {
    id: 'elbow',
    label: '팔꿈치',
    items: [
      {
        id: 'lateral-epicondylitis',
        label: '외측상과염',
        aliases: ['외측 상과염'],
        code: 'M771',
      },
      { id: 'medial-epicondylitis', label: '내측상과염', code: 'M770' },
    ],
  },
  {
    id: 'hip',
    label: '고관절',
    items: [
      { id: 'hip-myofascial-pain', label: '근막통증', code: 'M79150' },
      { id: 'femoral-head-tendinitis', label: '대퇴골두염', code: 'M706' },
      { id: 'gluteal-tendinopathy', label: '둔부힘줄염', code: 'M760' },
      { id: 'itb-syndrome', label: 'ITB증후군', code: 'M7635' },
    ],
  },
  {
    id: 'knee',
    label: '슬관절',
    items: [
      { id: 'patellar-tendinitis', label: '슬개건염', code: 'M765' },
    ],
  },
  {
    id: 'ankle',
    label: '발목관절',
    items: [
      { id: 'achilles-tendinitis', label: '아킬레스건염', code: 'M766' },
    ],
  },
  {
    id: 'foot',
    label: '족부',
    items: [
      {
        id: 'plantar-fasciitis',
        label: '족저근막염',
        aliases: ['족저 근막염'],
        code: 'M722',
      },
    ],
  },
  {
    id: 'spine',
    label: '척추부',
    items: [
      { id: 'cervical-myofascial-pain', label: '경추근막통증', code: 'M79180' },
      {
        id: 'lumbar-spine-myofascial-pain',
        label: '요추/척추부근막통',
        aliases: ['요추/척추부 근막통'],
        code: 'M79180',
      },
    ],
  },
];

const BODY_PART_PRESET_ITEMS = BODY_PART_PRESET_GROUPS.flatMap((group) => group.items);

function normalizePresetValue(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\s*\(\s*/g, '(')
    .replace(/\s*\)/g, ')')
    .replace(/\s+/g, ' ')
    .trim();
}

function getBodyPartPresetLabels(item) {
  return Array.from(new Set([
    item?.label,
    ...(Array.isArray(item?.aliases) ? item.aliases : []),
  ].map((label) => String(label || '').trim()).filter(Boolean)));
}

function buildBodyPartPresetValueForLabel(item, label, directionId) {
  const bodyPart = `${label}(${String(item?.code || '').toUpperCase()})`;
  const direction = BODY_PART_PRESET_DIRECTION_MAP[directionId];
  return direction ? `${direction} ${bodyPart}` : bodyPart;
}

function isBodyPartPresetValueForDirection(value, item, directionId) {
  const normalizedValue = normalizePresetValue(value);
  return getBodyPartPresetLabels(item).some((label) => (
    normalizedValue === normalizePresetValue(
      buildBodyPartPresetValueForLabel(item, label, directionId)
    )
  ));
}

export function findBodyPartPresetItem(presetId) {
  return BODY_PART_PRESET_ITEMS.find((item) => item.id === presetId) || null;
}

export function findBodyPartPresetItemByValue(value) {
  return BODY_PART_PRESET_ITEMS.find((item) => isBodyPartPresetValue(value, item)) || null;
}

export function buildBodyPartPresetValue(item, directionId) {
  if (!item) return '';
  return buildBodyPartPresetValueForLabel(item, item.label, directionId);
}

export function getBodyPartPresetState(currentParts, item) {
  if (!item) return { isSelected: false, directions: [] };
  const directions = BODY_PART_PRESET_DIRECTIONS
    .filter(({ id }) => (currentParts || []).some((part) => (
      isBodyPartPresetValueForDirection(part, item, id)
    )))
    .map(({ id }) => id);
  const isSelected = directions.length > 0
    || (currentParts || []).some((part) => (
      isBodyPartPresetValueForDirection(part, item)
    ));
  return { isSelected, directions };
}

export function isBodyPartPresetValue(value, item) {
  if (!item) return false;
  return [undefined, ...BODY_PART_PRESET_DIRECTIONS.map(({ id }) => id)]
    .some((id) => isBodyPartPresetValueForDirection(value, item, id));
}

export function formatBodyPartPresetDisplayValue(value) {
  const normalizedValue = String(value || '').trim();
  const item = findBodyPartPresetItemByValue(normalizedValue);
  if (!item) return normalizedValue;

  const direction = BODY_PART_PRESET_DIRECTIONS.find(({ id }) => (
    isBodyPartPresetValueForDirection(normalizedValue, item, id)
  ));
  return buildBodyPartPresetValue(item, direction?.id);
}

export function formatBodyPartPresetDisplayText(value) {
  return String(value || '')
    .split(',')
    .map((part) => formatBodyPartPresetDisplayValue(part))
    .filter(Boolean)
    .join(', ');
}

export function replaceBodyPartPreset(currentParts, item, isSelected, directionIds = []) {
  if (!item) return Array.isArray(currentParts) ? [...currentParts] : [];

  const presetValueKeys = new Set(
    getBodyPartPresetLabels(item).flatMap((label) => (
      [undefined, ...BODY_PART_PRESET_DIRECTIONS.map(({ id }) => id)]
        .map((id) => normalizePresetValue(
          buildBodyPartPresetValueForLabel(item, label, id)
        ))
    ))
  );
  const preservedParts = (currentParts || []).filter((part) => (
    !presetValueKeys.has(normalizePresetValue(part))
  )).map((part) => formatBodyPartPresetDisplayValue(part));
  if (!isSelected) return preservedParts;

  const requestedDirections = new Set(directionIds || []);
  const selectedPresetParts = BODY_PART_PRESET_DIRECTIONS
    .filter(({ id }) => requestedDirections.has(id))
    .map(({ id }) => buildBodyPartPresetValue(item, id));

  return [...preservedParts, ...(selectedPresetParts.length > 0
    ? selectedPresetParts
    : [buildBodyPartPresetValue(item)])];
}

export function replaceBodyPartPresetOptions(options, item, nextParts) {
  const nextValueKeys = new Set(
    (nextParts || []).map((part) => normalizePresetValue(
      formatBodyPartPresetDisplayValue(part)
    ))
  );
  const optionMap = new Map();
  [...(options || []), ...(nextParts || [])]
    .filter((part) => !isBodyPartPresetValue(part, item)
      || nextValueKeys.has(normalizePresetValue(formatBodyPartPresetDisplayValue(part))))
    .forEach((part) => {
      const displayPart = formatBodyPartPresetDisplayValue(part);
      const key = normalizePresetValue(displayPart);
      if (key && !optionMap.has(key)) optionMap.set(key, displayPart);
    });
  return Array.from(optionMap.values());
}
