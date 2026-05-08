import { useCallback, useMemo } from 'react';

import { normalizeNameForMatch } from '../../lib/memoParser';
import {
  getEffectiveStaffScheduleBlockRules,
  normalizeStaffScheduleRuleText,
} from '../../lib/staffScheduleBlockRules';

export default function useStaffScheduleState({
  colCount,
  currentMonth,
  currentYear,
  effectiveDayOverrides,
  monthlyTherapists,
  settings,
  staffMemos,
  therapists,
}) {
  const getTherapistNameForDate = useCallback((slotIndex, day) => {
    if (!monthlyTherapists || monthlyTherapists.length === 0) {
      return therapists[slotIndex]?.name || '';
    }
    const match = monthlyTherapists.find(
      (therapist) => therapist.slot_index === slotIndex && day >= therapist.start_day && day <= therapist.end_day
    );
    if (match !== undefined) return match.therapist_name || '';
    return therapists[slotIndex]?.name || '';
  }, [monthlyTherapists, therapists]);

  const normalizeStaffBlockKeyword = useCallback((value) => normalizeStaffScheduleRuleText(value), []);
  const effectiveStaffBlockRules = useMemo(
    () => getEffectiveStaffScheduleBlockRules(settings, currentYear, currentMonth).rules,
    [settings, currentYear, currentMonth]
  );

  const therapistShiftByDate = useMemo(() => {
    const map = {};
    const blockRuleKeywords = (effectiveStaffBlockRules || [])
      .filter((rule) => rule?.enabled !== false && rule?.keyword)
      .map((rule) => normalizeStaffBlockKeyword(rule.keyword))
      .filter(Boolean);

    Object.values(staffMemos || {}).forEach((item) => {
      if (!item?.content) return;

      const dateKey = `${item.year}-${item.month}-${item.day}`;
      const text = String(item.content).trim();
      const compactText = normalizeStaffBlockKeyword(text);
      if (!compactText.includes('pt/')) return;
      if (blockRuleKeywords.some((keyword) => compactText.includes(keyword))) return;

      const isNightShift = compactText.includes('야간pt/') || compactText.startsWith('야pt/');
      const slashIndex = text.indexOf('/');
      if (slashIndex < 0) return;

      const names = text
        .slice(slashIndex + 1)
        .split(/[,，、\n]/)
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => part.split(/\s+/)[0])
        .map((part) => normalizeNameForMatch(part))
        .filter(Boolean);

      if (names.length === 0) return;
      if (!map[dateKey]) map[dateKey] = {};

      names.forEach((normalizedName) => {
        if (!map[dateKey][normalizedName]) {
          map[dateKey][normalizedName] = { hasPtShift: false, hasNightShift: false };
        }
        map[dateKey][normalizedName].hasPtShift = true;
        if (isNightShift) map[dateKey][normalizedName].hasNightShift = true;
      });
    });

    return map;
  }, [staffMemos, normalizeStaffBlockKeyword, effectiveStaffBlockRules]);

  const staffScheduleBlocksByDate = useMemo(() => {
    const map = {};
    const rules = (effectiveStaffBlockRules || []).filter((rule) => (
      rule?.enabled !== false && rule?.keyword && rule?.start_time && rule?.end_time
    ));
    if (rules.length === 0) return map;

    const getCurrentTherapistNames = (day) => (
      Array.from({ length: colCount }, (_, slotIndex) => (
        normalizeNameForMatch(getTherapistNameForDate(slotIndex, day))
      )).filter(Boolean)
    );

    const extractMentionedTherapistNames = (rawText, day) => {
      const normalizedText = normalizeNameForMatch(rawText);
      const currentNames = getCurrentTherapistNames(day);
      return currentNames.filter((normalizedName) => normalizedText.includes(normalizedName));
    };

    Object.values(staffMemos || {}).forEach((item) => {
      const text = String(item?.content || '').trim();
      if (!text) return;
      const slashIndex = text.indexOf('/');

      const day = Number(item.day);
      const currentTherapistNames = getCurrentTherapistNames(day);
      const prefix = slashIndex >= 0 ? text.slice(0, slashIndex).trim() : text;
      const normalizedPrefix = normalizeStaffBlockKeyword(prefix);
      const normalizedText = normalizeStaffBlockKeyword(text);
      const names = extractMentionedTherapistNames(
        slashIndex >= 0 ? text.slice(slashIndex + 1) : text,
        day
      );
      if (names.length === 0) return;

      const allMatchedRules = rules.filter((rule) => {
        const normalizedKeyword = normalizeStaffBlockKeyword(rule.keyword);
        return normalizedKeyword && (normalizedPrefix.includes(normalizedKeyword) || normalizedText.includes(normalizedKeyword));
      });
      const maxKeywordLength = allMatchedRules.reduce((max, rule) => (
        Math.max(max, normalizeStaffBlockKeyword(rule.keyword).length)
      ), 0);
      const matchedRules = allMatchedRules.filter((rule) => (
        normalizeStaffBlockKeyword(rule.keyword).length === maxKeywordLength
      ));
      if (matchedRules.length === 0) return;

      const dateKey = `${item.year}-${item.month}-${item.day}`;
      if (!map[dateKey]) map[dateKey] = {};
      matchedRules.forEach((rule) => {
        if (rule.invert_match === true) {
          currentTherapistNames
            .filter((normalizedName) => !names.includes(normalizedName))
            .forEach((normalizedName) => {
              if (!map[dateKey][normalizedName]) map[dateKey][normalizedName] = [];
              map[dateKey][normalizedName].push(rule);
            });
          return;
        }

        names.forEach((normalizedName) => {
          if (!map[dateKey][normalizedName]) map[dateKey][normalizedName] = [];
          map[dateKey][normalizedName].push(rule);
        });
      });
    });

    return map;
  }, [staffMemos, effectiveStaffBlockRules, normalizeStaffBlockKeyword, colCount, getTherapistNameForDate]);

  const getStaffScheduleBlockForCell = useCallback((dateKey, therapistName, slotTime) => {
    if (!dateKey || !therapistName || !slotTime) return null;
    const normalizedName = normalizeNameForMatch(therapistName);
    const rules = staffScheduleBlocksByDate?.[dateKey]?.[normalizedName] || [];
    return rules.find((rule) => slotTime >= rule.start_time && slotTime < rule.end_time) || null;
  }, [staffScheduleBlocksByDate]);

  const isLastHourSlot = useCallback((dayInfo, slotTime) => {
    if (!slotTime || !settings?.end_time) return false;

    const dateOverride = settings.date_overrides?.[dayInfo.dateStr] || null;
    const dayOverride = effectiveDayOverrides?.[dayInfo.dow] || {};
    const effectiveEnd = (dateOverride?.end_time || dayOverride.end_time || settings.end_time || '18:00:00').slice(0, 5);
    const [endHour, endMinute] = effectiveEnd.split(':').map(Number);
    const endTotal = endHour * 60 + endMinute;
    const [slotHour, slotMinute] = String(slotTime).split(':').map(Number);
    const slotTotal = slotHour * 60 + slotMinute;

    return slotTotal >= (endTotal - 60) && slotTotal < endTotal;
  }, [settings, effectiveDayOverrides]);

  const getTherapistWorkState = useCallback((dateKey, name) => {
    if (!name) return false;
    const normalizedName = normalizeNameForMatch(name);
    const dayMap = therapistShiftByDate[dateKey] || {};
    const shiftInfo = dayMap[normalizedName];
    const hasAnyNightShift = Object.values(dayMap).some((item) => item?.hasNightShift);

    if (shiftInfo?.hasNightShift) return 'night';
    if (shiftInfo?.hasPtShift) return 'off';
    if (hasAnyNightShift) return 'early-leave';
    return 'normal';
  }, [therapistShiftByDate]);

  return {
    getStaffScheduleBlockForCell,
    getTherapistNameForDate,
    getTherapistWorkState,
    isLastHourSlot,
  };
}
