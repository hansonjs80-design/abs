const BODY_PART_PRESET_DIRECTION_MAP = {
  left: 'Lt.',
  right: 'Rt.',
};

export const BODY_PART_PRESET_DIRECTIONS = [
  { id: 'left', label: '좌' },
  { id: 'right', label: '우' },
];

export const BODY_PART_PRESET_GROUPS = [
  {
    id: 'shoulder',
    label: '어깨',
    items: [
      { id: 'calcific-tendinitis', label: '석회성 건염', code: 'M6521' },
      { id: 'rotator-cuff-tendinopathy', label: '회전근개건병증', code: 'M751' },
    ],
  },
  {
    id: 'elbow',
    label: '팔꿈치',
    items: [
      { id: 'lateral-epicondylitis', label: '외측 상과염', code: 'M771' },
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
      { id: 'plantar-fasciitis', label: '족저 근막염', code: 'M722' },
    ],
  },
  {
    id: 'spine',
    label: '척추부',
    items: [
      { id: 'cervical-myofascial-pain', label: '경추근막통증', code: 'M79180' },
      { id: 'lumbar-spine-myofascial-pain', label: '요추/척추부 근막통', code: 'M79180' },
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

export function findBodyPartPresetItem(presetId) {
  return BODY_PART_PRESET_ITEMS.find((item) => item.id === presetId) || null;
}

export function buildBodyPartPresetValue(item, directionId) {
  if (!item) return '';
  const bodyPart = `${item.label}(${String(item.code || '').toUpperCase()})`;
  const direction = BODY_PART_PRESET_DIRECTION_MAP[directionId];
  return direction ? `${direction} ${bodyPart}` : bodyPart;
}

export function getBodyPartPresetState(currentParts, item) {
  if (!item) return { isSelected: false, directions: [] };
  const selectedKeys = new Set(
    (currentParts || []).map((part) => normalizePresetValue(part))
  );
  const directions = BODY_PART_PRESET_DIRECTIONS
    .filter(({ id }) => selectedKeys.has(normalizePresetValue(buildBodyPartPresetValue(item, id))))
    .map(({ id }) => id);
  const isSelected = directions.length > 0
    || selectedKeys.has(normalizePresetValue(buildBodyPartPresetValue(item)));
  return { isSelected, directions };
}

export function isBodyPartPresetValue(value, item) {
  if (!item) return false;
  const normalizedValue = normalizePresetValue(value);
  return [undefined, ...BODY_PART_PRESET_DIRECTIONS.map(({ id }) => id)]
    .some((id) => normalizedValue === normalizePresetValue(buildBodyPartPresetValue(item, id)));
}

export function replaceBodyPartPreset(currentParts, item, isSelected, directionIds = []) {
  if (!item) return Array.isArray(currentParts) ? [...currentParts] : [];

  const presetValueKeys = new Set(
    [undefined, ...BODY_PART_PRESET_DIRECTIONS.map(({ id }) => id)]
      .map((id) => normalizePresetValue(buildBodyPartPresetValue(item, id)))
  );
  const preservedParts = (currentParts || []).filter((part) => (
    !presetValueKeys.has(normalizePresetValue(part))
  ));
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
    (nextParts || []).map((part) => normalizePresetValue(part))
  );
  const optionMap = new Map();
  [...(options || []), ...(nextParts || [])]
    .filter((part) => !isBodyPartPresetValue(part, item)
      || nextValueKeys.has(normalizePresetValue(part)))
    .forEach((part) => {
      const key = normalizePresetValue(part);
      if (key && !optionMap.has(key)) optionMap.set(key, part);
    });
  return Array.from(optionMap.values());
}
