import { useCallback, useEffect, useMemo, useRef } from 'react';
import { usePersistentNumber, usePersistentJson } from '../../hooks/usePersistentState';

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

export default function useScheduleResizeState({ colCount }) {
  const [colRatios, setColRatios] = usePersistentJson(SHOCKWAVE_COL_RATIOS_KEY, null);
  const [dayColWidth, setDayColWidth] = usePersistentNumber(SHOCKWAVE_DAY_COL_WIDTH_KEY, 0);
  const [rowHeight, setRowHeight] = usePersistentNumber(SHOCKWAVE_ROW_HEIGHT_KEY, 23, MIN_SCHEDULE_ROW_HEIGHT);

  const colResizeRef = useRef({ active: false, colIdx: -1, startX: 0, startRatios: [], containerWidth: 0 });
  const dayResizeRef = useRef({ active: false, startX: 0 });
  const rowResizeRef = useRef({ active: false, startY: 0, startHeight: 23 });

  useEffect(() => {
    if (!Array.isArray(colRatios)) return;
    if (colRatios.length >= colCount) return;

    setColRatios((prev) => {
      if (!Array.isArray(prev)) return Array(colCount).fill(1);
      if (prev.length < colCount) return [...prev, ...Array(colCount - prev.length).fill(1)];
      return prev;
    });
  }, [colRatios, colCount, setColRatios]);

  const activeColRatios = useMemo(() => {
    if (!Array.isArray(colRatios)) return null;
    if (colRatios.length >= colCount) return colRatios.slice(0, colCount);
    return [...colRatios, ...Array(colCount - colRatios.length).fill(1)];
  }, [colRatios, colCount]);

  const therapistColsCSS = useMemo(() => {
    return activeColRatios
      ? activeColRatios.map((ratio) => `minmax(0, ${ratio}fr)`).join(' ')
      : `repeat(${colCount}, minmax(0, 1fr))`;
  }, [activeColRatios, colCount]);

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
      latestHeight = Math.max(MIN_SCHEDULE_ROW_HEIGHT, rowResizeRef.current.startHeight + delta);
      setRowHeight(latestHeight);
    };
    const onUp = (upEvent) => {
      rowResizeRef.current.active = false;
      setRowHeight(latestHeight); // Final write
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
  }, [rowHeight, setRowHeight]);

  const startColResize = useCallback((event, colIdx, timeColPx = 0, currentRatios = null) => {
    event.preventDefault();
    event.stopPropagation();
    if (!shouldStartMobileResize(event)) return;
    const startPoint = getPointerClient(event);
    const cur = currentRatios ? [...currentRatios] : Array(colCount).fill(1);
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
    const onMove = (moveEvent) => {
      moveEvent.preventDefault?.();
      if (!colResizeRef.current.active) return;
      const { startRatios: startRatiosValue, containerWidth: width, colIdx: currentColIdx, startX } = colResizeRef.current;
      const point = getPointerClient(moveEvent);
      const delta = point.x - startX;
      const totalRatio = startRatiosValue.reduce((sum, ratio) => sum + ratio, 0);
      const deltaRatio = (delta / width) * totalRatio;
      const nextRatios = [...startRatiosValue];
      nextRatios[currentColIdx] = Math.max(MIN_COL_RATIO, startRatiosValue[currentColIdx] + deltaRatio);
      nextRatios[currentColIdx + 1] = Math.max(MIN_COL_RATIO, startRatiosValue[currentColIdx + 1] - deltaRatio);
      latestRatios = nextRatios;
      setColRatios(prev => {
        const full = Array.isArray(prev) ? [...prev] : [];
        for (let i = 0; i < nextRatios.length; i++) {
          full[i] = nextRatios[i];
        }
        return full;
      });
    };
    const onUp = (upEvent) => {
      colResizeRef.current.active = false;
      setColRatios(prev => {
        const full = Array.isArray(prev) ? [...prev] : [];
        for (let i = 0; i < latestRatios.length; i++) {
          full[i] = latestRatios[i];
        }
        return full;
      });
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
  }, [colCount, setColRatios]);

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
      setDayColWidth(latestWidth);
    };
    const onUp = (upEvent) => {
      dayResizeRef.current.active = false;
      setDayColWidth(latestWidth); // Final write
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
  }, [dayColWidth, setDayColWidth]);

  return {
    activeColRatios,
    dayColWidth,
    rowHeight,
    startColResize,
    startDayResize,
    startRowResize,
    therapistColsCSS,
  };
}
