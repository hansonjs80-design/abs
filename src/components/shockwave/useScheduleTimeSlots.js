import { useCallback, useMemo } from 'react';

import { generateShockwaveCalendar } from '../../lib/calendarUtils';
import { getReservationTimeFromMergeSpan } from '../../lib/schedulerUtils';

export default function useScheduleTimeSlots({
  currentMonth,
  currentYear,
  effectiveDayOverrides,
  holidays,
  settings,
}) {
  const baseTimeSlots = useMemo(() => {
    if (!settings || !settings.start_time || !settings.end_time || !settings.interval_minutes) {
      return Array.from({ length: 31 }, (_, index) => ({ label: `Row ${index}`, time: '' }));
    }
    const start = new Date(`2000-01-01T${settings.start_time}`);
    const end = new Date(`2000-01-01T${settings.end_time}`);
    const interval = settings.interval_minutes;
    const slots = [];
    let current = new Date(start);
    while (current < end) {
      const hh = String(current.getHours()).padStart(2, '0');
      const mm = String(current.getMinutes()).padStart(2, '0');
      slots.push({ label: `${hh}:${mm}`, time: `${hh}:${mm}` });
      current = new Date(current.getTime() + interval * 60000);
    }
    return slots;
  }, [settings]);

  const getTimeSlotsForDay = useCallback((dayInfo) => {
    const dow = dayInfo.dow;
    const dateStr = dayInfo.dateStr;
    const dateOverride = settings?.date_overrides?.[dateStr] || null;
    const dayOverride = effectiveDayOverrides?.[dow] || {};

    const dayStart = dateOverride?.start_time || dayOverride.start_time || (settings?.start_time?.substring(0, 5)) || '09:00';
    const dayEnd = dateOverride?.end_time || dayOverride.end_time || (settings?.end_time?.substring(0, 5)) || '18:00';

    const skipLunch = !dayInfo.isCurrentMonth || dayInfo.isHoliday;
    const noLunch = dateOverride?.no_lunch === true || dayOverride.no_lunch === true || skipLunch;

    const lunchStart = noLunch ? null : (dateOverride?.lunch_start || dayOverride.lunch_start || null);
    const lunchEnd = noLunch ? null : (dateOverride?.lunch_end || dayOverride.lunch_end || null);

    const result = [];

    baseTimeSlots.forEach((slot, index) => {
      const time = slot.time;
      let isBeforeStart = time < dayStart;
      let isAfterEnd = time >= dayEnd;

      if (skipLunch) {
        isBeforeStart = false;
        isAfterEnd = false;
      }

      const isLunch = lunchStart && lunchEnd && time >= lunchStart && time < lunchEnd;

      if (isLunch) {
        result.push({ ...slot, idx: index, disabled: true, isLunch: true });
      } else {
        result.push({ ...slot, idx: index, disabled: isBeforeStart || isAfterEnd, isLunch: false });
      }
    });
    return result;
  }, [baseTimeSlots, settings, effectiveDayOverrides]);

  const weeks = useMemo(() => {
    return generateShockwaveCalendar(currentYear, currentMonth, holidays);
  }, [currentYear, currentMonth, holidays]);

  const getDefaultReservationTime = useCallback((w, d, r) => {
    const dayInfo = weeks?.[w]?.days?.[d];
    const slot = dayInfo ? getTimeSlotsForDay(dayInfo).find((item) => item.idx === r) : null;
    const slotTime = slot?.time || slot?.label || baseTimeSlots?.[r]?.time || baseTimeSlots?.[r]?.label || '';
    if (slotTime) return slotTime;
    if (!settings?.start_time || !settings?.interval_minutes || !Number.isFinite(Number(r))) return '';
    const start = new Date(`2000-01-01T${settings.start_time}`);
    if (Number.isNaN(start.getTime())) return '';
    start.setMinutes(start.getMinutes() + (Number(r) * Number(settings.interval_minutes)));
    const hh = String(start.getHours()).padStart(2, '0');
    const mm = String(start.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }, [baseTimeSlots, getTimeSlotsForDay, settings, weeks]);

  const getReservationTimeForMemo = useCallback((memo, w, d, r) => (
    getReservationTimeFromMergeSpan(memo?.merge_span) || getDefaultReservationTime(w, d, r)
  ), [getDefaultReservationTime]);

  return {
    baseTimeSlots,
    getDefaultReservationTime,
    getReservationTimeForMemo,
    getTimeSlotsForDay,
    weeks,
  };
}
