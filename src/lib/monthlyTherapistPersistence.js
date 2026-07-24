const MONTHLY_THERAPIST_TABLE = 'shockwave_monthly_therapists';
const MONTHLY_THERAPIST_CONFLICT_COLUMNS = 'year,month,slot_index,start_day,type';

function toRequiredInteger(value, label, { min, max } = {}) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${label} 값이 올바르지 않습니다.`);
  }
  if (Number.isFinite(min) && parsed < min) {
    throw new Error(`${label} 값이 올바르지 않습니다.`);
  }
  if (Number.isFinite(max) && parsed > max) {
    throw new Error(`${label} 값이 올바르지 않습니다.`);
  }
  return parsed;
}

export function getMonthlyTherapistConfigKey(config) {
  return [
    Number(config?.year),
    Number(config?.month),
    Number(config?.slot_index),
    Number(config?.start_day),
    String(config?.type || ''),
  ].join(':');
}

export function normalizeMonthlyTherapistConfigs({
  year,
  month,
  configs,
  type = 'shockwave',
} = {}) {
  if (!Array.isArray(configs)) {
    throw new Error('월별 치료사 설정 목록이 올바르지 않습니다.');
  }

  const safeYear = toRequiredInteger(year, '연도', { min: 2000, max: 9999 });
  const safeMonth = toRequiredInteger(month, '월', { min: 1, max: 12 });
  const safeType = String(type || '').trim();
  if (!safeType) throw new Error('치료 유형이 올바르지 않습니다.');

  const seenKeys = new Set();
  return configs.map((config, index) => {
    const slotIndex = toRequiredInteger(config?.slot_index, `${index + 1}번째 슬롯`, { min: 0 });
    const startDay = toRequiredInteger(config?.start_day, `${index + 1}번째 시작일`, { min: 1, max: 31 });
    const endDay = toRequiredInteger(config?.end_day, `${index + 1}번째 종료일`, { min: 1, max: 31 });
    if (startDay > endDay) {
      throw new Error(`${index + 1}번째 설정의 시작일이 종료일보다 늦습니다.`);
    }

    const row = {
      year: safeYear,
      month: safeMonth,
      slot_index: slotIndex,
      therapist_name: String(config?.therapist_name ?? ''),
      start_day: startDay,
      end_day: endDay,
      type: safeType,
    };
    const key = getMonthlyTherapistConfigKey(row);
    if (seenKeys.has(key)) {
      throw new Error(`${index + 1}번째 월별 치료사 설정이 중복되었습니다.`);
    }
    seenKeys.add(key);
    return row;
  });
}

export function buildMonthlyTherapistSavePlan({
  existingRows = [],
  normalizedConfigs = [],
} = {}) {
  const desiredKeys = new Set(normalizedConfigs.map(getMonthlyTherapistConfigKey));
  const staleIds = (Array.isArray(existingRows) ? existingRows : [])
    .filter((row) => !desiredKeys.has(getMonthlyTherapistConfigKey(row)))
    .map((row) => row?.id)
    .filter(Boolean);

  return {
    rowsToUpsert: normalizedConfigs,
    staleIds: Array.from(new Set(staleIds)),
  };
}

export async function saveMonthlyTherapistConfigs({
  supabaseClient,
  year,
  month,
  configs,
  type = 'shockwave',
  deleteChunkSize = 100,
} = {}) {
  if (!supabaseClient) {
    throw new Error('월별 치료사 설정 저장소가 연결되지 않았습니다.');
  }

  const normalizedConfigs = normalizeMonthlyTherapistConfigs({
    year,
    month,
    configs,
    type,
  });
  const { data: existingRows, error: selectError } = await supabaseClient
    .from(MONTHLY_THERAPIST_TABLE)
    .select('id, year, month, slot_index, start_day, type')
    .eq('year', Number(year))
    .eq('month', Number(month))
    .eq('type', String(type));
  if (selectError) throw selectError;

  const { rowsToUpsert, staleIds } = buildMonthlyTherapistSavePlan({
    existingRows,
    normalizedConfigs,
  });

  if (rowsToUpsert.length > 0) {
    const { error: upsertError } = await supabaseClient
      .from(MONTHLY_THERAPIST_TABLE)
      .upsert(rowsToUpsert, { onConflict: MONTHLY_THERAPIST_CONFLICT_COLUMNS });
    if (upsertError) throw upsertError;
  }

  const safeChunkSize = Number.isInteger(deleteChunkSize) && deleteChunkSize > 0
    ? deleteChunkSize
    : 100;
  for (let index = 0; index < staleIds.length; index += safeChunkSize) {
    const chunk = staleIds.slice(index, index + safeChunkSize);
    const { error: deleteError } = await supabaseClient
      .from(MONTHLY_THERAPIST_TABLE)
      .delete()
      .in('id', chunk);
    if (deleteError) throw deleteError;
  }

  return normalizedConfigs;
}
