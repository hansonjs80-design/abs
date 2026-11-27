import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { isSameDate } from '../../lib/calendarUtils';
import { getScheduleShortcutKey, isMetaEvent } from '../../lib/scheduleKeyboardUtils';
import {
  getScheduleWeekIndexForDate,
  getScheduleStickyTopOffset,
  getScheduleWheelWeekDirection,
  getVisibleScheduleWeekIndex,
} from '../../lib/scheduleNavigationUtils';
import { shockwaveScheduleScrollMemory } from '../../lib/schedulerUtils';

const WEEK_WHEEL_TARGET_RESET_MS = 800;
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

const getAncestorTransformOffsetY = (el) => {
  if (!el || typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') {
    return 0;
  }
  let offsetY = 0;
  let current = el;
  while (current && current !== document.body && current !== document.documentElement) {
    const transform = window.getComputedStyle(current)?.transform;
    if (transform && transform !== 'none') {
      const matrixMatch = transform.match(/^matrix\(([^)]+)\)$/);
      if (matrixMatch) {
        const values = matrixMatch[1].split(',').map((part) => Number(part.trim()));
        if (Number.isFinite(values[5])) {
          offsetY += values[5];
        }
      } else {
        const matrix3dMatch = transform.match(/^matrix3d\(([^)]+)\)$/);
        if (matrix3dMatch) {
          const values = matrix3dMatch[1].split(',').map((part) => Number(part.trim()));
          if (Number.isFinite(values[13])) {
            offsetY += values[13];
          }
        }
      }
    }
    current = current.parentElement;
  }
  return offsetY;
};

const getWeekTop = (weekEl) => {
  if (!weekEl || typeof window === 'undefined') return 0;
  const rect = weekEl.getBoundingClientRect();
  return rect.top + (window.scrollY || window.pageYOffset || 0) - getAncestorTransformOffsetY(weekEl);
};

