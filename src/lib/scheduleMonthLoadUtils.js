export function partitionVisibleScheduleMonthTargets(targets, currentYear, currentMonth) {
  const safeTargets = Array.isArray(targets) ? targets.filter(Boolean) : [];
  const currentTarget = safeTargets.find((target) => (
    Number(target?.year) === Number(currentYear) &&
    Number(target?.month) === Number(currentMonth)
  )) || { year: Number(currentYear), month: Number(currentMonth) };

  return {
    currentTarget,
    adjacentTargets: safeTargets.filter((target) => target !== currentTarget),
  };
}

export function shiftScheduleMonth(year, month, delta) {
  const absoluteMonth = Number(year) * 12 + (Number(month) - 1) + Number(delta);
  return {
    year: Math.floor(absoluteMonth / 12),
    month: ((absoluteMonth % 12) + 12) % 12 + 1,
  };
}
