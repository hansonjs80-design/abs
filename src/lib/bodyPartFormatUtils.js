import { convertKoreanQwertyMistypeToEnglish } from './keyboardLayoutUtils.js';

// --- Google Sheets _ABBREV_MAP ---
export const ABBREV_MAP = {
  'b.': 'Both',
  'lt.hip': 'Lt. Hip',
  'rt.hip': 'Rt. Hip',
  'b.sh': 'Both Shoulder',
  'bsh': 'Both Shoulder',
  'rtfoot': 'Rt. Foot',
  'rt.foot': 'Rt. Foot',
  'ltfoot': 'Lt. Foot',
  'lt.foot': 'Lt. Foot',
  'rt.sh': 'Rt. Shoulder',
  'lt.sh': 'Lt. Shoulder',
  'lx': 'Lumbar',
  'b': 'Both',
  'tx': 'Thoracic',
  'cx': 'Cervical',
  'sh': 'Shoulder',
  'pf': 'Plantar Fasciitis',
  'pv': 'Pelvis',
  'deq': 'Deqervain',
  'quad': 'Quadriceps',
  'ham': 'Hamstring',
  'ut': 'Upper Trap',
  'pt': 'Patellar Tendon',
  'te': 'Tennis elbow',
  'ge': 'Golfer Elbow',
  'ta': 'Tibialis Anterior',
  'tp': 'Tibialis Posterior',
  'es': 'Erector Spine',
  'pl': 'Peroneus Longus',
  'pb': 'Peroneus Brevis',
  'rc': 'Rotator Cuff',
  'rt': 'Rt.',
  'lt': 'Lt.',
  'w': 'Wrist',
  'wx': 'Wrist',
  'e': 'Elbow',
  'el': 'Elbow',
  'elb': 'Elbow',
  'f': 'Foot',
  'k': 'Knee',
  'ak': 'Ankle',
  'ank': 'Ankle',
  'rtak': 'Rt. Ankle',
  'rt.ak': 'Rt. Ankle',
  'ltak': 'Lt. Ankle',
  'lt.ak': 'Lt. Ankle',
  'rtsh': 'Rt. Shoulder',
  'ltsh': 'Lt. Shoulder',
  'rtk': 'Rt. Knee',
  'ltk': 'Lt. Knee',
  'rtpv': 'Rt. Pelvis',
  'ltpv': 'Lt. Pelvis',
  'rtpf': 'Rt. Plantar Fasciitis',
  'ltpf': 'Lt. Plantar Fasciitis',
  'lte': 'Lt. Elbow',
  'lt.e': 'Lt. Elbow',
  'rte': 'Rt. Elbow',
  'rt.e': 'Rt. Elbow',
  'rtw': 'Rt. Wrist',
  'rt.w': 'Rt. Wrist',
  'ltw': 'Lt. Wrist',
  'lt.w': 'Lt. Wrist'
};

export const ALWAYS_UPPER = [
  'TMJ', 'SIJ', 'SI', 'ACL', 'PCL', 'MCL', 'LCL', 'SLAP', 'TOS', 'CTS', 'SCM',
  'TFL', 'ITB', 'LBP', 'SC', 'SCJ', 'AC', 'ACJ', 'PFPS', 'GH', 'GHJ', 'MC',
  'MCJ', 'MT', 'MTJ', 'MCP', 'ATFL', 'QL', 'MTP', 'FHL', 'TFCC'
];

