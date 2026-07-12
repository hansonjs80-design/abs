import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { usePersistentNumber, usePersistentJson } from '../../hooks/usePersistentState';
import { supabase } from '../../lib/supabaseClient';

import {
  SHOCKWAVE_DAY_COL_WIDTH_KEY,
  SHOCKWAVE_COL_RATIOS_KEY,
  SHOCKWAVE_ROW_HEIGHT_KEY,
  TIME_COL_WIDTH,
} from '../../lib/schedulerUtils';

const MIN_SCHEDULE_ROW_HEIGHT = 5;
const MIN_SCHEDULE_DAY_WIDTH = 100;
const MIN_SCHEDULE_DAY_WIDTH_MOBILE = 70;
const MIN_COL_RATIO = 0.2;
const MOBILE_RESIZE_LOCK_KEY = 'clinic-schedule-mobile-resize-locked';
const ROW_HEIGHT_RESIZE_SENSITIVITY = 0.5;
const ROW_HEIGHT_PRECISION = 0.5;
const COL_RESIZE_DOUBLE_CLICK_MS = 500;
const COL_RESIZE_CLICK_MOVE_TOLERANCE = 3;

const SETTINGS_ROW_ID = '00000000-0000-0000-0000-000000000000';

// 기기 지문 생성 (해상도 및 유저 에이전트 기반)
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

// DB에서 기기 설정 복원
async function syncLoadDeviceSettings(setColRatios, setDayColWidth, setRowHeight) {
  try {
    const { data, error } = await supabase
      .from('shockwave_settings')
      .select('monthly_settlement_settings')
      .eq('id', SETTINGS_ROW_ID)
      .single();

    if (error || !data) return;
    const dbDeviceSettings = data.monthly_settlement_settings?.device_settings;
    if (!dbDeviceSettings) return;

    const deviceId = getDeviceFingerprint();
    const mySettings = dbDeviceSettings[deviceId];
    if (!mySettings) return;

    // 로컬 상태 및 로컬스토리지 동기화 복원
    if (mySettings.colRatios) {
      setColRatios(mySettings.colRatios);
    }
    if (mySettings.dayColWidth) {
      setDayColWidth(mySettings.dayColWidth);
    }
    if (mySettings.rowHeight) {
      setRowHeight(mySettings.rowHeight);
    }
  } catch (err) {
    console.error('Failed to load device settings from DB:', err);
  }
}

// DB에 기기 설정 백업 (디바운스 적용)
let backupTimeout = null;
let pendingDeviceSettingsPatch = {};
function syncSaveDeviceSettings(patch) {
  pendingDeviceSettingsPatch = {
    ...pendingDeviceSettingsPatch,
    ...(patch || {}),
  };
  if (backupTimeout) clearTimeout(backupTimeout);
  
  backupTimeout = setTimeout(async () => {
    const patchToSave = pendingDeviceSettingsPatch;
    pendingDeviceSettingsPatch = {};
    try {
      const { data, error: selectErr } = await supabase
        .from('shockwave_settings')
        .select('monthly_settlement_settings')
        .eq('id', SETTINGS_ROW_ID)
        .single();

      if (selectErr) return;

      const deviceId = getDeviceFingerprint();
      const existingSettlementSettings = data?.monthly_settlement_settings || {};
      const existingDeviceSettings = existingSettlementSettings.device_settings || {};
      const currentDeviceSettings = existingDeviceSettings[deviceId] || {};

      const updatedDeviceSettings = {
        ...existingDeviceSettings,
        [deviceId]: {
          ...currentDeviceSettings,
          ...patchToSave,
          updatedAt: new Date().toISOString()
        }
      };

      const updatedSettlementSettings = {
        ...existingSettlementSettings,
        device_settings: updatedDeviceSettings
      };

      await supabase
        .from('shockwave_settings')
        .update({ monthly_settlement_settings: updatedSettlementSettings })
        .eq('id', SETTINGS_ROW_ID);

    } catch (err) {
      console.error('Failed to save device settings to DB:', err);
    }
  }, 1500);
}

const clampRowHeight = (value) => (
  Math.max(
    MIN_SCHEDULE_ROW_HEIGHT,
    Math.round((Number(value) || MIN_SCHEDULE_ROW_HEIGHT) / ROW_HEIGHT_PRECISION) * ROW_HEIGHT_PRECISION
  )
);

const getPointerClient = (event) => {
  const touch = event.touches?.[0] || event.changedTouches?.[0];
  return {
    x: touch?.clientX ?? event.clientX ?? 0,
    y: touch?.clientY ?? event.clientY ?? 0,
  };
};

const isTouchResizeEvent = (event) => Boolean(event?.touches?.length || event?.changedTouches?.length);

const getMinScheduleDayWidth = (event) => {
  if (isTouchResizeEvent(event)) return MIN_SCHEDULE_DAY_WIDTH_MOBILE;
  if (typeof window !== 'undefined' && window.matchMedia?.('(max-width: 768px)').matches) {
    return MIN_SCHEDULE_DAY_WIDTH_MOBILE;
  }
  return MIN_SCHEDULE_DAY_WIDTH;
};

