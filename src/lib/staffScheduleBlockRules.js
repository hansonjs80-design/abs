import { getMonthKey } from './schedulerOperatingHours';

export const DEFAULT_STAFF_SCHEDULE_BLOCK_RULES = [
  {
    id: 'afternoon-half-day',
    keyword: '오후 반차',
    start_time: '13:00',
    end_time: '18:00',
    bg_color: '#d9ead3',
    font_color: '#0f172a',
    enabled: true,
    invert_match: false,
  },
];

function compareMonthKeys(a, b) {
  return String(a || '').localeCompare(String(b || ''));
}

function normalizeRule(rule, index = 0) {
  return {
    id: rule?.id || `staff-block-${Date.now()}-${index}`,
    keyword: String(rule?.keyword || '').trim(),
    start_time: String(rule?.start_time || '').slice(0, 5),
    end_time: String(rule?.end_time || '').slice(0, 5),
    bg_color: rule?.bg_color || '#d9ead3',
    font_color: rule?.font_color || '#0f172a',
    enabled: rule?.enabled !== false,
    invert_match: rule?.invert_match === true,
  };
}

function normalizeRuleList(rules) {
  return (Array.isArray(rules) ? rules : [])
    .map(normalizeRule)
    .filter((rule) => rule.keyword && rule.start_time && rule.end_time);
}

export function getEffectiveStaffScheduleBlockRules(settings, year, month) {
  const source = settings?.staff_schedule_block_rules;
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
    rules: inheritedMonthKey ? normalizeRuleList(monthly[inheritedMonthKey]) : DEFAULT_STAFF_SCHEDULE_BLOCK_RULES,
    source_month_key: inheritedMonthKey || null,
    target_month_key: monthKey,
  };
}

export function setMonthlyStaffScheduleBlockRules(settings, year, month, rules) {
  const source = settings?.staff_schedule_block_rules;
  const existing = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
  return {
    ...existing,
    [getMonthKey(year, month)]: normalizeRuleList(rules),
  };
}
