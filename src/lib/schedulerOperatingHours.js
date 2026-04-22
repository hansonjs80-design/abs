export const MONTHLY_DAY_OVERRIDES_KEY = '__monthly';

export const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

export function getMonthKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function normalizeDayOverrides(dayOverrides) {
  return dayOverrides && typeof dayOverrides === 'object' ? dayOverrides : {};
}

export function getMonthlyDayOverrides(dayOverrides, year, month) {
  const source = normalizeDayOverrides(dayOverrides);
  const monthly = source[MONTHLY_DAY_OVERRIDES_KEY] || {};
  const currentKey = getMonthKey(year, month);

  if (monthly[currentKey]) return monthly[currentKey] || {};

  const currentValue = year * 12 + month;
  const inheritedKey = Object.keys(monthly)
    .filter((key) => /^\d{4}-\d{2}$/.test(key))
    .filter((key) => {
      const [keyYear, keyMonth] = key.split('-').map(Number);
      return keyYear * 12 + keyMonth < currentValue;
    })
    .sort()
    .pop();

  if (inheritedKey) return monthly[inheritedKey] || {};

  return Object.fromEntries(
    Object.entries(source).filter(([key]) => key !== MONTHLY_DAY_OVERRIDES_KEY)
  );
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
