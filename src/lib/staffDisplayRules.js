/**
 * 부서/이름 표시 규칙 유틸리티
 * 근무표 메모의 "부서/이름" 패턴에 대한 표시 방식을 설정·관리합니다.
 *
 * - 달력 셀의 글자색/배경색
 * - 오늘 일정 패널(TodayPanel)의 표시 텍스트
 * - 월별 상속 로직
 */

function getMonthKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

/* ── 기본 규칙 ── */
export const DEFAULT_STAFF_DISPLAY_RULES = [
  {
    id: 'display-night',
    keyword: '야간',
    position: 'prefix',       // "야간 부서/이름"
    today_suffix: '야간 근무',
    calendar_font_color: '#3c78d8',
    calendar_bg_color: '',
    enabled: true,
    priority: 100,
  },
  {
    id: 'display-night-short',
    keyword: '야',
    position: 'prefix',       // "야 부서/이름"
    today_suffix: '야간 근무',
    calendar_font_color: '#3c78d8',
    calendar_bg_color: '',
    enabled: true,
    priority: 90,
  },
  {
    id: 'display-morning-half',
    keyword: '오전반차',
    position: 'suffix',       // "부서/이름 오전반차"
    today_suffix: '오전반차',
    calendar_font_color: '#40a417',
    calendar_bg_color: '',
    enabled: true,
    priority: 80,
  },
  {
    id: 'display-afternoon-half',
    keyword: '오후반차',
    position: 'suffix',       // "부서/이름 오후반차"
    today_suffix: '오후반차',
    calendar_font_color: '#40a417',
    calendar_bg_color: '',
    enabled: true,
    priority: 80,
  },
  {
    id: 'display-half-day',
    keyword: '반차',
    position: 'suffix',       // "부서/이름 반차"
    today_suffix: '반차',
    calendar_font_color: '#40a417',
    calendar_bg_color: '',
    enabled: true,
    priority: 70,
  },
  {
    id: 'display-annual-leave',
    keyword: '연차',
    position: 'suffix',       // "부서/이름 연차"
    today_suffix: '연차',
    calendar_font_color: '#40a417',
    calendar_bg_color: '',
    enabled: true,
    priority: 70,
  },
  {
    id: 'display-vacation',
    keyword: '휴가',
    position: 'suffix',       // "부서/이름 휴가"
    today_suffix: '휴가',
    calendar_font_color: '#40a417',
    calendar_bg_color: '',
    enabled: true,
    priority: 70,
  },
  {
    id: 'display-off-duty',
    keyword: '휴무',
    position: 'suffix',       // "부서/이름 휴무"
    today_suffix: '휴무',
    calendar_font_color: '#000000',
    calendar_bg_color: '',
    enabled: true,
    priority: 60,
  },
  {
    id: 'display-attend',
    keyword: '출근',
    position: 'suffix',       // "부서/이름 출근"
    today_suffix: '출근',
    calendar_font_color: '#ff6d01',
    calendar_bg_color: '',
    enabled: true,
    priority: 60,
  },
  {
    id: 'display-standalone',
    keyword: '',
    position: 'standalone',   // 순수 "부서/이름"만
    today_suffix: '휴무',
    calendar_font_color: '#000000',
    calendar_bg_color: '',
    enabled: true,
    priority: 0,              // 가장 낮은 우선순위 (폴백)
  },
];

/* ── 정규화 ── */
function normalizeRule(rule, index = 0) {
  return {
    id: rule?.id || `display-rule-${Date.now()}-${index}`,
    keyword: String(rule?.keyword ?? '').trim(),
    position: rule?.position || 'suffix',
    today_suffix: String(rule?.today_suffix ?? '').trim(),
    calendar_font_color: rule?.calendar_font_color || '',
    calendar_bg_color: rule?.calendar_bg_color || '',
    enabled: rule?.enabled !== false,
    priority: Number(rule?.priority) || 0,
  };
}

function normalizeRuleList(rules) {
  return (Array.isArray(rules) ? rules : []).map(normalizeRule);
}

/* ── 월별 상속 ── */
function compareMonthKeys(a, b) {
  return String(a || '').localeCompare(String(b || ''));
}

export function getEffectiveStaffDisplayRules(settings, year, month) {
  const source = settings?.staff_display_rules;
  const monthKey = getMonthKey(year, month);

  if (Array.isArray(source)) {
    return {
      rules: normalizeRuleList(source),
      source_month_key: null,
      target_month_key: monthKey,
    };
  }

  const monthly = source && typeof source === 'object' ? source : {};
  const inheritedMonthKey = Object.keys(monthly)
    .filter((key) => /^\d{4}-\d{2}$/.test(key))
    .filter((key) => compareMonthKeys(key, monthKey) <= 0)
    .filter((key) => Array.isArray(monthly[key]))
    .sort(compareMonthKeys)
    .pop();

  return {
    rules: inheritedMonthKey ? normalizeRuleList(monthly[inheritedMonthKey]) : normalizeRuleList(DEFAULT_STAFF_DISPLAY_RULES),
    source_month_key: inheritedMonthKey || null,
    target_month_key: monthKey,
  };
}

