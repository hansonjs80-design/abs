const DEFAULT_PAGE_SIZE = 1000;
const DEFAULT_UPDATE_CHUNK_SIZE = 200;

function chunkItems(items, size) {
  const safeSize = Math.max(1, Number(size) || DEFAULT_UPDATE_CHUNK_SIZE);
  const chunks = [];
  for (let index = 0; index < items.length; index += safeSize) {
    chunks.push(items.slice(index, index + safeSize));
  }
  return chunks;
}

export function normalizeSchedulePrescriptionRenames(renames = []) {
  const normalized = [];
  const seenSources = new Set();
  (Array.isArray(renames) ? renames : []).forEach((rename) => {
    const from = String(rename?.from || '').trim();
    const to = String(rename?.to || '').trim();
    if (!from || !to || from === to || seenSources.has(from)) return;
    seenSources.add(from);
    normalized.push({ from, to });
  });
  return normalized;
}

export function buildSchedulePrescriptionRenamePlan(rows = [], renames = []) {
  const renameMap = new Map(
    normalizeSchedulePrescriptionRenames(renames).map(({ from, to }) => [from, to])
  );
  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const id = String(row?.id || '').trim();
      const from = String(row?.prescription || '').trim();
      const to = renameMap.get(from);
      return id && to ? { id, from, to } : null;
    })
    .filter(Boolean);
}

async function updatePrescriptionGroups({
  supabaseClient,
  changes,
  targetField,
  updateChunkSize,
}) {
  const groupedChanges = new Map();
  changes.forEach((change) => {
    const target = change[targetField];
    if (!groupedChanges.has(target)) groupedChanges.set(target, []);
    groupedChanges.get(target).push(change);
  });

  for (const [prescription, targetChanges] of groupedChanges) {
    for (const chunk of chunkItems(targetChanges, updateChunkSize)) {
      const { error } = await supabaseClient
        .from('shockwave_schedules')
        .update({
          prescription,
          updated_at: new Date().toISOString(),
        })
        .in('id', chunk.map((change) => change.id));
      if (error) throw error;
    }
  }
}

export async function restoreSchedulePrescriptionRenames({
  supabaseClient,
  changes = [],
  updateChunkSize = DEFAULT_UPDATE_CHUNK_SIZE,
}) {
  if (!supabaseClient || !Array.isArray(changes) || changes.length === 0) return;
  await updatePrescriptionGroups({
    supabaseClient,
    changes,
    targetField: 'from',
    updateChunkSize,
  });
}

export async function renameSchedulePrescriptionsForMonth({
  supabaseClient,
  year,
  month,
  renames = [],
  pageSize = DEFAULT_PAGE_SIZE,
  updateChunkSize = DEFAULT_UPDATE_CHUNK_SIZE,
}) {
  const normalizedRenames = normalizeSchedulePrescriptionRenames(renames);
  if (!supabaseClient || normalizedRenames.length === 0) {
    return { updatedCount: 0, changes: [] };
  }

  const sourcePrescriptions = normalizedRenames.map(({ from }) => from);
  const rows = [];
  const safePageSize = Math.max(1, Number(pageSize) || DEFAULT_PAGE_SIZE);
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabaseClient
      .from('shockwave_schedules')
      .select('id,prescription')
      .eq('year', year)
      .eq('month', month)
      .in('prescription', sourcePrescriptions)
      .range(page * safePageSize, (page + 1) * safePageSize - 1);
    if (error) throw error;
    const pageRows = Array.isArray(data) ? data : [];
    rows.push(...pageRows);
    hasMore = pageRows.length === safePageSize;
    page += 1;
  }

  const changes = buildSchedulePrescriptionRenamePlan(rows, normalizedRenames);
  if (changes.length === 0) return { updatedCount: 0, changes: [] };

  try {
    await updatePrescriptionGroups({
      supabaseClient,
      changes,
      targetField: 'to',
      updateChunkSize,
    });
  } catch (error) {
    try {
      await restoreSchedulePrescriptionRenames({
        supabaseClient,
        changes,
        updateChunkSize,
      });
    } catch (rollbackError) {
      const combinedError = new Error('Schedule prescription rename and rollback both failed.');
      combinedError.cause = error;
      combinedError.rollbackError = rollbackError;
      throw combinedError;
    }
    throw error;
  }

  return { updatedCount: changes.length, changes };
}
