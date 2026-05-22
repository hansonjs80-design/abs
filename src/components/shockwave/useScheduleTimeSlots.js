import { useCallback, useMemo } from 'react';

import { generateShockwaveCalendar } from '../../lib/calendarUtils';
import { getReservationTimeFromMergeSpan } from '../../lib/schedulerUtils';
import { getDateOverridesForMonth } from '../../lib/schedulerOperatingHours';

const DEFAULT_START_TIME = '09:00';
const DEFAULT_END_TIME = '18:00';

function normalizeTime(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return '';
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return '';
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return '';
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function timeToMinutes(value) {
  const normalized = normalizeTime(value);
  if (!normalized) return null;
  const [hour, minute] = normalized.split(':').map(Number);
  return hour * 60 + minute;
}

function minutesToTime(totalMinutes) {
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

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

    const startCandidates = [
      settings.start_time,
      ...Object.values(effectiveDayOverrides || {}).map((override) => override?.start_time),
      ...Object.values(getDateOverridesForMonth(settings.date_overrides, currentYear, currentMonth))
        .map((override) => override?.start_time),
    ].map(timeToMinutes).filter(Number.isFinite);

    const endCandidates = [
      settings.end_time,
      ...Object.values(effectiveDayOverrides || {}).map((override) => override?.end_time),
      ...Object.values(getDateOverridesForMonth(settings.date_overrides, currentYear, currentMonth))
        .map((override) => override?.end_time),
    ].map(timeToMinutes).filter(Number.isFinite);

    const startMinutes = startCandidates.length ? Math.min(...startCandidates) : timeToMinutes(DEFAULT_START_TIME);
    const endMinutes = endCandidates.length ? Math.max(...endCandidates) : timeToMinutes(DEFAULT_END_TIME);
    const interval = Number(settings.interval_minutes) || 30;
    if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes) || startMinutes >= endMinutes || interval <= 0) {
      return Array.from({ length: 31 }, (_, index) => ({ label: `Row ${index}`, time: '' }));
    }

    const slots = [];
    let current = startMinutes;
    while (current < endMinutes) {
      const time = minutesToTime(current);
      slots.push({ label: time, time });
      current += interval;
    }
    return slots;
  }, [settings, effectiveDayOverrides, currentYear, currentMonth]);

  const getTimeSlotsForDay = useCallback((dayInfo) => {
    const dow = dayInfo.dow;
    const dateStr = dayInfo.dateStr;
    const dateOverride = settings?.date_overrides?.[dateStr] || null;
    const dayOverride = effectiveDayOverrides?.[dow] || {};

    const dayStart = normalizeTime(dateOverride?.start_time || dayOverride.start_time || settings?.start_time) || DEFAULT_START_TIME;
    const dayEnd = normalizeTime(dateOverride?.end_time || dayOverride.end_time || settings?.end_time) || DEFAULT_END_TIME;

    const skipLunch = dayInfo.isHoliday;
    const noLunch = dateOverride?.no_lunch === true || dayOverride.no_lunch === true || skipLunch;

    const lunchStart = noLunch ? null : normalizeTime(dateOverride?.lunch_start || dayOverride.lunch_start);
    const lunchEnd = noLunch ? null : normalizeTime(dateOverride?.lunch_end || dayOverride.lunch_end);

    const result = [];

    baseTimeSlots.forEach((slot, index) => {
      const time = slot.time;
      let isBeforeStart = time < dayStart;
      let isAfterEnd = time >= dayEnd;

      if (dayInfo.isHoliday) {
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