export default function useScheduleTodayNavigation({
  weeks,
  today,
  weekRefs,
  scheduleScrollKey,
  currentYear,
  currentMonth,
  isInitialScrollReady = true,
  targetDate = null,
  onTargetDateScrolled,
  onNavigateToTodayMonth,
  shortcutLabel,
  setTodayShortcutTooltip,
  shouldDeferShortcut,
}) {
  const todayWeekIdx = useMemo(() => {
    let idx = weeks.findIndex((weekDays) => weekDays.some((dayInfo) => isSameDate(dayInfo.date, today)));
    if (idx !== -1) return idx;

    idx = weeks.findIndex((weekDays) => {
      if (!weekDays || weekDays.length === 0) return false;
      const mondayDate = new Date(weekDays[0].date);
      mondayDate.setHours(0, 0, 0, 0);
      const sundayDate = new Date(mondayDate);
      sundayDate.setDate(mondayDate.getDate() + 6);
      sundayDate.setHours(23, 59, 59, 999);
      return today >= mondayDate && today <= sundayDate;
    });
    return idx;
  }, [weeks, today]);

  const isCurrentScheduleMonth = currentYear === today.getFullYear() && currentMonth === today.getMonth() + 1;
  const shouldAutoScrollToToday = isCurrentScheduleMonth && todayWeekIdx >= 0;

  const scrollToWeek = useCallback((weekEl, behavior = 'smooth') => {
    if (!weekEl || typeof window === 'undefined') return false;
    const topOffset = getScheduleStickyTopOffset();
    const targetTop = Math.max(0, getWeekTop(weekEl) - topOffset);
    window.scrollTo({
      top: targetTop,
      left: window.scrollX || window.pageXOffset || 0,
      behavior,
    });
    return true;
  }, []);

  const scrollToTodayWeek = useCallback((instant = false) => {
    if (todayWeekIdx < 0 || typeof window === 'undefined') return false;
    const weekEl = weekRefs.current[todayWeekIdx];
    return scrollToWeek(weekEl, instant ? 'instant' : 'smooth');
  }, [scrollToWeek, todayWeekIdx, weekRefs]);

  const isTargetScheduleMonth = targetDate instanceof Date
    && !Number.isNaN(targetDate.getTime())
    && currentYear === targetDate.getFullYear()
    && currentMonth === targetDate.getMonth() + 1;
  const targetWeekIdx = useMemo(() => {
    if (!isTargetScheduleMonth) return -1;
    const exactWeekIdx = getScheduleWeekIndexForDate(weeks, targetDate);
    if (exactWeekIdx >= 0) return exactWeekIdx;
    if (isSameDate(targetDate, today)) return todayWeekIdx;
    return -1;
  }, [isTargetScheduleMonth, targetDate, today, todayWeekIdx, weeks]);

  const scrollToTargetDateWeek = useCallback((instant = false) => {
    if (targetWeekIdx < 0 || typeof window === 'undefined') return false;
    return scrollToWeek(
      weekRefs.current[targetWeekIdx],
      instant ? 'instant' : 'smooth'
    );
  }, [scrollToWeek, targetWeekIdx, weekRefs]);

  const scrollToAdjacentVisibleWeek = useCallback((direction, fromWeekIdx = null) => {
    if (!weeks.length || typeof window === 'undefined') return false;
    const topOffset = getScheduleStickyTopOffset();
    const scrollY = window.scrollY || window.pageYOffset || 0;
    const anchorY = scrollY + topOffset + 1;
    const weekTops = weekRefs.current
      .slice(0, weeks.length)
      .map((weekEl) => (weekEl ? getWeekTop(weekEl) : Number.NaN));
    const scrollHeight = Math.max(
      document.documentElement?.scrollHeight || 0,
      document.body?.scrollHeight || 0,
    );
    const hasRequestedStartWeek = Number.isInteger(fromWeekIdx)
      && fromWeekIdx >= 0
      && fromWeekIdx < weeks.length;
    const currentWeekIdx = hasRequestedStartWeek
      ? fromWeekIdx
      : getVisibleScheduleWeekIndex(weekTops, anchorY, {
        scrollY,
        viewportHeight: window.innerHeight,
        scrollHeight,
      });
    if (currentWeekIdx < 0) return false;

    const weekOffset = direction < 0 ? -1 : 1;
    const targetWeekIdx = currentWeekIdx + weekOffset;
    if (targetWeekIdx < 0 || targetWeekIdx >= weeks.length) return false;
    return scrollToWeek(weekRefs.current[targetWeekIdx])
      ? targetWeekIdx
      : false;
  }, [scrollToWeek, weekRefs, weeks.length]);

  const scrollToNextVisibleWeek = useCallback(() => {
    scrollToAdjacentVisibleWeek(1);
  }, [scrollToAdjacentVisibleWeek]);

  const scheduleScrollKeyRef = useRef(scheduleScrollKey);
  scheduleScrollKeyRef.current = scheduleScrollKey;

  const saveScheduleScrollPosition = useCallback(() => {
    if (typeof window === 'undefined' || !scheduleScrollKeyRef.current) return;
    shockwaveScheduleScrollMemory.set(scheduleScrollKeyRef.current, {
      x: window.scrollX || window.pageXOffset || 0,
      y: window.scrollY || window.pageYOffset || 0,
    });
  }, []);

  useEffect(() => {
    window.addEventListener('clinic-before-route-change', saveScheduleScrollPosition);
    return () => {
      saveScheduleScrollPosition();
      window.removeEventListener('clinic-before-route-change', saveScheduleScrollPosition);
    };
  }, [saveScheduleScrollPosition]);

  const updateTodayShortcutTooltip = useCallback((event) => {
    const tooltipWidth = 96;
    const edgeGap = 8;
    const x = Math.min(
      Math.max(event.clientX, edgeGap + tooltipWidth / 2),
      window.innerWidth - edgeGap - tooltipWidth / 2
    );
    const y = Math.max(edgeGap, event.clientY - 38);
    setTodayShortcutTooltip({ x, y, text: `오늘 ${shortcutLabel}` });
  }, [shortcutLabel, setTodayShortcutTooltip]);

  useEffect(() => {
    const handleTodayShortcut = (event) => {
      if (shouldDeferShortcut?.(event)) return;
      const isOpenShortcut = isMetaEvent(event) && getScheduleShortcutKey(event) === 'T';
      if (!isOpenShortcut) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      if (!isCurrentScheduleMonth) {
        onNavigateToTodayMonth?.(today);
        return;
      }
      scrollToTodayWeek();
    };

    window.addEventListener('keydown', handleTodayShortcut, true);
    document.addEventListener('keydown', handleTodayShortcut, true);
    return () => {
      window.removeEventListener('keydown', handleTodayShortcut, true);
      document.removeEventListener('keydown', handleTodayShortcut, true);
    };
  }, [isCurrentScheduleMonth, onNavigateToTodayMonth, scrollToTodayWeek, today, shouldDeferShortcut]);

  useEffect(() => {
    const handleNextWeekShortcut = (event) => {
      if (shouldDeferShortcut?.(event)) return;
      if (event.__shockwaveNextWeekHandled) return;
      const shortcutKey = getScheduleShortcutKey(event);
      const isNextWeekShortcut = isMetaEvent(event) &&
        !event.altKey &&
        !event.shiftKey &&
        (shortcutKey === 'N' || shortcutKey === ' ');
      if (!isNextWeekShortcut) return;
      event.__shockwaveNextWeekHandled = true;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      scrollToNextVisibleWeek();
    };

    window.addEventListener('keydown', handleNextWeekShortcut, true);
    document.addEventListener('keydown', handleNextWeekShortcut, true);
    return () => {
      window.removeEventListener('keydown', handleNextWeekShortcut, true);
      document.removeEventListener('keydown', handleNextWeekShortcut, true);
    };
  }, [scrollToNextVisibleWeek, shouldDeferShortcut]);

  useEffect(() => {
    let wheelTargetWeekIdx = null;
    let targetResetTimer = null;
    const scheduleTargetReset = () => {
      if (targetResetTimer) window.clearTimeout(targetResetTimer);
      targetResetTimer = window.setTimeout(() => {
        wheelTargetWeekIdx = null;
        targetResetTimer = null;
      }, WEEK_WHEEL_TARGET_RESET_MS);
    };
    const handleWeekWheelShortcut = (event) => {
      const direction = getScheduleWheelWeekDirection(event);
      if (!direction) return;

      event.preventDefault();
      event.stopPropagation();
      const targetWeekIdx = scrollToAdjacentVisibleWeek(direction, wheelTargetWeekIdx);
      if (Number.isInteger(targetWeekIdx)) {
        wheelTargetWeekIdx = targetWeekIdx;
      }
      scheduleTargetReset();
    };

    window.addEventListener('wheel', handleWeekWheelShortcut, {
      capture: true,
      passive: false,
    });
    return () => {
      if (targetResetTimer) window.clearTimeout(targetResetTimer);
      window.removeEventListener('wheel', handleWeekWheelShortcut, true);
    };
  }, [scrollToAdjacentVisibleWeek]);

  const alignedScrollKeyRef = useRef('');

  useIsomorphicLayoutEffect(() => {
    if (!targetDate || !isInitialScrollReady || targetWeekIdx < 0) return undefined;

    const shouldScrollInstantly = alignedScrollKeyRef.current !== scheduleScrollKey;
    if (scrollToTargetDateWeek(shouldScrollInstantly)) {
      alignedScrollKeyRef.current = scheduleScrollKey;
      onTargetDateScrolled?.();
      return undefined;
    }

    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      return undefined;
    }

    let retryCount = 0;
    let rafId = null;
    const retryTargetScroll = () => {
      if (scrollToTargetDateWeek(shouldScrollInstantly)) {
        alignedScrollKeyRef.current = scheduleScrollKey;
        onTargetDateScrolled?.();
        return;
      }
      if (retryCount < 5) {
        retryCount += 1;
        rafId = window.requestAnimationFrame(retryTargetScroll);
      }
    };

    rafId = window.requestAnimationFrame(retryTargetScroll);
    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
    };
  }, [
    isInitialScrollReady,
    onTargetDateScrolled,
    scheduleScrollKey,
    scrollToTargetDateWeek,
    targetDate,
    targetWeekIdx,
  ]);

  useIsomorphicLayoutEffect(() => {
    const hasActiveTargetScroll = Boolean(targetDate && targetWeekIdx >= 0);
    if (hasActiveTargetScroll || alignedScrollKeyRef.current === scheduleScrollKey) return undefined;

    if (!isInitialScrollReady) {
      if (typeof window !== 'undefined' && !shockwaveScheduleScrollMemory.has(scheduleScrollKey)) {
        window.scrollTo({
          top: 0,
          left: window.scrollX || window.pageXOffset || 0,
          behavior: 'instant',
        });
      }
      return undefined;
    }

    const alignMonthScroll = () => {
      if (shouldAutoScrollToToday) {
        if (!scrollToTodayWeek(true)) return false;
        alignedScrollKeyRef.current = scheduleScrollKey;
        return true;
      }

      const savedPosition = shockwaveScheduleScrollMemory.get(scheduleScrollKey);
      if (savedPosition && typeof window !== 'undefined') {
        window.scrollTo({
          top: savedPosition.y || 0,
          left: savedPosition.x || 0,
          behavior: 'instant',
        });
        alignedScrollKeyRef.current = scheduleScrollKey;
        return true;
      }

      const firstWeekEl = weekRefs.current[0];
      if (!firstWeekEl || !scrollToWeek(firstWeekEl, 'instant')) return false;
      alignedScrollKeyRef.current = scheduleScrollKey;
      return true;
    };

    if (alignMonthScroll()) {
      return undefined;
    }

    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      return undefined;
    }

    let retryCount = 0;
    let rafId = null;
    const retryMonthScroll = () => {
      if (alignMonthScroll()) return;
      if (retryCount < 5) {
        retryCount += 1;
        rafId = window.requestAnimationFrame(retryMonthScroll);
      }
    };

    rafId = window.requestAnimationFrame(retryMonthScroll);
    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
    };
  }, [
    isInitialScrollReady,
    scheduleScrollKey,
    scrollToTodayWeek,
    scrollToWeek,
    shouldAutoScrollToToday,
    targetDate,
    targetWeekIdx,
    weekRefs,
  ]);

  return {
    todayWeekIdx,
    scrollToTargetDateWeek,
    scrollToTodayWeek,
    updateTodayShortcutTooltip,
  };
}
