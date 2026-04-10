/* =============================================
 * 메모 파싱 유틸리티 (기존 섹션5-1 로직 변환)
 * ============================================*/

import { FONT_COLORS, CLINIC_DEPT_MAP } from './constants';

/**
 * 이름 정규화 (매칭용)
 * 원본: normalizeNameForMatch_
 */
export function normalizeNameForMatch(s) {
  return String(s || '')
    .trim()
    .replace(/[*\d\s().]/g, '')
    .toLowerCase();
}

/**
 * 부서/이름 전용 표기 판별
 * 원본: isDeptNameOnly
 */
export function isDeptNameOnly(text) {
  if (!text) return false;
  const t = String(text).trim();
  const purePair = /^\s*[^/\s]+?\s*\/\s*[^/\s]+?\s*$/.test(t);
  if (!purePair) return false;
  const hasKeywords = /(휴무|연차|반차|야간|야\b|출근|퇴근|근무|오전|오후|휴가|PT출근|\d|:)/.test(t);
  return !hasKeywords;
}

/**
 * 특수 근무시간 메모 판별
 * 원본: isSpecialWorkTimeMemo
 */
export function isSpecialWorkTimeMemo(text) {
  if (!text) return false;
  const s = String(text);
  if (!/근무/.test(s)) return false;
  return /\b\d{1,2}\s*[-~]\s*\d{1,2}\s*시/.test(s);
}

/**
 * 메모별 글자색 결정
 * 원본: computeStaffMemoFontColor_
 */
export function computeMemoFontColor(txt) {
  const t = String(txt || '').trim();
  if (!t) return null;

  if (/^(?:\d+\s*)?명$/.test(t)) return FONT_COLORS.normal;
  if (/^간호\s*(?:오전|오후)\s*\/\s*\S+/.test(t)) return FONT_COLORS.normal;
  if (isSpecialWorkTimeMemo(t)) return FONT_COLORS.red;
  if (t.indexOf('야') !== -1) return FONT_COLORS.nightBlue;
  if (t.indexOf('휴무') !== -1) return FONT_COLORS.purple;
  if (t.indexOf('연차') !== -1 || t.indexOf('반차') !== -1) return FONT_COLORS.green;
  if (t.indexOf('출근') !== -1) return FONT_COLORS.orange;
  if (isDeptNameOnly(t)) return FONT_COLORS.normal;
  return null;
}

/**
 * 메모 파싱 (충격파 반영용)
 * 원본: parseMemoLineFast_
 */
export function parseMemoLine(raw, nameList = []) {
  const text = String(raw || '').trim();
  if (!text) return null;

  const rawLower = text.toLowerCase();
  const noSpaceLower = rawLower.replace(/\s/g, '');
  const hasNight = /야/.test(text);
  const isOff = /휴무|월차|연차|휴가/i.test(text);
  const isMorning = /오전|오전반차|오전휴무|오전대체휴무/i.test(text);
  const isAfternoon = /오후|오후반차|오후휴무|오후대체휴무/i.test(text);
  const ptStandalone = /(^|[,\s])pt([,\s]|$)/i.test(text);
  const hasForbidden = /야|오전|오후|휴무|월차|연차|휴가|출근/i.test(text);

  // 부서/이름 쌍 파싱
  const pairs = [];
  const ONLY_DEPT_NAME_RE = /(?:^|[,\s])(?:(pt|충격파|shock|sw))\s*\/\s*([^\s,/]+)(?=$|[,\s])/gi;
  let mm;
  while ((mm = ONLY_DEPT_NAME_RE.exec(text)) !== null) {
    const dept = String(mm[1] || '').toLowerCase();
    const rawName = String(mm[2] || '');
    const normName = normalizeNameForMatch(rawName);
    pairs.push({ dept, name: normName, rawName });
  }

  // 언급된 이름들 수집
  const mentioned = new Set();
  const normalizedNames = nameList.map(n => normalizeNameForMatch(n));

  normalizedNames.forEach(norm => {
    if (norm && noSpaceLower.includes(norm)) {
      mentioned.add(norm);
    }
  });

  pairs.forEach(p => mentioned.add(p.name));

  return {
    text,
    rawLower,
    noSpaceLower,
    mentioned,
    pairs,
    onlyDeptNameList: pairs.length > 0 && !hasForbidden,
    isOff,
    isMorning,
    isAfternoon,
    ptStandalone,
    hasNight,
    isPtAttend: /pt/i.test(rawLower) && /출근/i.test(text),
  };
}