export function setMonthlyStaffDisplayRules(settings, year, month, rules) {
  const source = settings?.staff_display_rules;
  const existing = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
  return {
    ...existing,
    [getMonthKey(year, month)]: normalizeRuleList(rules),
  };
}

/* ── 매칭 ── */

/**
 * "부서/이름" 패턴인지 판별하고 분해합니다.
 * 반환: { dept, name, prefix, suffix } 또는 null
 *
 * 예시:
 *   "간호/강수아"         → { dept: '간호', name: '강수아', prefix: '', suffix: '' }
 *   "야간 간호/강수아"    → { dept: '간호', name: '강수아', prefix: '야간', suffix: '' }
 *   "간호/강수아 연차"    → { dept: '간호', name: '강수아', prefix: '', suffix: '연차' }
 *   "야 PT/주한솔 출근"   → { dept: 'PT', name: '주한솔', prefix: '야', suffix: '출근' }
 */
export function parseDeptNameMemo(text) {
  const t = String(text || '').trim();
  if (!t) return null;

  // "부서/이름"이 포함되어야 함
  const slashIdx = t.indexOf('/');
  if (slashIdx < 0) return null;

  // 슬래시 주변 파싱
  // 슬래시 앞: 공백으로 구분된 마지막 토큰이 부서
  const beforeSlash = t.slice(0, slashIdx).trim();
  const beforeTokens = beforeSlash.split(/\s+/);
  const dept = beforeTokens.pop() || '';
  const prefix = beforeTokens.join(' ').trim();

  // 부서가 비어있으면 유효하지 않음
  if (!dept) return null;

  // 슬래시 뒤: 첫 번째 토큰이 이름, 나머지는 suffix
  const afterSlash = t.slice(slashIdx + 1).trim();
  if (!afterSlash) return null;

  const afterTokens = afterSlash.split(/\s+/);
  const name = afterTokens.shift() || '';
  const suffix = afterTokens.join(' ').trim();

  // 이름에 숫자나 특수문자만 있으면 부서/이름 패턴이 아님 (차트번호/이름 패턴 제외)
  if (!name || /^\d+$/.test(name)) return null;
  // 차트번호가 부서에 해당하는 경우 제외 (예: 14314/정경훈40(2))
  if (/^\d+$/.test(dept)) return null;

  return { dept, name, prefix, suffix };
}

/**
 * 메모 텍스트에 가장 적합한 표시 규칙을 찾습니다.
 */
export function matchDisplayRule(memoText, rules) {
  const parsed = parseDeptNameMemo(memoText);
  if (!parsed) return null;

  const enabledRules = (rules || DEFAULT_STAFF_DISPLAY_RULES)
    .filter((r) => r.enabled !== false);

  // 우선순위 높은 순으로 정렬
  const sorted = [...enabledRules].sort((a, b) => (b.priority || 0) - (a.priority || 0));

  const normalizedPrefix = parsed.prefix.replace(/\s+/g, '').toLowerCase();
  const normalizedSuffix = parsed.suffix.replace(/\s+/g, '').toLowerCase();

  for (const rule of sorted) {
    const normalizedKeyword = (rule.keyword || '').replace(/\s+/g, '').toLowerCase();

    if (rule.position === 'prefix' && normalizedKeyword) {
      if (normalizedPrefix === normalizedKeyword || normalizedPrefix.includes(normalizedKeyword)) {
        return { rule, parsed };
      }
    } else if (rule.position === 'suffix' && normalizedKeyword) {
      if (normalizedSuffix === normalizedKeyword || normalizedSuffix.includes(normalizedKeyword)) {
        return { rule, parsed };
      }
    } else if (rule.position === 'standalone' && !normalizedKeyword) {
      // standalone은 prefix와 suffix가 모두 비어있을 때만 매칭
      if (!parsed.prefix && !parsed.suffix) {
        return { rule, parsed };
      }
    }
  }

  return null;
}

/**
 * 규칙에 따라 TodayPanel에 표시할 텍스트를 생성합니다.
 */
export function formatMemoWithRule(memoText, rules) {
  const match = matchDisplayRule(memoText, rules);
  if (!match) return null;

  const { rule, parsed } = match;
  const base = `${parsed.dept}/${parsed.name}`;
  const suffix = rule.today_suffix || '';

  if (suffix) {
    return `${base} ${suffix}`;
  }
  return base;
}

/**
 * 규칙에 따라 달력 셀 글자색을 결정합니다.
 */
export function getMemoFontColorByRule(memoText, rules) {
  const match = matchDisplayRule(memoText, rules);
  if (!match) return null;
  return match.rule.calendar_font_color || null;
}

/**
 * 규칙에 따라 달력 셀 배경색을 결정합니다.
 */
export function getMemoBgColorByRule(memoText, rules) {
  const match = matchDisplayRule(memoText, rules);
  if (!match) return null;
  return match.rule.calendar_bg_color || null;
}
