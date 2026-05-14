export const MONTHLY_DAY_OVERRIDES_KEY = '__monthly';

export const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

export function getMonthKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function normalizeDayOverrides(dayOverrides) {
  return dayOverrides && typeof dayOverrides === 'object' ? dayOverrides : {};
}

function getGlobalDayOverrides(source) {
  return Object.fromEntries(
    Object.entries(source).filter(([key]) => key !== MONTHLY_DAY_OVERRIDES_KEY)
  );
}

function mergeDayOverrides(baseOverrides, monthOverrides) {
  const merged = { ...(baseOverrides || {}) };
  Object.entries(monthOverrides || {}).forEach(([key, override]) => {
    merged[key] = {
      ...(merged[key] || {}),
      ...(override || {}),
    };
  });
  return merged;
}

export function getMonthlyDayOverrides(dayOverrides, year, month) {
  const source = normalizeDayOverrides(dayOverrides);
  const monthly = source[MONTHLY_DAY_OVERRIDES_KEY] || {};
  const globalOverrides = getGlobalDayOverrides(source);
  const currentKey = getMonthKey(year, month);

  if (monthly[currentKey]) return mergeDayOverrides(globalOverrides, monthly[currentKey]);

  const currentValue = year * 12 + month;
  const inheritedKey = Object.keys(monthly)
    .filter((key) => /^\d{4}-\d{2}$/.test(key))
    .filter((key) => {
      const [keyYear, keyMonth] = key.split('-').map(Number);
      return keyYear * 12 + keyMonth < currentValue;
    })
    .sort()
    .pop();

  if (inheritedKey) return mergeDayOverrides(globalOverrides, monthly[inheritedKey]);

  return globalOverrides;
}

export function setMonthlyDayOverrides(dayOverrides, year, month, overrides) {
  const source = normalizeDayOverrides(dayOverrides);
  return {
    ...source,
    [MONTHLY_DAY_OVERRIDES_KEY]: {
      ...(source[MONTHLY_DAY_OVERRIDES_KEY] || {}),
      [getMonthKey(year, month)]: overrides || {},
    },
  };
}

export function getDateOverridesForMonth(dateOverrides, year, month) {
  const source = dateOverrides && typeof dateOverrides === 'object' ? dateOverrides : {};
  const prefix = getMonthKey(year, month);
  return Object.fromEntries(
    Object.entries(source).filter(([dateKey]) => String(dateKey).startsWith(prefix))
  );
}
