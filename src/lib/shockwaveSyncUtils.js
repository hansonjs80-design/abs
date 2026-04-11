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
  'f': 'Foot',
  'k': 'Knee',
  'ak': 'Ankle',
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

export function toProperCase(str) {
  if (!str) return str;
  return str.split(/([,\/\- ]+)/).map(tok => {
    if (/^[,\/\- ]+$/.test(tok)) return tok;
    const lower = tok.toLowerCase();
    if (ABBREV_MAP.hasOwnProperty(lower)) return ABBREV_MAP[lower];
    const upper = tok.toUpperCase();
    if (ALWAYS_UPPER.includes(upper)) return upper;
    return tok.charAt(0).toUpperCase() + tok.slice(1).toLowerCase();
  }).join('');
}

// 추출 로직 (기존 앱스스크립트 parseNameChart_ 및 관련 정규표현식 이식)
export function parseTherapyInfo(rawContent) {
  if (!rawContent || typeof rawContent !== 'string') return null;
  const s = rawContent.trim();
  if (!s) return null;

  // 특수문구 거름망
  if (/^(휴무|연차|반차|출근|퇴근|근무|야간|오전|오후|처방|건수|총건수|합계|결산|주차)$/.test(s)) return null;
  // 시간포맷 필터 (예: 12:30)
  if (/^\d{1,2}:\d{2}$/.test(s)) return null;

  let chart = "";
  let name = s;
  let visit = "";

  if (s.includes('/')) {
    const parts = s.split('/');
    const p0 = parts[0].trim();
    const p1 = parts[1]?.trim() || '';

    // If p0 has numbers and p1 has letters, it's Chart/Name (User described: 챠트번호/이름)
    if (/\d/.test(p0) && /[^\d*()]/.test(p1)) {
       chart = p0;
       name = p1;
    } 
    // If p0 has letters and p1 has numbers, it's Name/Chart
    else if (/[^\d*()]/.test(p0) && /\d/.test(p1)) {
       name = p0;
       chart = p1;
    } else {
       chart = p0;
       name = p1;
    }
  }

  // 도수치료 (40, 60) 필터 (이름에 포함된 경우)
  if (/40|60/.test(name)) return null;

  // Extract visit count: name(visit) or name*
  const visitMatch = name.match(/\((\d+)\)$/);
  if (visitMatch) {
    visit = visitMatch[1];
    name = name.replace(/\(\d+\)$/, '').trim();
  } else if (name.endsWith('*')) {
    visit = "1";
    // 별표는 1회차 시각적 표시이므로 이름에 남겨둠
  }

  name = name.trim();
  if (!name || /^\d+$/.test(name.replace(/\*/g, ''))) return null;

  return {
    patient_name: name,
    chart_number: chart,
    visit_count: visit, 
    body_part: "", // To be auto-filled by sync logic
    original: s
  };
}