/**
 * 오늘 일정 포맷팅
 * 원본: fillTodayScheduleToJ
 */
export function formatTodayScheduleItem(txt, dow) {
  let text = String(txt || '').trim();
  if (!text) return null;

  // 숫자만 있거나 "N명" 형태면 스킵
  if (/^\d*명$/.test(text)) return null;
  if (!isNaN(Number(text))) return null;

  // 연차 패턴
  if (/^(PT|간호)\/.+\s*연차$/.test(text)) return text;

  // 간호 패턴
  const mNurse = text.match(/^간호\s+([^\s/]+)\/([^\s/]+)$/);
  if (mNurse) {
    return `간호/${mNurse[2]} ${mNurse[1]}휴무`;
  }

  // 반차 패턴
  const mHalf = text.match(/^(PT|간호)\/(.+?)\s*(오전반차|오후반차)$/);
  if (mHalf) return text;

  // 일반 패턴
  const mSimple = text.match(/^(PT|간호)\/(.+)$/);
  if (mSimple) text = `${mSimple[1]}/${mSimple[2].trim()} 휴무`;

  if (text.startsWith('야 ') && text.includes('간호/')) {
    text = text.replace(/^야\s*/, '') + ' 야간 근무';
  } else if (text.startsWith('간호/') && !/(야간 근무|휴무|퇴근|반차|연차|출근)/.test(text)) {
    text += dow === 6 ? ' 휴무' : ' 5시 퇴근';
  } else if (!text.includes('휴무') && !text.includes('휴가') && !/반차|연차/.test(text)) {
    if (text.startsWith('야') && !text.includes('야간 근무')) {
      text = text.replace(/^야(간)?\s*/, '').trim() + ' 야간 근무';
    } else {
      const parts = text.split('/');
      const dept = parts[0]?.trim();
      const hasTime = /\d|퇴근|출근|근무/.test(text);

      if (parts.length === 2 && !hasTime && dept === '간호') text += ' 5시 퇴근';
      else if (parts.length === 2 && !hasTime && dept === 'PT') text += ' 휴무';
      else if (!hasTime) text += ' 휴무';
    }
  }

  return text;
}

/**
 * 메모 → 충격파 색칠 타입 결정
 */
export function getMemoShockwaveType(parsed) {
  if (!parsed) return null;

  if (parsed.isOff || parsed.ptStandalone) return 'all';
  if (parsed.hasNight) return 'night';
  if (parsed.isMorning) return 'morning';
  if (parsed.isAfternoon) return 'afternoon';
  return null;
}

/**
 * 40/60 패턴 체크 (충격파 3인)
 */
export function has4060Pattern(text) {
  return /[가-힣a-zA-Z]\s*(40|60)\**($|[(\s])/.test(String(text || ''));
}

/**
 * 충격파 셀 내용의 회수(세션 횟수) 증가
 * 
 * 지원 패턴:
 *   - 1234/이름(3)       → 1234/이름(4)
 *   - 1234/이름*         → 1234/이름(2)   (* = 1회)
 *   - 1234/이름40(3)     → 1234/이름40(4)
 *   - 1234/이름60*       → 1234/이름60(2) (* = 1회)
 *   - 1234/이름(회수없음) → 그대로 반환
 * 
 * @param {string} text - 셀 내용
 * @returns {string} 회수가 1 증가된 셀 내용
 */
export function incrementSessionCount(text) {
  const s = String(text || '').trim();
  if (!s) return s;

  // 패턴: chartNo/name[40|60]*(count) 또는 chartNo/name[40|60]*
  // 1) 괄호 안에 숫자가 있는 경우: 1234/이름(3) 또는 1234/이름40(3)
  const parenMatch = s.match(/^(.+?\/[^(]+?)(40|60)?(\((\d+)\))$/);
  if (parenMatch) {
    const prefix = parenMatch[1];
    const suffix4060 = parenMatch[2] || '';
    const count = parseInt(parenMatch[4], 10);
    return `${prefix}${suffix4060}(${count + 1})`;
  }

  // 2) *로 끝나는 경우: 1234/이름* 또는 1234/이름40*  → 1회로 간주 → (2)
  const starMatch = s.match(/^(.+?\/[^*]+?)(40|60)?(\*+)$/);
  if (starMatch) {
    const prefix = starMatch[1];
    const suffix4060 = starMatch[2] || '';
    return `${prefix}${suffix4060}(2)`;
  }

  // 매칭 안 되면 그대로 반환
  return s;
}
