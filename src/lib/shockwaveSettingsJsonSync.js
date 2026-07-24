export const DEVICE_SETTINGS_SYNC_EVENT = 'abs:device-settings-sync';

const DEFAULT_SETTINGS_ROW_ID = '00000000-0000-0000-0000-000000000000';
const DEFAULT_MAX_ATTEMPTS = 3;

let settingsJsonWriteQueue = Promise.resolve();

function isRetryableSyncError(error) {
  const message = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
  const status = Number(error?.status || error?.statusCode || 0);
  return (
    status >= 500 ||
    /network|fetch|timeout|timed out|connection|temporar|econn|socket/.test(message)
  );
}

function waitBeforeRetry(attempt) {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.min(500, 120 * (attempt + 1)));
  });
}

function dispatchSyncStatus(detail) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(DEVICE_SETTINGS_SYNC_EVENT, { detail }));
}

async function loadLatestSettingsRow(supabaseClient) {
  const { data, error } = await supabaseClient
    .from('shockwave_settings')
    .select('id, monthly_settlement_settings, updated_at')
    .order('updated_at', { ascending: false })
    .limit(1)
    .single();
  if (error) throw error;
  if (!data || Array.isArray(data)) {
    throw new Error('충격파 설정 행을 찾을 수 없습니다.');
  }
  return data;
}

export async function saveShockwaveSettingsJsonPatch({
  supabaseClient,
  mutate,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
} = {}) {
  if (!supabaseClient) throw new Error('설정 저장소가 연결되지 않았습니다.');
  if (typeof mutate !== 'function') throw new Error('설정 변경 함수가 필요합니다.');

  const attempts = Number.isInteger(maxAttempts) && maxAttempts > 0
    ? maxAttempts
    : DEFAULT_MAX_ATTEMPTS;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const row = await loadLatestSettingsRow(supabaseClient);
      const currentSettings = (
        row.monthly_settlement_settings &&
        typeof row.monthly_settlement_settings === 'object' &&
        !Array.isArray(row.monthly_settlement_settings)
      )
        ? row.monthly_settlement_settings
        : {};
      const nextSettings = mutate(currentSettings);
      if (!nextSettings || typeof nextSettings !== 'object' || Array.isArray(nextSettings)) {
        throw new Error('저장할 기기 설정이 올바르지 않습니다.');
      }

      const nextUpdatedAt = new Date().toISOString();
      let updateQuery = supabaseClient
        .from('shockwave_settings')
        .update({
          monthly_settlement_settings: nextSettings,
          updated_at: nextUpdatedAt,
        })
        .eq('id', row.id || DEFAULT_SETTINGS_ROW_ID);
      if (row.updated_at) {
        updateQuery = updateQuery.eq('updated_at', row.updated_at);
      }
      const { data: updatedRows, error: updateError } = await updateQuery.select('id, updated_at');
      if (updateError) throw updateError;
      if (Array.isArray(updatedRows) && updatedRows.length > 0) {
        return nextSettings;
      }
    } catch (error) {
      const canRetry = attempt + 1 < attempts && isRetryableSyncError(error);
      if (!canRetry) throw error;
      await waitBeforeRetry(attempt);
    }
  }

  throw new Error('다른 기기에서 설정이 동시에 변경되어 저장하지 못했습니다.');
}

export function enqueueShockwaveSettingsJsonPatch({
  scope = 'device-settings',
  ...options
} = {}) {
  const task = settingsJsonWriteQueue
    .catch(() => {})
    .then(() => saveShockwaveSettingsJsonPatch(options))
    .then((result) => {
      dispatchSyncStatus({ status: 'saved', scope });
      return result;
    })
    .catch((error) => {
      dispatchSyncStatus({
        status: 'error',
        scope,
        message: error?.message || String(error),
      });
      throw error;
    });
  settingsJsonWriteQueue = task;
  return task;
}
