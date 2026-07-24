const DEFAULT_DEACTIVATE_CHUNK_SIZE = 100;

export function normalizeTherapistRoster(roster) {
  if (!Array.isArray(roster)) {
    throw new Error('치료사 목록이 올바르지 않습니다.');
  }

  const names = roster
    .map((item) => String(item?.name ?? item ?? '').trim())
    .filter(Boolean);
  if (new Set(names).size !== names.length) {
    throw new Error('치료사 이름이 중복되었습니다.');
  }

  return names.map((name, slotIndex) => ({
    name,
    slot_index: slotIndex,
    is_active: true,
  }));
}

export function isSameTherapistRoster(existingRows = [], nextRows = []) {
  const activeRows = (Array.isArray(existingRows) ? existingRows : [])
    .filter((item) => item?.is_active !== false)
    .sort((left, right) => Number(left?.slot_index) - Number(right?.slot_index));
  if (activeRows.length !== nextRows.length) return false;
  return activeRows.every((item, index) => (
    String(item?.name || '').trim() === nextRows[index].name &&
    Number(item?.slot_index) === nextRows[index].slot_index
  ));
}

export async function saveTherapistRosterSafely({
  supabaseClient,
  tableName,
  roster,
  deactivateChunkSize = DEFAULT_DEACTIVATE_CHUNK_SIZE,
} = {}) {
  if (!supabaseClient) throw new Error('치료사 목록 저장소가 연결되지 않았습니다.');
  if (!tableName) throw new Error('치료사 목록 테이블이 지정되지 않았습니다.');

  const rows = normalizeTherapistRoster(roster);
  const { data: existingRows, error: selectError } = await supabaseClient
    .from(tableName)
    .select('id, name, slot_index, is_active')
    .eq('is_active', true)
    .order('slot_index');
  if (selectError) throw selectError;

  const activeRows = Array.isArray(existingRows) ? existingRows : [];
  if (isSameTherapistRoster(activeRows, rows)) {
    return activeRows;
  }

  let savedRows = [];
  if (rows.length > 0) {
    const { data, error: insertError } = await supabaseClient
      .from(tableName)
      .insert(rows)
      .select('*')
      .order('slot_index');
    if (insertError) throw insertError;
    savedRows = Array.isArray(data) && data.length > 0 ? data : rows;
  }

  const staleIds = activeRows.map((item) => item?.id).filter(Boolean);
  const safeChunkSize = Number.isInteger(deactivateChunkSize) && deactivateChunkSize > 0
    ? deactivateChunkSize
    : DEFAULT_DEACTIVATE_CHUNK_SIZE;
  for (let index = 0; index < staleIds.length; index += safeChunkSize) {
    const chunk = staleIds.slice(index, index + safeChunkSize);
    const { error: deactivateError } = await supabaseClient
      .from(tableName)
      .update({ is_active: false })
      .in('id', chunk);
    if (deactivateError) throw deactivateError;
  }

  return savedRows;
}
