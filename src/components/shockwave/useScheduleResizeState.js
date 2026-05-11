import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  SHOCKWAVE_DAY_COL_WIDTH_KEY,
  SHOCKWAVE_COL_RATIOS_KEY,
  SHOCKWAVE_ROW_HEIGHT_KEY,
  TIME_COL_WIDTH,
} from '../../lib/schedulerUtils';

const MIN_SCHEDULE_ROW_HEIGHT = 18;
const MIN_SCHEDULE_DAY_WIDTH = 100;
const MIN_COL_RATIO = 0.2;

function readStoredNumber(key, fallback) {
  if (typeof window === 'undefined') return fallback;
  try {
    const value = Number(window.localStorage.getItem(key));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

function writeStoredNumber(key, value) {
  if (typeof window === 'undefined') return;
  try {
    if (Number.isFinite(value) && value > 0) window.localStorage.setItem(key, String(value));
  } catch {
    // localStorage may be unavailable in restricted browser contexts.
  }
}

function readStoredColRatios() {
  if (typeof window === 'undefined') return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SHOCKWAVE_COL_RATIOS_KEY) || 'null');
    return Array.isArray(parsed) && parsed.every((value) => Number.isFinite(value) && value > 0)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function writeStoredColRatios(value) {
  if (typeof window === 'undefined') return;
  if (!Array.isArray(value) || value.length === 0) return;
  try {
    window.localStorage.setItem(SHOCKWAVE_COL_RATIOS_KEY, JSON.stringify(value));
  } catch {
    // localStorage may be unavailable in restricted browser contexts.
  }
}

export default function useScheduleResizeState({ colCount }) {
  const [colRatios, setColRatios] = useState(() => readStoredColRatios());
  const [dayColWidth, setDayColWidth] = useState(() => {
    const saved = readStoredNumber(SHOCKWAVE_DAY_COL_WIDTH_KEY, 0);
    return saved > 0 ? saved : null;
  });
  const [rowHeight, setRowHeight] = useState(() => {
    return Math.max(MIN_SCHEDULE_ROW_HEIGHT, readStoredNumber(SHOCKWAVE_ROW_HEIGHT_KEY, 23));
  });

  const colResizeRef = useRef({ active: false, colIdx: -1, startX: 0, startRatios: [], containerWidth: 0 });
  const dayResizeRef = useRef({ active: false, startX: 0 });
  const rowResizeRef = useRef({ active: false, startY: 0, startHeight: 23 });
  const dayColWidthRef = useRef(dayColWidth);
  const rowHeightRef = useRef(rowHeight);
  const colRatiosRef = useRef(colRatios);

  useEffect(() => {
    dayColWidthRef.current = dayColWidth;
    writeStoredNumber(SHOCKWAVE_DAY_COL_WIDTH_KEY, dayColWidth || 0);
  }, [dayColWidth]);

  useEffect(() => {
    rowHeightRef.current = rowHeight;
    writeStoredNumber(SHOCKWAVE_ROW_HEIGHT_KEY, rowHeight);
  }, [rowHeight]);

  useEffect(() => {
    colRatiosRef.current = colRatios;
    writeStoredColRatios(colRatios);
  }, [colRatios]);

  useEffect(() => {
    if (!Array.isArray(colRatios)) return;
    if (colRatios.length >= colCount) return;

    setColRatios((prev) => {
      if (!Array.isArray(prev)) return Array(colCount).fill(1);
      if (prev.length < colCount) return [...prev, ...Array(colCount - prev.length).fill(1)];
      return prev;
    });
  }, [colRatios, colCount]);

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
    rowResizeRef.current = { active: true, startY: event.clientY, startHeight: rowHeight };
    let latestHeight = rowHeight;
    const onMove = (moveEvent) => {
      if (!rowResizeRef.current.active) return;
      const delta = moveEvent.clientY - rowResizeRef.current.startY;
      latestHeight = Math.max(MIN_SCHEDULE_ROW_HEIGHT, rowResizeRef.current.startHeight + delta);
      rowHeightRef.current = latestHeight;
      writeStoredNumber(SHOCKWAVE_ROW_HEIGHT_KEY, latestHeight);
      setRowHeight(latestHeight);
    };
    const onUp = () => {
      rowResizeRef.current.active = false;
      rowHeightRef.current = latestHeight;
      writeStoredNumber(SHOCKWAVE_ROW_HEIGHT_KEY, latestHeight);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('blur', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('blur', onUp);
  }, [rowHeight]);

  const startColResize = useCallback((event, colIdx, timeColPx = 0, currentRatios = null) => {
    event.preventDefault();
    event.stopPropagation();
    const cur = currentRatios ? [...currentRatios] : Array(colCount).fill(1);
    const wrapper = event.currentTarget.closest('.sw-therapist-header-wrapper');
    const containerWidth = Math.max(1, (wrapper?.getBoundingClientRect().width || 1) - timeColPx);
    colResizeRef.current = {
      active: true,
      colIdx,
      startX: event.clientX,
      startRatios: [...cur],
      containerWidth,
    };
    let latestRatios = cur;
    const onMove = (moveEvent) => {
      if (!colResizeRef.current.active) return;
      const { startRatios: startRatiosValue, containerWidth: width, colIdx: currentColIdx, startX } = colResizeRef.current;
      const delta = moveEvent.clientX - startX;
      const totalRatio = startRatiosValue.reduce((sum, ratio) => sum + ratio, 0);
      const deltaRatio = (delta / width) * totalRatio;
      const nextRatios = [...startRatiosValue];
      nextRatios[currentColIdx] = Math.max(MIN_COL_RATIO, startRatiosValue[currentColIdx] + deltaRatio);
      nextRatios[currentColIdx + 1] = Math.max(MIN_COL_RATIO, startRatiosValue[currentColIdx + 1] - deltaRatio);
      latestRatios = nextRatios;
      colRatiosRef.current = nextRatios;
      writeStoredColRatios(nextRatios);
      setColRatios(nextRatios);
    };
    const onUp = () => {
      colResizeRef.current.active = false;
      colRatiosRef.current = latestRatios;
      writeStoredColRatios(latestRatios);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('blur', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('blur', onUp);
  }, [colCount]);

  const startDayResize = useCallback((event, showTimeCol) => {
    event.preventDefault();
    event.stopPropagation();
    const dayElement = event.currentTarget.closest('.shockwave-day');
    const currentDayWidth = dayElement?.getBoundingClientRect().width || MIN_SCHEDULE_DAY_WIDTH;
    const normalizedDayWidth = showTimeCol
      ? Math.max(MIN_SCHEDULE_DAY_WIDTH, currentDayWidth - TIME_COL_WIDTH)
      : currentDayWidth;
    dayResizeRef.current = { active: true, startX: event.clientX };
    let latestWidth = dayColWidth || normalizedDayWidth;
    const onMove = (moveEvent) => {
      if (!dayResizeRef.current.active) return;
      const delta = moveEvent.clientX - dayResizeRef.current.startX;
      latestWidth = Math.max(MIN_SCHEDULE_DAY_WIDTH, normalizedDayWidth + delta);
      dayColWidthRef.current = latestWidth;
      writeStoredNumber(SHOCKWAVE_DAY_COL_WIDTH_KEY, latestWidth);
      setDayColWidth(latestWidth);
    };
    const onUp = () => {
      dayResizeRef.current.active = false;
      dayColWidthRef.current = latestWidth;
      writeStoredNumber(SHOCKWAVE_DAY_COL_WIDTH_KEY, latestWidth);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('blur', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('blur', onUp);
  }, [dayColWidth]);

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
