import { supabase } from './supabaseClient.js';

export const DEFAULT_SCHEDULER_TEXT_SETTINGS = {
  font_size: 13,
  font_weight: 700,
  time_font_size: 12,
  time_font_weight: 700,
  header_font_size: 16,
  header_font_weight: 700,
  header_height: 32,
  therapist_font_size: 14,
  therapist_font_weight: 700,
  therapist_height: 29,
};

function normalizeFontSize(value) {
  const nextValue = Number(value);
  if (!Number.isFinite(nextValue)) return DEFAULT_SCHEDULER_TEXT_SETTINGS.font_size;
  const clamped = Math.min(18, Math.max(9, nextValue));
  return Math.round(clamped * 2) / 2;
}

function normalizeHeaderFontSize(value, defaultVal) {
  const nextValue = Number(value);
  if (!Number.isFinite(nextValue)) return defaultVal;
  const clamped = Math.min(24, Math.max(10, nextValue));
  return Math.round(clamped * 2) / 2;
}

function normalizeTimeFontSize(value) {
  const nextValue = Number(value);
  if (!Number.isFinite(nextValue)) return DEFAULT_SCHEDULER_TEXT_SETTINGS.time_font_size;
  const clamped = Math.min(16, Math.max(8, nextValue));
  return Math.round(clamped * 2) / 2;
}

function normalizeFontWeight(value, defaultVal = 700) {
  const nextValue = Number(value);
  if (!Number.isFinite(nextValue)) return defaultVal;
  const allowed = [500, 600, 700, 800, 900];
  return allowed.includes(nextValue) ? nextValue : defaultVal;
}

function normalizeHeaderHeight(value, defaultVal) {
  const nextValue = Number(value);
  if (!Number.isFinite(nextValue)) return defaultVal;
  return Math.min(80, Math.max(10, Math.round(nextValue)));
}

export const SCHEDULER_TEXT_SETTINGS_KEY = 'shockwave-scheduler-text-settings';

const SETTINGS_ROW_ID = '00000000-0000-0000-0000-000000000000';

// 기기 지문 생성 (useScheduleResizeState.js와 동일한 알고리즘)
const getDeviceFingerprint = () => {
  if (typeof window === 'undefined') return 'default-device';
  try {
    const screenInfo = `${window.screen.width}x${window.screen.height}x${window.screen.colorDepth}`;
    const userAgent = window.navigator.userAgent;
    const raw = `${screenInfo}-${userAgent}`;
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      const char = raw.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return `dev_${Math.abs(hash)}`;
  } catch {
    return 'default-device';
  }
};

function normalizeTextConfig(parsed) {
  if (!parsed) return null;
  return {
    font_size: normalizeFontSize(parsed.font_size),
    font_weight: normalizeFontWeight(parsed.font_weight, DEFAULT_SCHEDULER_TEXT_SETTINGS.font_weight),
    time_font_size: normalizeTimeFontSize(parsed.time_font_size),
    time_font_weight: normalizeFontWeight(parsed.time_font_weight, DEFAULT_SCHEDULER_TEXT_SETTINGS.time_font_weight),
    header_font_size: normalizeHeaderFontSize(parsed.header_font_size, DEFAULT_SCHEDULER_TEXT_SETTINGS.header_font_size),
    header_font_weight: normalizeFontWeight(parsed.header_font_weight, DEFAULT_SCHEDULER_TEXT_SETTINGS.header_font_weight),
    header_height: normalizeHeaderHeight(parsed.header_height, DEFAULT_SCHEDULER_TEXT_SETTINGS.header_height),
    therapist_font_size: normalizeHeaderFontSize(parsed.therapist_font_size, DEFAULT_SCHEDULER_TEXT_SETTINGS.therapist_font_size),
    therapist_font_weight: normalizeFontWeight(parsed.therapist_font_weight, DEFAULT_SCHEDULER_TEXT_SETTINGS.therapist_font_weight),
    therapist_height: normalizeHeaderHeight(parsed.therapist_height, DEFAULT_SCHEDULER_TEXT_SETTINGS.therapist_height),
  };
}

export function getEffectiveSchedulerTextSettings() {
  if (typeof window === 'undefined') return DEFAULT_SCHEDULER_TEXT_SETTINGS;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SCHEDULER_TEXT_SETTINGS_KEY) || 'null');
    const normalized = normalizeTextConfig(parsed);
    if (normalized) return normalized;
  } catch {
    // Ignored
  }
  return DEFAULT_SCHEDULER_TEXT_SETTINGS;
}

