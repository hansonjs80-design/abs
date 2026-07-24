import { useCallback, useEffect, useMemo, useRef } from 'react';
import { isSameDate } from '../../lib/calendarUtils';
import { getScheduleShortcutKey, isMetaEvent } from '../../lib/scheduleKeyboardUtils';
import { getScheduleStickyTopOffset } from '../../lib/scheduleNavigationUtils';
import { shockwaveScheduleScrollMemory } from '../../lib/schedulerUtils';

const getWeekTop = (weekEl) => {
  if (!weekEl || typeof window === 'undefined') return 0;
  const rect = weekEl.getBoundingClientRect();
  return rect.top + (window.scrollY || window.pageYOffset || 0);
};

export default function useScheduleTodayNavigation({
  weeks,
  today,
  weekRefs,
  scheduleScrollKey,
  currentYear,
  currentMonth,
  isInitialScrollReady = true,
  shortcutLabel,
  setTodayShortcutTooltip,
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

  const scrollToNextVisibleWeek = useCallback(() => {
    if (!weeks.length || typeof window === 'undefined') return;
    const topOffset = getScheduleStickyTopOffset();
    const anchorY = (window.scrollY || window.pageYOffset || 0) + topOffset + 1;
    let currentWeekIdx = 0;
    weekRefs.current.forEach((weekEl, idx) => {
      if (!weekEl) return;
      if (getWeekTop(weekEl) <= anchorY) {
        currentWeekIdx = idx;
      }
    });
    const nextWeekIdx = currentWeekIdx + 1;
    if (nextWeekIdx >= weeks.length) return;
    const nextWeekEl = weekRefs.current[nextWeekIdx];
    scrollToWeek(nextWeekEl);
  }, [scrollToWeek, weekRefs, weeks.length]);

  const saveScheduleScrollPosition = useCallback(() => {
    if (typeof window === 'undefined') return;
    shockwaveScheduleScrollMemory.set(scheduleScrollKey, {
      x: window.scrollX || window.pageXOffset || 0,
      y: window.scrollY || window.pageYOffset || 0,
    });
  }, [scheduleScrollKey]);

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
      const isOpenShortcut = isMetaEvent(event) && getScheduleShortcutKey(event) === 'T';
      if (!isOpenShortcut) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      scrollToTodayWeek();
    };

    window.addEventListener('keydown', handleTodayShortcut, true);
    document.addEventListener('keydown', handleTodayShortcut, true);
    return () => {
      window.removeEventListener('keydown', handleTodayShortcut, true);
      document.removeEventListener('keydown', handleTodayShortcut, true);
    };
  }, [scrollToTodayWeek]);

  useEffect(() => {
    const handleNextWeekShortcut = (event) => {
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
  }, [scrollToNextVisibleWeek]);

  const initialScrollDoneRef = useRef(false);

  useEffect(() => {
    initialScrollDoneRef.current = false;
  }, [scheduleScrollKey]);

  useEffect(() => {
    if (initialScrollDoneRef.current || !isInitialScrollReady) return undefined;

    let retryCount = 0;
    let timer = null;
    const tryInitialScroll = () => {
      if (shouldAutoScrollToToday) {
        if (!scrollToTodayWeek(true) && retryCount < 5) {
          retryCount += 1;
          timer = setTimeout(tryInitialScroll, 80);
          return;
        }
      } else {
        const savedPosition = shockwaveScheduleScrollMemory.get(scheduleScrollKey);
        if (savedPosition) {
          window.scrollTo(savedPosition.x || 0, savedPosition.y || 0);
          initialScrollDoneRef.current = true;
          return;
        }

        const firstWeekEl = weekRefs.current[0];
        if (!firstWeekEl && retryCount < 5) {
          retryCount += 1;
          timer = setTimeout(tryInitialScroll, 80);
          return;
        }
        if (firstWeekEl) {
          scrollToWeek(firstWeekEl, 'instant');
        }
      }
      initialScrollDoneRef.current = true;
    };

    timer = setTimeout(tryInitialScroll, 80);
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [isInitialScrollReady, scheduleScrollKey, scrollToTodayWeek, scrollToWeek, shouldAutoScrollToToday, weekRefs]);

  useEffect(() => {
    if (!initialScrollDoneRef.current || !isInitialScrollReady) return;
    const timer = setTimeout(() => {
      if (shouldAutoScrollToToday) {
        scrollToTodayWeek();
      } else {
        const firstWeekEl = weekRefs.current[0];
        if (firstWeekEl) {
          scrollToWeek(firstWeekEl);
        }
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [currentYear, currentMonth, isInitialScrollReady, scrollToTodayWeek, scrollToWeek, shouldAutoScrollToToday, weekRefs]);

  return {
    todayWeekIdx,
    scrollToTodayWeek,
    updateTodayShortcutTooltip,
  };
}
