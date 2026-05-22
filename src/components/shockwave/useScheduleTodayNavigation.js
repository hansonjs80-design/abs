import { useCallback, useEffect, useMemo, useRef } from 'react';
import { isSameDate } from '../../lib/calendarUtils';
import { shockwaveScheduleScrollMemory } from '../../lib/schedulerUtils';

const SCHEDULE_TODAY_SCROLL_TOP_OFFSET = 96;

export default function useScheduleTodayNavigation({
  weeks,
  today,
  weekRefs,
  scheduleScrollKey,
  currentYear,
  currentMonth,
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

  const scrollToTodayWeek = useCallback((instant = false) => {
    if (todayWeekIdx < 0) return;
    const weekEl = weekRefs.current[todayWeekIdx];
    if (!weekEl) return;
    const rect = weekEl.getBoundingClientRect();
    const targetTop = Math.max(0, rect.top + window.scrollY - SCHEDULE_TODAY_SCROLL_TOP_OFFSET);
    window.scrollTo({
      top: targetTop,
      left: window.scrollX || window.pageXOffset || 0,
      behavior: instant ? 'instant' : 'smooth',
    });
  }, [todayWeekIdx, weekRefs]);

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
      const key = String(event.key || '').toLowerCase();
      const isOpenShortcut = (event.metaKey || event.ctrlKey) && (
        event.code === 'KeyT' ||
        key === 't' ||
        key === 'ㅅ'
      );
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

  const initialScrollDoneRef = useRef(false);
  useEffect(() => {
    if (initialScrollDoneRef.current) return;
    const timer = setTimeout(() => {
      const savedPosition = shockwaveScheduleScrollMemory.get(scheduleScrollKey);
      if (savedPosition) {
        window.scrollTo(savedPosition.x || 0, savedPosition.y || 0);
        initialScrollDoneRef.current = true;
        return;
      }

      if (todayWeekIdx >= 0) {
        scrollToTodayWeek(true);
      } else {
        const firstWeekEl = weekRefs.current[0];
        if (firstWeekEl) {
          firstWeekEl.scrollIntoView({ behavior: 'instant', block: 'start', inline: 'nearest' });
        }
      }
      initialScrollDoneRef.current = true;
    }, 80);
    return () => clearTimeout(timer);
  }, [scheduleScrollKey, todayWeekIdx, scrollToTodayWeek, weekRefs]);

  useEffect(() => {
    if (!initialScrollDoneRef.current) return;
    const timer = setTimeout(() => {
      if (todayWeekIdx >= 0) {
        scrollToTodayWeek();
      } else {
        const firstWeekEl = weekRefs.current[0];
        if (firstWeekEl) {
          firstWeekEl.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
        }
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [currentYear, currentMonth, todayWeekIdx, scrollToTodayWeek, weekRefs]);

  return {
    todayWeekIdx,
    scrollToTodayWeek,
    updateTodayShortcutTooltip,
  };
}