export function setMonthlySchedulerTextSettings(settings, _year, _month, nextConfig) {
  if (typeof window === 'undefined') return settings?.monthly_settlement_settings || {};
  try {
    const current = getEffectiveSchedulerTextSettings();
    const updated = {
      font_size: normalizeFontSize(nextConfig?.font_size ?? current.font_size),
      font_weight: normalizeFontWeight(nextConfig?.font_weight ?? current.font_weight, DEFAULT_SCHEDULER_TEXT_SETTINGS.font_weight),
      time_font_size: normalizeTimeFontSize(nextConfig?.time_font_size ?? current.time_font_size),
      time_font_weight: normalizeFontWeight(nextConfig?.time_font_weight ?? current.time_font_weight, DEFAULT_SCHEDULER_TEXT_SETTINGS.time_font_weight),
      header_font_size: normalizeHeaderFontSize(nextConfig?.header_font_size ?? current.header_font_size, DEFAULT_SCHEDULER_TEXT_SETTINGS.header_font_size),
      header_font_weight: normalizeFontWeight(nextConfig?.header_font_weight ?? current.header_font_weight, DEFAULT_SCHEDULER_TEXT_SETTINGS.header_font_weight),
      header_height: normalizeHeaderHeight(nextConfig?.header_height ?? current.header_height, DEFAULT_SCHEDULER_TEXT_SETTINGS.header_height),
      therapist_font_size: normalizeHeaderFontSize(nextConfig?.therapist_font_size ?? current.therapist_font_size, DEFAULT_SCHEDULER_TEXT_SETTINGS.therapist_font_size),
      therapist_font_weight: normalizeFontWeight(nextConfig?.therapist_font_weight ?? current.therapist_font_weight, DEFAULT_SCHEDULER_TEXT_SETTINGS.therapist_font_weight),
      therapist_height: normalizeHeaderHeight(nextConfig?.therapist_height ?? current.therapist_height, DEFAULT_SCHEDULER_TEXT_SETTINGS.therapist_height),
    };
    window.localStorage.setItem(SCHEDULER_TEXT_SETTINGS_KEY, JSON.stringify(updated));
    window.dispatchEvent(new Event('scheduler-text-settings-changed'));

    // 기기별 DB 백업
    syncSaveTextSettings(updated);
  } catch {
    // Ignored
  }
  
  return settings?.monthly_settlement_settings || {};
}

// DB에서 기기별 글자 크기 설정 복원
export async function syncLoadTextSettings() {
  try {
    const { data, error } = await supabase
      .from('shockwave_settings')
      .select('monthly_settlement_settings')
      .eq('id', SETTINGS_ROW_ID)
      .single();

    if (error || !data) return null;
    const deviceTextSettings = data.monthly_settlement_settings?.device_text_settings;
    if (!deviceTextSettings) return null;

    const deviceId = getDeviceFingerprint();
    const mySettings = deviceTextSettings[deviceId];
    if (!mySettings) return null;

    const normalized = normalizeTextConfig(mySettings);
    if (!normalized) return null;

    // 로컬스토리지에도 동기화
    window.localStorage.setItem(SCHEDULER_TEXT_SETTINGS_KEY, JSON.stringify(normalized));
    window.dispatchEvent(new Event('scheduler-text-settings-changed'));
    return normalized;
  } catch (err) {
    console.error('Failed to load device text settings from DB:', err);
    return null;
  }
}

// DB에 기기별 글자 크기 설정 백업 (디바운스 적용)
let textBackupTimeout = null;
export function syncSaveTextSettings(textSettings) {
  if (textBackupTimeout) clearTimeout(textBackupTimeout);

  textBackupTimeout = setTimeout(async () => {
    try {
      const { data, error: selectErr } = await supabase
        .from('shockwave_settings')
        .select('monthly_settlement_settings')
        .eq('id', SETTINGS_ROW_ID)
        .single();

      if (selectErr) return;

      const deviceId = getDeviceFingerprint();
      const existingSettlementSettings = data?.monthly_settlement_settings || {};
      const existingTextSettings = existingSettlementSettings.device_text_settings || {};

      const updatedTextSettings = {
        ...existingTextSettings,
        [deviceId]: {
          ...textSettings,
          updatedAt: new Date().toISOString(),
        },
      };

      const updatedSettlementSettings = {
        ...existingSettlementSettings,
        device_text_settings: updatedTextSettings,
      };

      await supabase
        .from('shockwave_settings')
        .update({ monthly_settlement_settings: updatedSettlementSettings })
        .eq('id', SETTINGS_ROW_ID);
    } catch (err) {
      console.error('Failed to save device text settings to DB:', err);
    }
  }, 1500);
}
