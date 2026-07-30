export function shouldPrepareStatsSecondarySections({ dataReady, isPrimaryLoading }) {
  return Boolean(dataReady) && !isPrimaryLoading;
}

export function shouldKeepStatsSectionMounted({
  activeSection,
  targetSection,
  secondarySectionsReady,
}) {
  return activeSection === targetSection || Boolean(secondarySectionsReady);
}

export function isDisplayedStatsMonth(target, currentYear, currentMonth) {
  return Number(target?.year) === Number(currentYear) &&
    Number(target?.month) === Number(currentMonth);
}

export function loadStatsMonthsTogether(targets, loadMonth) {
  return Promise.all((Array.isArray(targets) ? targets : []).map((target) => loadMonth(target)));
}