const KOREAN_BODY_PART_MAP = {
  '목': 'Cervical',
  '허리': 'Lumbar',
  '등': 'Thoracic',
  '발': 'Foot',
  '발바닥': 'Plantar Foot',
  '발목': 'Ankle',
  '손': 'Hand',
  '손목': 'Wrist',
  '무릎': 'Knee',
  '무': 'Knee',
  '무릎안쪽': 'Medial Knee',
  '안쪽무릎': 'Medial Knee',
  '내측무릎': 'Medial Knee',
  '무릎내측': 'Medial Knee',
  '무릎바깥쪽': 'Lateral Knee',
  '바깥쪽무릎': 'Lateral Knee',
  '외측무릎': 'Lateral Knee',
  '무릎외측': 'Lateral Knee',
  '전완': 'Fore Arm',
  '상완': 'Upper Arm',
  '위팔': 'Upper Arm',
  '윗팔': 'Upper Arm',
  '하완': 'Lower Arm',
  '아래팔': 'Lower Arm',
  '아랫팔': 'Lower Arm',
  '허벅지': 'Thigh',
  '삼두': 'Triceps',
  '삼두근': 'Triceps',
  '햄스트링': 'Hamstring',
  '햄스': 'Hamstring',
  '팔꿈치': 'Elbow',
  '엘보': 'Elbow',
  '손가락': 'Finger',
  '엄지손가락': 'Thumb',
  '엄지': 'Thumb',
  '어깨': 'Shoulder',
  '어': 'Shoulder',
  'ㅣㅅ노': 'Lt. Shoulder',
  'ㄱㅅ노': 'Rt. Shoulder',
  'ㅠㅐ소노': 'Both Shoulder',
  'ㅣㅅㅊㅌ': 'Lt. Cervical',
  'ㄱㅅㅊㅌ': 'Rt. Cervical',
  '골반': 'Pelvis',
  '고관절': 'Hip',
  '엉': 'Hip',
  '엉덩이': 'Hip',
  '테니스엘보': 'Tennis Elbow',
  '골퍼엘보': 'Golfer\'s Elbow',
  '골프엘보': 'Golfer\'s Elbow',
  '종아리': 'Calf',
  '뒤꿈치': 'Heel',
};

const KOREAN_BODY_DIRECTION_PREFIXES = [
  { prefixes: ['왼쪽', '좌측', '왼'], value: 'Lt.' },
  { prefixes: ['오른쪽', '오른', '우측', '오', '우'], value: 'Rt.' },
  { prefixes: ['양쪽', '양'], value: 'Both' },
];

function normalizeKoreanBodyPartAlias(value) {
  const original = String(value || '').trim();
  if (!original) return '';
  const compact = original.replace(/\s+/g, '');
  if (Object.prototype.hasOwnProperty.call(KOREAN_BODY_PART_MAP, compact)) {
    return KOREAN_BODY_PART_MAP[compact];
  }

  for (const { prefixes, value: direction } of KOREAN_BODY_DIRECTION_PREFIXES) {
    for (const prefix of prefixes) {
      if (!compact.startsWith(prefix)) continue;
      const bodyKey = compact.slice(prefix.length);
      const bodyPart = KOREAN_BODY_PART_MAP[bodyKey];
      if (bodyPart) return `${direction} ${bodyPart}`;
    }
  }

  return '';
}

export function normalizeBodyShortcutKey(value) {
  const lower = String(value || '').toLowerCase();
  if (Object.prototype.hasOwnProperty.call(ABBREV_MAP, lower)) return lower;
  const qwertyKey = convertKoreanQwertyMistypeToEnglish(lower);
  return Object.prototype.hasOwnProperty.call(ABBREV_MAP, qwertyKey) ? qwertyKey : lower;
}

export function toProperCase(str) {
  if (!str) return str;
  const koreanAlias = normalizeKoreanBodyPartAlias(str);
  if (koreanAlias) return koreanAlias;
  return str.split(/([,/\- ]+)/).map(tok => {
    if (/^[,/\- ]+$/.test(tok)) return tok;
    const lower = normalizeBodyShortcutKey(tok);
    if (Object.prototype.hasOwnProperty.call(ABBREV_MAP, lower)) return ABBREV_MAP[lower];
    const upper = tok.toUpperCase();
    if (ALWAYS_UPPER.includes(upper)) return upper;
    return tok.charAt(0).toUpperCase() + tok.slice(1).toLowerCase();
  }).join('');
}