const getMobileResizeLocked = () => {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(MOBILE_RESIZE_LOCK_KEY) === 'true';
};

const setMobileResizeLocked = (locked) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(MOBILE_RESIZE_LOCK_KEY, locked ? 'true' : 'false');
};

const shouldStartMobileResize = (event) => {
  if (!isTouchResizeEvent(event)) return true;
  if (!getMobileResizeLocked()) return true;
  const shouldUnlock = window.confirm('고정된 너비/높이 설정을 다시 조정할까요?');
  if (shouldUnlock) setMobileResizeLocked(false);
  return shouldUnlock;
};

const maybeLockMobileResize = (event) => {
  if (event?.type !== 'touchend') return;
  if (window.confirm('현재 너비/높이 설정을 고정하시겠습니까?')) {
    setMobileResizeLocked(true);
  }
};

const normalizeColRatios = (ratios, colCount) => Array.from({ length: colCount }, (_, idx) => {
  const value = Number(ratios?.[idx]);
  return Number.isFinite(value) && value > 0 ? Math.max(MIN_COL_RATIO, value) : 1;
});

export default function useScheduleResizeState({ colCount }) {
  const [colRatios, setColRatios] = usePersistentJson(SHOCKWAVE_COL_RATIOS_KEY, null);
  const [dayColWidth, setDayColWidth] = usePersistentNumber(SHOCKWAVE_DAY_COL_WIDTH_KEY, 0);
  const [rowHeight, setRowHeight] = usePersistentNumber(SHOCKWAVE_ROW_HEIGHT_KEY, 23, MIN_SCHEDULE_ROW_HEIGHT);
  const [isDeviceSettingsLoading, setIsDeviceSettingsLoading] = useState(true);

  // 마운트 시 서버 DB로부터 크기 동기화
  useEffect(() => {
    let active = true;
    async function load() {
      await syncLoadDeviceSettings(setColRatios, setDayColWidth, setRowHeight);
      if (active) {
        setIsDeviceSettingsLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [setColRatios, setDayColWidth, setRowHeight]);

  // DB 백업용 래퍼 함수들
  const updateRowHeight = useCallback((newValue) => {
    setRowHeight(prev => {
      const next = typeof newValue === 'function' ? newValue(prev) : newValue;
      syncSaveDeviceSettings({ rowHeight: next });
      return next;
    });
  }, [setRowHeight]);

  const updateDayColWidth = useCallback((newValue) => {
    setDayColWidth(prev => {
      const next = typeof newValue === 'function' ? newValue(prev) : newValue;
      syncSaveDeviceSettings({ dayColWidth: next });
      return next;
    });
  }, [setDayColWidth]);

  const updateColRatios = useCallback((newValue) => {
    setColRatios(prev => {
      const next = typeof newValue === 'function' ? newValue(prev) : newValue;
      syncSaveDeviceSettings({ colRatios: next });
      return next;
    });
  }, [setColRatios]);

  const colResizeRef = useRef({ active: false, colIdx: -1, startX: 0, startRatios: [], containerWidth: 0 });
  const colResizeClickRef = useRef({ time: 0, colIdx: -1, moved: false });
  const dayResizeRef = useRef({ active: false, startX: 0 });
  const rowResizeRef = useRef({ active: false, startY: 0, startHeight: 23 });

  const activeColRatios = useMemo(() => {
    if (!Array.isArray(colRatios)) return null;
    return normalizeColRatios(colRatios, colCount);
  }, [colRatios, colCount]);

  const therapistColsCSS = useMemo(() => {
    return activeColRatios
      ? activeColRatios.map((ratio) => `minmax(0, ${ratio}fr)`).join(' ')
      : `repeat(${colCount}, minmax(0, 1fr))`;
  }, [activeColRatios, colCount]);

  const resetColRatios = useCallback((event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    updateColRatios(Array(colCount).fill(1));
  }, [colCount, updateColRatios]);

  const startRowResize = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!shouldStartMobileResize(event)) return;
    const startPoint = getPointerClient(event);
    rowResizeRef.current = { active: true, startY: startPoint.y, startHeight: rowHeight };
    let latestHeight = rowHeight;
    const onMove = (moveEvent) => {
      moveEvent.preventDefault?.();
      if (!rowResizeRef.current.active) return;
      const point = getPointerClient(moveEvent);
      const delta = point.y - rowResizeRef.current.startY;
      latestHeight = clampRowHeight(rowResizeRef.current.startHeight + (delta * ROW_HEIGHT_RESIZE_SENSITIVITY));
      updateRowHeight(latestHeight);
    };
    const onUp = (upEvent) => {
      rowResizeRef.current.active = false;
      updateRowHeight(latestHeight); // Final write
      maybeLockMobileResize(upEvent);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
      window.removeEventListener('touchcancel', onUp);
      window.removeEventListener('blur', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
    window.addEventListener('touchcancel', onUp);
    window.addEventListener('blur', onUp);
  }, [rowHeight, updateRowHeight]);

  const startColResize = useCallback((event, colIdx, timeColPx = 0, currentRatios = null) => {
    event.preventDefault();
    event.stopPropagation();
    if (!shouldStartMobileResize(event)) return;
    const now = Date.now();
    const lastClick = colResizeClickRef.current;
    const isDoubleClickReset = event.type === 'mousedown' && (
      event.detail >= 2 ||
      (
        lastClick.colIdx === colIdx &&
        !lastClick.moved &&
        now - lastClick.time <= COL_RESIZE_DOUBLE_CLICK_MS
      )
    );
    if (isDoubleClickReset) {
      colResizeRef.current.active = false;
      colResizeClickRef.current = { time: 0, colIdx: -1, moved: false };
      resetColRatios(event);
      return;
    }
    colResizeClickRef.current = { time: now, colIdx, moved: false };
    const startPoint = getPointerClient(event);
    const cur = currentRatios ? normalizeColRatios(currentRatios, colCount) : Array(colCount).fill(1);
    const wrapper = event.currentTarget.closest('.sw-therapist-header-wrapper');
    const containerWidth = Math.max(1, (wrapper?.getBoundingClientRect().width || 1) - timeColPx);
    colResizeRef.current = {
      active: true,
      colIdx,
      startX: startPoint.x,
      startRatios: [...cur],
      containerWidth,
    };
    let latestRatios = cur;
    let didResize = false;
    const onMove = (moveEvent) => {
      moveEvent.preventDefault?.();
      if (!colResizeRef.current.active) return;
      const { startRatios: startRatiosValue, containerWidth: width, colIdx: currentColIdx, startX } = colResizeRef.current;
      const point = getPointerClient(moveEvent);
      const delta = point.x - startX;
      if (Math.abs(delta) <= COL_RESIZE_CLICK_MOVE_TOLERANCE) return;
      didResize = true;
      colResizeClickRef.current.moved = true;
      const totalRatio = startRatiosValue.reduce((sum, ratio) => sum + ratio, 0);
      const deltaRatio = (delta / width) * totalRatio;
      const nextRatios = [...startRatiosValue];
      nextRatios[currentColIdx] = Math.max(MIN_COL_RATIO, startRatiosValue[currentColIdx] + deltaRatio);
      nextRatios[currentColIdx + 1] = Math.max(MIN_COL_RATIO, startRatiosValue[currentColIdx + 1] - deltaRatio);
      latestRatios = nextRatios;
      updateColRatios(prev => {
        const full = Array.isArray(prev) ? [...prev] : [];
        for (let i = 0; i < nextRatios.length; i++) {
          full[i] = nextRatios[i];
        }
        return full;
      });
    };
    const onUp = (upEvent) => {
      colResizeRef.current.active = false;
      if (didResize) {
        updateColRatios(prev => {
          const full = Array.isArray(prev) ? [...prev] : [];
          for (let i = 0; i < latestRatios.length; i++) {
            full[i] = latestRatios[i];
          }
          return full;
        });
      }
      maybeLockMobileResize(upEvent);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
      window.removeEventListener('touchcancel', onUp);
      window.removeEventListener('blur', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
    window.addEventListener('touchcancel', onUp);
    window.addEventListener('blur', onUp);
  }, [colCount, resetColRatios, updateColRatios]);

  const startDayResize = useCallback((event, showTimeCol) => {
    event.preventDefault();
    event.stopPropagation();
    if (!shouldStartMobileResize(event)) return;
    const startPoint = getPointerClient(event);
    const minDayWidth = getMinScheduleDayWidth(event);
    const dayElement = event.currentTarget.closest('.shockwave-day');
    const currentDayWidth = dayElement?.getBoundingClientRect().width || minDayWidth;
    const normalizedDayWidth = showTimeCol
      ? Math.max(minDayWidth, currentDayWidth - TIME_COL_WIDTH)
      : currentDayWidth;
    dayResizeRef.current = { active: true, startX: startPoint.x };
    let latestWidth = dayColWidth || normalizedDayWidth;
    const onMove = (moveEvent) => {
      moveEvent.preventDefault?.();
      if (!dayResizeRef.current.active) return;
      const point = getPointerClient(moveEvent);
      const delta = point.x - dayResizeRef.current.startX;
      latestWidth = Math.max(minDayWidth, normalizedDayWidth + delta);
      updateDayColWidth(latestWidth);
    };
    const onUp = (upEvent) => {
      dayResizeRef.current.active = false;
      updateDayColWidth(latestWidth); // Final write
      maybeLockMobileResize(upEvent);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
      window.removeEventListener('touchcancel', onUp);
      window.removeEventListener('blur', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
    window.addEventListener('touchcancel', onUp);
    window.addEventListener('blur', onUp);
  }, [dayColWidth, updateDayColWidth]);

  return {
    activeColRatios,
    dayColWidth,
    rowHeight,
    setRowHeight: updateRowHeight,
    setDayColWidth: updateDayColWidth,
    resetColRatios,
    startColResize,
    startDayResize,
    startRowResize,
    therapistColsCSS,
    isDeviceSettingsLoading,
  };
}
