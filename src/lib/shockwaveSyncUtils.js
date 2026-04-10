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

  let name = "";
  let chart = "";
  let visit = "";
  let memo = "";
  
  // Format 1: 이름/차트번호/회차/메모
  if (s.includes('/')) {
    const parts = s.split('/');
    name = parts[0].trim();
    if (parts.length > 1) chart = parts[1].trim();
    if (parts.length > 2) visit = parts[2].trim();
    if (parts.length > 3) memo = parts.slice(3).join('/').trim();
  } else {
    // Format 2: 그냥 텍스트
    name = s;
  }

  // 꼬리 패턴 (e.g. 이름(40), (60)) 필터. 이거는 Shockwave Scheduler 자체 메모 파서(has4060Pattern)와 겹침
  name = name.replace(/\(\d+\)\s*$/, "").trim();
  name = name.replace(/\*+$/, "").trim(); // 별표 사전 제거

  if (!name || /^\d+$/.test(name)) return null; // 이름이 없거나 숫자뿐이면 스킵

  // 회차가 1이거나 빈칸일때 기본 1로 설정? (PWA 앱스 환경상 사용자가 방문횟수를 입력 안할수도 있음)
  const numericVisit = visit && !isNaN(Number(visit)) ? Number(visit) : 1;
  const isFirstVisit = numericVisit === 1;

  // 메모부위 영문 대문자/약어 보정 (ex: rt.sh -> Rt. Shoulder)
  const convertedMemo = memo ? toProperCase(memo) : "";

  return {
    patient_name: isFirstVisit ? `${name}*` : name,
    chart_number: chart,
    visit_count: visit || "-",
    body_part: convertedMemo,
    is_first_visit: isFirstVisit,
    original: s
  };
}
