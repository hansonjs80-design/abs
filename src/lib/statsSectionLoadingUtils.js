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

export async function loadStatsMonthsWithConcurrency(targets, loadMonth, concurrency = 2) {
  const safeTargets = Array.isArray(targets) ? targets : [];
  if (safeTargets.length === 0) return [];

  const workerCount = Math.min(
    safeTargets.length,
    Math.max(1, Number.parseInt(String(concurrency), 10) || 1)
  );
  const results = new Array(safeTargets.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < safeTargets.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await loadMonth(safeTargets[index], index);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}
