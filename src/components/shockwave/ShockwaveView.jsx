import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { flushSync } from 'react-dom';
import { useSchedule } from '../../contexts/ScheduleContext';

import { generateShockwaveCalendar, getTodayKST, isSameDate } from '../../lib/calendarUtils';
import { supabase } from '../../lib/supabaseClient';
import { incrementSessionCount, normalizeNameForMatch } from '../../lib/memoParser';
import { get4060PrescriptionFromContent, has4060Pattern, normalize4060StarOrder, strip4060FromContent } from '../../lib/schedulerContentFormat';
import { toProperCase } from '../../lib/shockwaveSyncUtils';
import { DAY_NAMES, getMonthlyDayOverrides } from '../../lib/schedulerOperatingHours';
import { getEffectiveSettlementSettings } from '../../lib/settlementSettings';
import { getEffectiveSchedulerTextSettings } from '../../lib/schedulerTextSettings';
import {
  getEffectiveStaffScheduleBlockRules,
  normalizeStaffScheduleRuleText,
} from '../../lib/staffScheduleBlockRules';
import { useToast } from '../common/Toast';
import MonthlyTherapistConfig from './MonthlyTherapistConfig';
import SchedulerPatientSelector from './SchedulerPatientSelector';
import {
  HORIZONTAL_BORDER_COLOR,
  TIME_COL_WIDTH,
  SHOCKWAVE_DAY_COL_WIDTH_KEY,
  SHOCKWAVE_COL_RATIOS_KEY,
  SHOCKWAVE_ROW_HEIGHT_KEY,
  SHOCKWAVE_PENDING_DRAFTS_KEY,
  SHOCKWAVE_MONTH_BACKUP_KEY,
  SHOCKWAVE_PENDING_DRAFT_MAX_AGE_MS,
  TREATMENT_COMPLETE_BG,
  TREATMENT_CANCEL_BG,
  SCHEDULER_HOLIDAY_BG,
  shockwaveScheduleScrollMemory,
  getShockwaveScheduleScrollKey,
  getPendingDraftId,
  readPendingScheduleDrafts,
  writePendingScheduleDrafts,
  rememberPendingScheduleDraft,
  removePendingScheduleDraft,
  readScheduleMonthBackups,
  writeScheduleMonthBackups,
  rememberScheduleMonthBackup,
  getManualDoseTag,
  buildManualNamePart,
  getSchedulerHistoryTypeLabel,
  splitBodyParts,
  normalizeBodyPartKey,
  formatBodyPartInput,
  normalizePrescriptionColorKey,
  getPrescriptionColor,
  filterPrescriptionColorMap,
  parseSchedulerPatientIdentity,
  getSchedulerVisitInputValue,
  getExplicitVisitSuffix,
  normalizeSchedulerVisitSuffix,
  normalizeVisitInputValue,
  applyVisitCountToSchedulerContent,
  stepVisitInputValue,
  getMemoListFromMergeSpan,
  normalizeReservationTimeValue,
  stepReservationTimeValue,
  timeValueToMinutes,
  minutesToTimeValue,
  stepReservationTimeWithinCellBase,
  getReservationTimeFromMergeSpan,
  buildMergeSpanWithReservationTime,
  stripReservationTimeFromMergeSpan,
  buildMergeSpanWithVisitCopyLink,
  clearVisitCopyLinkFromMergeSpan,
  isUndoShortcutEvent,
  buildMergeSpanWithMemoList,
  cloneMergeSpanWithMeta,
  buildSchedulerCellDisplay,
  buildSchedulerMemoSortKey,
  addBodyPartToMap,
} from '../../lib/schedulerUtils';

export default function ShockwaveView({ therapists, settings, memos = {}, onLoadMemos, onSaveMemo, holidays, staffMemos = {} }) {
  const { currentYear, currentMonth, navigateMonth, saveShockwaveMemosBulk, manualTherapists, monthlyTherapists, monthlyManualTherapists, loadMonthlyTherapists, saveMonthlyTherapists, saveTherapistRoster, loadShockwaveSettings, saveShockwaveSettings } = useSchedule();
  const { addToast } = useToast();
  const viewRef = useRef(null);
  const dragSelectionRef = useRef(null);
  const selectedCellRef = useRef(null);
  const [showTherapistConfig, setShowTherapistConfig] = useState(false);

  // ── 셀 조작 상태 (구글 시트 방식) ──
  const [selectedCell, setSelectedCell] = useState(null);     // { w, d, r, c }
  const [, setRangeEnd] = useState(null);                     // { w, d, r, c } (Shift 선택 끝점)
  const [selectedKeys, setSelectedKeys] = useState(() => new Set());
  const [editingCell, setEditingCell] = useState(null);       // "w-d-r-c" 키 문자열
  const [editValue, setEditValue] = useState('');
  const [pendingDisplayValues, setPendingDisplayValues] = useState({});
  const [loadedMemosKey, setLoadedMemosKey] = useState('');
  const clipboardRef = useRef({ content: '', mode: null });   // mode: 'copy' | 'cut'
  const [clipboardSource, setClipboardSource] = useState(null); // { keys: Set, mode: 'copy'|'cut' }
  const [, setUndoStack] = useState([]);
  const [contextMenu, setContextMenu] = useState(null); // { x, y, weekIdx, dayIdx, rowIdx, colIdx, currentPrescription }
  const [contextMenuBodyInput, setContextMenuBodyInput] = useState('');
  const [contextMenuNoteInput, setContextMenuNoteInput] = useState('');
  const [contextMenuMemoDrafts, setContextMenuMemoDrafts] = useState([]);
  const [contextMenuVisitInput, setContextMenuVisitInput] = useState('');
  const [contextMenuReservationInput, setContextMenuReservationInput] = useState('');

  // 환자 내역 검색 팝업 상태 (Cmd+F)
  const [patientHistoryModalOpen, setPatientHistoryModalOpen] = useState(false);
  const [patientHistoryModalData, setPatientHistoryModalData] = useState({ loading: false, logs: [], searchName: '', searchChart: '' });

  // Presence 기능 비활성화 – 실시간 데이터 동기화만 유지

  useEffect(() => {
    selectedCellRef.current = selectedCell;
  }, [selectedCell]);

  useEffect(() => {
    if (loadedMemosKey !== getShockwaveScheduleScrollKey(currentYear, currentMonth)) return;
    const mergedMemos = { ...(memos || {}) };
    Object.entries(pendingDisplayValues || {}).forEach(([key, value]) => {
      mergedMemos[key] = {
        ...(mergedMemos[key] || {}),
        content: value,
        updated_at: new Date().toISOString(),
      };
    });
    rememberScheduleMonthBackup(currentYear, currentMonth, mergedMemos);
  }, [currentYear, currentMonth, loadedMemosKey, memos, pendingDisplayValues]);

  // memos가 새 값을 반영하면 pendingDisplayValues에서 해당 키를 자동 정리
  useEffect(() => {
    setPendingDisplayValues((prev) => {
      const keys = Object.keys(prev);
      if (keys.length === 0) return prev;
      const keysToRemove = keys.filter((key) => {
        const pendingContent = prev[key];
        const memoContent = memos[key]?.content || '';
        // memos에 동일한 내용이 반영되었으면 pending 제거
        return memoContent === pendingContent;
      });
      if (keysToRemove.length === 0) return prev;
      const next = { ...prev };
      keysToRemove.forEach((key) => delete next[key]);
      return next;
    });
  }, [memos]);
  useEffect(() => {
    loadShockwaveSettings?.();
  }, [loadShockwaveSettings, currentYear, currentMonth]);

  useEffect(() => {
    const refreshSettingsOnFocus = () => {
      loadShockwaveSettings?.();
    };
    window.addEventListener('focus', refreshSettingsOnFocus);
    document.addEventListener('visibilitychange', refreshSettingsOnFocus);
    return () => {
      window.removeEventListener('focus', refreshSettingsOnFocus);
      document.removeEventListener('visibilitychange', refreshSettingsOnFocus);
    };
  }, [loadShockwaveSettings]);


  // 열 너비 조정 (fr 비율 기반)
  const [colRatios, setColRatios] = useState(() => {
    if (typeof window === 'undefined') return null;
    try {
      const parsed = JSON.parse(window.localStorage.getItem(SHOCKWAVE_COL_RATIOS_KEY) || 'null');
      return Array.isArray(parsed) && parsed.every((v) => Number.isFinite(v) && v > 0) ? parsed : null;
    } catch {
      return null;
    }
  });
  const colResizeRef = useRef({ active: false, colIdx: -1, startX: 0, startRatios: [], containerWidth: 0 });
  const [dayColWidth, setDayColWidth] = useState(() => {
    if (typeof window === 'undefined') return null;
    const saved = Number(window.localStorage.getItem(SHOCKWAVE_DAY_COL_WIDTH_KEY));
    return Number.isFinite(saved) && saved > 0 ? saved : null;
  }); // null = flex, number = px
  const dayResizeRef = useRef({ active: false, startX: 0, startWidth: 0, factor: 1 });
  const [rowHeight, setRowHeight] = useState(() => {
    if (typeof window === 'undefined') return 23;
    const saved = Number(window.localStorage.getItem(SHOCKWAVE_ROW_HEIGHT_KEY));
    return Number.isFinite(saved) && saved >= 18 ? saved : 23;
  });
  const rowResizeRef = useRef({ active: false, startY: 0, startHeight: 23 });

  const tooltipRef = useRef(null);
  const tooltipMousePosRef = useRef({ x: 0, y: 0 });
  const weekRefs = useRef([]);
  const [hoverData, setHoverData] = useState(null);
  const [todayShortcutTooltip, setTodayShortcutTooltip] = useState(null);
  const [chartSelector, setChartSelector] = useState(null);
  const [imePreviewCell, setImePreviewCell] = useState(null);
  const contextMenuRef = useRef(null);
  const editInputRef = useRef(null);
  const imeOpenRef = useRef(false);
  const skipNextEditBlurSaveRef = useRef(false);
  const handleCellSaveRef = useRef(null);
  const editDraftRef = useRef(null);
  const editAutosaveTimerRef = useRef(null);
  const saveMemoRef = useRef(onSaveMemo);
  const scheduleDateRef = useRef({ year: currentYear, month: currentMonth });
  const undoStackRef = useRef([]);
  const undoQueueRef = useRef(Promise.resolve());
  const scheduleScrollKey = useMemo(
    () => getShockwaveScheduleScrollKey(currentYear, currentMonth),
    [currentYear, currentMonth]
  );

  const monthlyTherapistSlotCount = useMemo(
    () => (monthlyTherapists || []).reduce((max, item) => Math.max(max, (Number(item?.slot_index) || 0) + 1), 0),
    [monthlyTherapists]
  );
  const colCount = Math.max(1, therapists.length, monthlyTherapistSlotCount);
  const effectiveDayOverrides = useMemo(
    () => getMonthlyDayOverrides(settings?.day_overrides, currentYear, currentMonth),
    [settings?.day_overrides, currentYear, currentMonth]
  );

  useEffect(() => {
    saveMemoRef.current = onSaveMemo;
    scheduleDateRef.current = { year: currentYear, month: currentMonth };
  }, [onSaveMemo, currentYear, currentMonth]);

  // 월별 치료사 설정 로드 (충격파 + 도수치료)
  useEffect(() => {
    loadMonthlyTherapists(currentYear, currentMonth, 'shockwave');
    loadMonthlyTherapists(currentYear, currentMonth, 'manual_therapy');
  }, [currentYear, currentMonth, loadMonthlyTherapists]);

  // 날짜(day)별 치료사 이름 조회
  const getTherapistNameForDate = useCallback((slotIndex, day) => {
    if (!monthlyTherapists || monthlyTherapists.length === 0) {
      return therapists[slotIndex]?.name || '';
    }
    const match = monthlyTherapists.find(
      (t) => t.slot_index === slotIndex && day >= t.start_day && day <= t.end_day
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

  // ── 시간 슬롯 생성 ──
  const baseTimeSlots = useMemo(() => {
    if (!settings || !settings.start_time || !settings.end_time || !settings.interval_minutes) {
      return Array.from({ length: 31 }, (_, i) => ({ label: `Row ${i}`, time: '' }));
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
    const dateOv = settings?.date_overrides?.[dateStr] || null;
    const dayOv = effectiveDayOverrides?.[dow] || {};
    
    const dayStart = dateOv?.start_time || dayOv.start_time || (settings?.start_time?.substring(0, 5)) || '09:00';
    const dayEnd = dateOv?.end_time || dayOv.end_time || (settings?.end_time?.substring(0, 5)) || '18:00';
    
    const skipLunch = !dayInfo.isCurrentMonth || dayInfo.isHoliday;
    const noLunch = dateOv?.no_lunch === true || dayOv.no_lunch === true || skipLunch;
    
    const lunchStart = noLunch ? null : (dateOv?.lunch_start || dayOv.lunch_start || null);
    const lunchEnd = noLunch ? null : (dateOv?.lunch_end || dayOv.lunch_end || null);

    const result = [];

    baseTimeSlots.forEach((slot, idx) => {
      const t = slot.time;
      let isBeforeStart = t < dayStart;
      let isAfterEnd = t >= dayEnd;
      
      if (skipLunch) { // 공휴일이거나 다른 달 날짜인 경우 요일별 운영 시간 제약을 무시
        isBeforeStart = false;
        isAfterEnd = false;
      }

      const isLunch = lunchStart && lunchEnd && t >= lunchStart && t < lunchEnd;

      if (isLunch) {
        result.push({ ...slot, idx, disabled: true, isLunch: true });
      } else {
        result.push({ ...slot, idx, disabled: isBeforeStart || isAfterEnd, isLunch: false });
      }
    });
    return result;
  }, [baseTimeSlots, settings, effectiveDayOverrides]);

  const today = getTodayKST();
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
  const todayWeekIdx = useMemo(() => {
    let idx = weeks.findIndex((weekDays) => weekDays.some((dayInfo) => isSameDate(dayInfo.date, today)));
    if (idx !== -1) return idx;

    // Fallback: 일요일은 달력에 없으므로, 해당 주차(월~일) 안에 오늘이 포함되는지 확인
    idx = weeks.findIndex(weekDays => {
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

  const shouldAutoFormatSchedulerName = useCallback((value) => {
    const text = String(value || '').trim();
    if (!text) return false;
    
    // 허용되는 특수 예약어는 제외
    if (/^(휴무|연차|반차|출근|퇴근|근무|야간|오전|오후)$/u.test(text)) return false;
    
    // 차트번호/이름 형식이면 허용
    const hasPatientPattern = /^\d+\/?.*?/.test(text) || text.includes('/');
    if (hasPatientPattern) return true;
    
    // 단순 이름에 ( ) 가 포함되어 있어도 허용
    if (/[()*]/.test(text)) return true;
    
    if (has4060Pattern(text)) return true;
    
    return true;
  }, []);

  const pickChartOption = useCallback((options, rawName) => {
    if (!Array.isArray(options) || options.length === 0) return Promise.resolve(null);
    const getOptionSortValue = (option) => {
      const dateValue = String(option?.lastDate || '');
      const visitValue = Number.parseInt(option?.nextVisit || '0', 10) || 0;
      return `${dateValue}-${String(visitValue).padStart(4, '0')}`;
    };
    const distinctCharts = new Set(options.map((option) => String(option.chartNumber || '').trim()).filter(Boolean));
    const distinctTreatmentTypes = new Set(
      options
        .map((option) => option.type)
        .filter((type) => type === 'shockwave' || type === 'manual')
    );
    const shouldShowSelector = distinctCharts.size > 1 || distinctTreatmentTypes.size > 1;
    if (!shouldShowSelector) return Promise.resolve(options[0]);

    const chartOptions = Array.from(
      options.reduce((map, option) => {
        const chartNumber = String(option.chartNumber || '').trim();
        const typeKey = option.type === 'manual' || option.type === 'shockwave' ? option.type : 'default';
        const optionKey = `${chartNumber}__${typeKey}`;
        const existing = map.get(optionKey);
        if (chartNumber && (!existing || getOptionSortValue(option) > getOptionSortValue(existing))) {
          map.set(optionKey, option);
        }
        return map;
      }, new Map()).values()
    ).sort((a, b) => getOptionSortValue(b).localeCompare(getOptionSortValue(a)));

    return new Promise((resolve) => {
      setChartSelector({ options: chartOptions, rawName, resolve });
    });
  }, []);

  const showAutoFillDialog = useCallback((dialogData) => {
    if (!dialogData) return Promise.resolve(null);
    const bodyPart =
      dialogData.initialBodyPart ||
      dialogData.latestBodyPart ||
      (Array.isArray(dialogData.bodyParts) ? dialogData.bodyParts[0] : '') ||
      '';

    return Promise.resolve({
      chartNumber: dialogData.chartNumber,
      namePart: dialogData.namePart,
      cleanName: dialogData.cleanName,
      visitCount: dialogData.visitCount,
      prescription: dialogData.prescription || '',
      bodyPart,
      memoList: Array.isArray(dialogData.initialMemoList) ? dialogData.initialMemoList : [],
      type: dialogData.type,
      doseTag: dialogData.doseTag,
    });
  }, []);

  const findLatestSchedulerMemoMeta = useCallback((targetCell, chartNumber, cleanName, options = {}) => {
    const normalizedName = normalizeNameForMatch(cleanName);
    const currentSortKey = buildSchedulerMemoSortKey(`${targetCell.w}-${targetCell.d}-${targetCell.r}-${targetCell.c}`, weeks);
    let latestMatch = null;

    Object.entries(memos || {}).forEach(([memoKey, memo]) => {
      if (!memo?.content) return;
      const parts = memoKey.split('-').map(Number);
      if (parts.length !== 4) return;
      const sortKey = buildSchedulerMemoSortKey(memoKey, weeks);
      if (!sortKey || sortKey >= currentSortKey) return;

      const parsed = parseSchedulerPatientIdentity(memo.content);
      const matchesChart = chartNumber && String(parsed.patientChart || '').trim() === String(chartNumber).trim();
      const matchesName = normalizedName && normalizeNameForMatch(parsed.patientName) === normalizedName;
      if (!matchesChart && !matchesName) return;
      if (options.exclude4060 && has4060Pattern(memo.content)) return;

      const memoList = getMemoListFromMergeSpan(memo.merge_span);
      if (memoList.length === 0) return;

      if (!latestMatch || sortKey > latestMatch.sortKey) {
        latestMatch = {
          sortKey,
          mergeSpan: stripReservationTimeFromMergeSpan(buildMergeSpanWithMemoList(memo.merge_span, memoList)),
        };
      }
    });

    return latestMatch?.mergeSpan;
  }, [memos, weeks]);

  const parseSchedulerPatientText = useCallback((text) => {
    const raw = String(text || '').trim();
    if (!raw.includes('/')) return null;

    // 차트번호/이름[40|60][(회차)|*] 패턴 매칭
    // 이름 뒤에 40 또는 60이 올 수 있고, 그 뒤에 (숫자) 또는 *가 올 수 있음
    const match = raw.match(/^([^/]+)\/(.+?(?:40|60)?)((\(-?\d*\))|\*)?$/);
    if (!match) return null;

    const chartNumber = String(match[1] || '').trim();
    const namePart = String(match[2] || '').trim();
    const suffixToken = match[3] || '';
    const suffixValue = suffixToken.replace(/[()]/g, '') || (suffixToken === '*' ? '*' : '');
    const cleanName = namePart.replace(/\(-\)/g, '').trim();
    const normalizedName = normalizeNameForMatch(cleanName);

    if (!chartNumber || !normalizedName) return null;

    return {
      chartNumber,
      rawName: namePart,
      cleanName,
      normalizedName,
      suffixToken,
      suffixValue,
    };
  }, []);

  const findSchedulerHistoryCandidates = useCallback((targetCell, rawInput, targetDate = '') => {
    const normalizedInput = normalizeNameForMatch(rawInput);
    const exactInput = String(rawInput || '').trim();
    const targetMemoKey = `${targetCell.w}-${targetCell.d}-${targetCell.r}-${targetCell.c}`;
    const currentSortKey = buildSchedulerMemoSortKey(targetMemoKey, weeks);
    const candidateMap = new Map();

    Object.entries(memos || {}).forEach(([memoKey, memo]) => {
      if (!memo?.content) return;
      if (memoKey === targetMemoKey) return;
      const sortKey = buildSchedulerMemoSortKey(memoKey, weeks);
      const sortDate = sortKey?.slice(0, 10) || '';
      if (!sortKey) return;
      if (targetDate) {
        if (sortDate > targetDate) return;
      } else if (currentSortKey && sortKey >= currentSortKey) {
        return;
      }

      const parsed = parseSchedulerPatientText(memo.content);
      if (!parsed?.chartNumber) return;

      const matchesChart = exactInput && parsed.chartNumber === exactInput;
      const matchesName = normalizedInput && parsed.normalizedName === normalizedInput;
      if (!matchesChart && !matchesName) return;

      const candidateKey = parsed.chartNumber;
      if (!candidateMap.has(candidateKey)) {
        candidateMap.set(candidateKey, {
          chartNumber: parsed.chartNumber,
          latestMemo: memo,
          latestParsed: parsed,
          latestSortKey: sortKey,
          bodyPartsMap: new Map(),
          prescriptions: new Set(),
        });
      }

      const candidate = candidateMap.get(candidateKey);
      if (sortKey > candidate.latestSortKey) {
        candidate.latestMemo = memo;
        candidate.latestParsed = parsed;
        candidate.latestSortKey = sortKey;
      }

      // 부위가 비어있지 않은 가장 최근 기록을 추적
      const memoBodyPart = String(memo.body_part || '').trim();
      if (memoBodyPart && (!candidate.latestNonEmptyBodyPartSortKey || sortKey > candidate.latestNonEmptyBodyPartSortKey)) {
        candidate.latestNonEmptyBodyPart = memoBodyPart;
        candidate.latestNonEmptyBodyPartSortKey = sortKey;
      }

      splitBodyParts(memo.body_part || '').forEach((part) => addBodyPartToMap(candidate.bodyPartsMap, part));
      if (memo.prescription) candidate.prescriptions.add(memo.prescription);
    });

    return Array.from(candidateMap.values())
      .map((candidate) => {
        const latestContent = String(candidate.latestMemo?.content || '').trim();
        const latestDate = candidate.latestSortKey.slice(0, 10);
        const shouldKeepVisitForSameDate = targetDate && latestDate === targetDate;
        const nextText = shouldKeepVisitForSameDate ? latestContent : (incrementSessionCount(latestContent) || latestContent);
        const incrementedParsed = parseSchedulerPatientText(nextText);
        const latestParsed = candidate.latestParsed;
        const latestMergeSpan = buildMergeSpanWithMemoList(
          candidate.latestMemo?.merge_span,
          getMemoListFromMergeSpan(candidate.latestMemo?.merge_span)
        );
        const lastVisit = parseInt(latestParsed?.suffixValue || '0', 10) || (latestParsed?.suffixToken === '*' ? 1 : 0);
        const nextVisit = shouldKeepVisitForSameDate
          ? (lastVisit > 0 ? lastVisit : 1)
          : (parseInt(incrementedParsed?.suffixValue || '0', 10) || (lastVisit > 0 ? lastVisit + 1 : 1));

          // 부위: 최신 메모에 값이 있으면 사용, 없으면 이전 기록에서 가져옴
          const effectiveLatestBodyPart = String(candidate.latestMemo?.body_part || '').trim()
            || candidate.latestNonEmptyBodyPart
            || '';

          return {
            chartNumber: candidate.chartNumber,
            namePart: incrementedParsed?.rawName || latestParsed?.rawName || '',
            cleanName: latestParsed?.cleanName || '',
            nextText,
            nextVisit,
            lastDate: latestDate,
            prescription: candidate.latestMemo?.prescription || '',
            prescriptions: Array.from(candidate.prescriptions),
            bodyParts: Array.from(candidate.bodyPartsMap.values()),
            latestBodyPart: effectiveLatestBodyPart,
            initialBodyParts: splitBodyParts(effectiveLatestBodyPart),
            type: 'scheduler',
            doseTag: '',
            optionLabel: candidate.latestMemo?.prescription || '최근 스케줄',
            mergeSpan: latestMergeSpan,
          };
      })
      .sort((a, b) => {
        if (a.lastDate !== b.lastDate) return b.lastDate.localeCompare(a.lastDate);
        return b.nextVisit - a.nextVisit;
      });
  }, [memos, parseSchedulerPatientText, weeks]);

  const buildSchedulerAutoText = useCallback(async (w, d, r, c, nextValue, forceOverrideSession = false, originalContent = undefined) => {
    const rawName = normalizeSchedulerVisitSuffix(nextValue);
    if (!shouldAutoFormatSchedulerName(rawName)) return { text: rawName };

    // 사용자가 명시적으로 40/60 패턴(도수치료)을 입력한 경우,
    // 자동 포맷팅(충격파 히스토리 기반 덮어쓰기)을 건너뛰고 사용자 입력을 그대로 보존
    // 동시에 40분/60분 처방을 자동으로 설정
    if (has4060Pattern(rawName)) {
      const normalizedManualText = normalize4060StarOrder(rawName);
      const autoDosePrescription = get4060PrescriptionFromContent(normalizedManualText) || undefined;
      return { text: normalizedManualText, prescription: autoDosePrescription };
    }

    let manualSession = null;
    const inputParenMatch = rawName.match(/\((\d+)\)$/);
    if (inputParenMatch) {
      manualSession = parseInt(inputParenMatch[1], 10);
    }
    const explicitVisitSuffix = getExplicitVisitSuffix(rawName);

    const dayInfo = weeks[w]?.[d];
    if (!dayInfo) return { text: rawName };
    const targetDate = `${dayInfo.year}-${String(dayInfo.month).padStart(2, '0')}-${String(dayInfo.day).padStart(2, '0')}`;
    const memoKey = `${w}-${d}-${r}-${c}`;
    const currentBodyParts = splitBodyParts(memos[memoKey]?.body_part || '');
    
    // editing 중인 경우 editValue(originalContent)를 참조하여 원본 텍스트 확인
    const previousContent = originalContent !== undefined ? String(originalContent).trim() : String(memos[memoKey]?.content || '').trim();
    const userRemovedDoseTag = has4060Pattern(previousContent) && !has4060Pattern(rawName);

    const schedulerOptions = findSchedulerHistoryCandidates({ w, d, r, c }, rawName, targetDate)
      .filter((option) => !userRemovedDoseTag || !has4060Pattern(option.nextText));
    if (schedulerOptions.length > 0) {
      const selected = schedulerOptions.length === 1
        ? schedulerOptions[0]
        : await pickChartOption(schedulerOptions, rawName);
      if (!selected) return { text: rawName };

      // 사용자가 명시적으로 40/60 패턴(도수치료)을 입력한 경우,
      // 스케줄러 히스토리의 충격파 형식을 무시하고 사용자 입력을 존중
      const inputHas4060 = has4060Pattern(rawName);
      if (inputHas4060 && !has4060Pattern(selected.nextText)) {
        // 사용자의 도수치료 형식을 유지하되, 히스토리에서 부위/메모 정보만 상속
        return {
          text: rawName,
          prescription: undefined,
          bodyPart: selected.latestBodyPart || undefined,
          mergeSpan: selected.mergeSpan,
        };
      }

      const autoPrescription = has4060Pattern(selected.nextText) ? undefined : (selected.prescription || undefined);

      return {
        text: explicitVisitSuffix ? rawName : selected.nextText,
        prescription: autoPrescription,
        bodyPart: selected.latestBodyPart || undefined,
        mergeSpan: selected.mergeSpan,
      };
    }

    const parsedIdentity = parseSchedulerPatientIdentity(rawName);
    const searchChart = parsedIdentity.patientChart ? String(parsedIdentity.patientChart).trim() : null;
    const searchName = normalizeNameForMatch(parsedIdentity.patientName) || normalizeNameForMatch(rawName);

    const [shockwaveRes, manualRes] = await Promise.all([
      supabase.from('shockwave_patient_logs')
        .select('patient_name, chart_number, visit_count, date, prescription, body_part')
        .lte('date', targetDate)
        .order('date', { ascending: false })
        .limit(200),
      supabase.from('manual_therapy_patient_logs')
        .select('patient_name, chart_number, visit_count, date, prescription, body_part')
        .lte('date', targetDate)
        .order('date', { ascending: false })
        .limit(200),
    ]);

    const allData = userRemovedDoseTag
      ? (shockwaveRes.data || []).map(d => ({ ...d, type: 'shockwave' }))
      : [
          ...(shockwaveRes.data || []).map(d => ({ ...d, type: 'shockwave' })),
          ...(manualRes.data || []).map(d => ({ ...d, type: 'manual' })),
        ];

    const matches = allData.filter((item) => {
      const matchChart = searchChart && String(item.chart_number || '').trim() === searchChart;
      const matchName = searchName && normalizeNameForMatch(item.patient_name) === searchName;
      if (searchChart) return matchChart;
      return matchName;
    });

    if (matches.length === 0) {
      return userRemovedDoseTag
        ? {
            text: rawName,
            prescription: '',
            bodyPart: '',
            mergeSpan: stripReservationTimeFromMergeSpan(buildMergeSpanWithMemoList(memos[memoKey]?.merge_span, [])),
          }
        : { text: rawName };
    }

    matches.sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return (parseInt(b.visit_count || '0', 10) || 0) - (parseInt(a.visit_count || '0', 10) || 0);
    });

    const candidateMap = new Map();
    matches.forEach((item) => {
      const chartNumber = String(item.chart_number || '').trim();
      if (!chartNumber) return;
      const doseTag = item.type === 'manual' ? getManualDoseTag(item.prescription) : '';
      const candidateKey = `${chartNumber}__${item.type}`;
      if (!candidateMap.has(candidateKey)) {
        candidateMap.set(candidateKey, {
          chartNumber,
          type: item.type,
          doseTag,
          latestItem: item,
          latestNonEmptyBodyPart: '',
          bodyPartsMap: new Map(),
          bodyPartVisitMap: new Map(),
          prescriptions: new Set(),
        });
      }
      const candidate = candidateMap.get(candidateKey);
      const itemVisit = parseInt(item.visit_count || '0', 10) || 0;
      const latestVisit = parseInt(candidate.latestItem?.visit_count || '0', 10) || 0;
      if (
        !candidate.latestItem ||
        item.date > candidate.latestItem.date ||
        (item.date === candidate.latestItem.date && itemVisit > latestVisit)
      ) {
        candidate.latestItem = item;
        candidate.doseTag = doseTag;
      }
      if (item.body_part) {
        splitBodyParts(item.body_part).forEach((part) => {
          addBodyPartToMap(candidate.bodyPartsMap, part);
          const normalizedPartKey = normalizeBodyPartKey(part);
          const itemVisit = parseInt(item.visit_count || '0', 10) || 0;
          let nextVisit = item.date === targetDate
            ? (itemVisit > 0 ? itemVisit : 1)
            : (itemVisit > 0 ? itemVisit + 1 : 1);
            
          if (!forceOverrideSession && manualSession !== null) {
            nextVisit = manualSession;
          }
          
          const existingVisitInfo = candidate.bodyPartVisitMap.get(normalizedPartKey);
          if (
            !existingVisitInfo ||
            item.date > existingVisitInfo.lastDate ||
            (item.date === existingVisitInfo.lastDate && itemVisit > existingVisitInfo.lastVisit)
          ) {
            candidate.bodyPartVisitMap.set(normalizedPartKey, {
              name: part,
              lastDate: item.date || '',
              lastVisit: itemVisit,
              nextVisit,
            });
          }
        });
      }
      // 부위가 비어있지 않은 가장 최근 기록 추적
      const itemBodyPart = String(item.body_part || '').trim();
      if (itemBodyPart && !candidate.latestNonEmptyBodyPart) {
        candidate.latestNonEmptyBodyPart = itemBodyPart;
      }
      if (item.prescription) {
        candidate.prescriptions.add(item.prescription);
      }
    });

    const options = Array.from(candidateMap.values()).map((candidate) => {
      const item = candidate.latestItem;
      const chartNumber = candidate.chartNumber;
      const lastVisit = parseInt(item.visit_count || '0', 10) || 0;
      let nextVisit = item.date === targetDate
        ? (lastVisit > 0 ? lastVisit : 1)
        : (lastVisit > 0 ? lastVisit + 1 : 1);
        
      if (!forceOverrideSession && manualSession !== null) {
        nextVisit = manualSession;
      }
      
      const cleanPatientName = String(item.patient_name).replace(/\*/g, '').trim();
      let namePart = item.type === 'manual'
        ? buildManualNamePart(cleanPatientName, item.prescription)
        : cleanPatientName;
      // 사용자가 명시적으로 40/60을 제거한 경우, namePart에서도 도수 태그를 제거
      if (userRemovedDoseTag) {
        namePart = strip4060FromContent(namePart);
      }
      // 부위: 최신 기록에 값이 있으면 사용, 없으면 이전 기록에서 가져옴
      const latestBodyPart = String(item.body_part || '').trim()
        || candidate.latestNonEmptyBodyPart
        || '';
      const prescriptions = Array.from(candidate.prescriptions);
      const bodyPartVisitMap = Object.fromEntries(candidate.bodyPartVisitMap.entries());
      const preferredBodyPart = currentBodyParts.find((part) => bodyPartVisitMap[normalizeBodyPartKey(part)]) || '';
      const preferredNextVisit = preferredBodyPart
        ? bodyPartVisitMap[normalizeBodyPartKey(preferredBodyPart)]?.nextVisit
        : null;

      return {
        chartNumber,
        namePart,
        cleanName: cleanPatientName,
        nextVisit,
        lastDate: item.date || '',
        prescription: item.prescription || '',
        prescriptions,
        bodyParts: Array.from(candidate.bodyPartsMap.values()),
        latestBodyPart,
        initialBodyParts: splitBodyParts(latestBodyPart),
        type: item.type,
        doseTag: candidate.doseTag,
        bodyPartVisitMap,
        preferredBodyPart,
        preferredNextVisit,
        optionLabel: getSchedulerHistoryTypeLabel({ type: item.type, doseTag: candidate.doseTag, prescription: item.prescription }),
      };
    });

    if (options.length === 0) return { text: rawName };

    let selected;
    if (options.length === 1) {
      selected = options[0];
    } else {
      // 동명이인 - 먼저 선택
      selected = await pickChartOption(options, rawName);
      if (!selected) return { text: rawName };
    }

    // 부위가 2개 이상이거나 처방이 변경된 이력이 있으면 다이얼로그로 선택
    const effectiveVisitCount = selected.preferredNextVisit || selected.nextVisit;
    const effectiveBodyPart = selected.preferredBodyPart || selected.latestBodyPart || undefined;
    
    let autoText = `${selected.chartNumber}/${selected.namePart}`;
    if (!selected.doseTag && !userRemovedDoseTag) {
      const inputDoseMatch = rawName.match(/(40|60)(?:\(\d+\))?$/);
      if (inputDoseMatch) {
        autoText += inputDoseMatch[1];
      }
    }
    autoText += explicitVisitSuffix || `(${effectiveVisitCount})`;
    autoText = normalize4060StarOrder(autoText);
    
    // 사용자가 도수 태그를 제거한 경우, 마지막 충격파 처방 내역으로 폴백
    const autoPrescription = userRemovedDoseTag
      ? (selected.prescription || '')
      : (has4060Pattern(autoText) ? undefined : (selected.prescription || undefined));
    const inheritedMergeSpan = findLatestSchedulerMemoMeta(
      { w, d, r, c },
      selected.chartNumber,
      selected.cleanName,
      { exclude4060: userRemovedDoseTag }
    );
    const needsDialog = (selected.bodyParts.length >= 2 && !selected.preferredBodyPart) || selected.prescriptions.length >= 2;
    if (needsDialog) {
      try {
        const dialogResult = await showAutoFillDialog({
          chartNumber: selected.chartNumber,
          namePart: selected.namePart,
          cleanName: selected.cleanName,
          visitCount: effectiveVisitCount,
          prescription: autoPrescription || '',
          bodyParts: selected.bodyParts,
          latestBodyPart: selected.latestBodyPart,
          initialBodyPart: selected.preferredBodyPart,
          bodyPartVisitMap: selected.bodyPartVisitMap,
          initialMemoList: getMemoListFromMergeSpan(inheritedMergeSpan),
          type: selected.type,
          doseTag: selected.doseTag,
          settings,
        });

        if (!dialogResult) return { text: rawName };

        return {
          text: normalizeSchedulerVisitSuffix(`${dialogResult.chartNumber}/${dialogResult.namePart}${explicitVisitSuffix || `(${dialogResult.visitCount})`}`),
          prescription: dialogResult.prescription,
          bodyPart: dialogResult.bodyPart,
          mergeSpan: buildMergeSpanWithMemoList(inheritedMergeSpan, dialogResult.memoList),
        };
      } catch (err) {
        console.error('autoFillDialog error:', err);
        // 에러 발생 시 기본 자동완성
      }
    }

    // 부위가 0~1개: 다이얼로그 없이 바로 자동완성
    return {
      text: autoText,
      prescription: autoPrescription,
      bodyPart: effectiveBodyPart,
      mergeSpan: inheritedMergeSpan,
    };
  }, [memos, pickChartOption, showAutoFillDialog, shouldAutoFormatSchedulerName, weeks, settings, findLatestSchedulerMemoMeta, findSchedulerHistoryCandidates]);

  useEffect(() => {
    let cancelled = false;
    setLoadedMemosKey('');
    setPendingDisplayValues({});
    Promise.resolve(onLoadMemos(currentYear, currentMonth)).finally(() => {
      if (!cancelled) {
        setLoadedMemosKey(getShockwaveScheduleScrollKey(currentYear, currentMonth));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [currentYear, currentMonth, onLoadMemos]);

  // ── 기존 40/60 셀에 누락된 처방 일괄 패치 ──
  const prescriptionPatchKeyRef = useRef(null);
  useEffect(() => {
    const monthKey = getShockwaveScheduleScrollKey(currentYear, currentMonth);
    if (loadedMemosKey !== monthKey) return;
    if (prescriptionPatchKeyRef.current === monthKey) return; // 이미 이번 달 패치 완료
    if (!memos || Object.keys(memos).length === 0) return;

    const fixEntries = [];
    Object.entries(memos).forEach(([key, memo]) => {
      const content = String(memo?.content || '').trim();
      if (!content) return;
      const existingPrescription = String(memo?.prescription || '').trim();
      if (existingPrescription) return;
      const autoPres = get4060PrescriptionFromContent(content);
      if (!autoPres) return;
      fixEntries.push({ key, prescription: autoPres });
    });

    prescriptionPatchKeyRef.current = monthKey; // 패치 시도 표시 (빈 배열이어도)

    if (fixEntries.length === 0) return;

    (async () => {
      const bulkUpdates = fixEntries.map(({ key, prescription }) => ({
        key,
        content: memos[key]?.content || '',
        bg_color: memos[key]?.bg_color || null,
        merge_span: memos[key]?.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null },
        prescription,
        body_part: memos[key]?.body_part || null,
      }));
      const ok = await saveShockwaveMemosBulk(currentYear, currentMonth, bulkUpdates);
      if (ok) {
        await onLoadMemos(currentYear, currentMonth);
      }
    })();
  }, [loadedMemosKey, currentYear, currentMonth, memos, saveShockwaveMemosBulk, onLoadMemos]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (loadedMemosKey !== getShockwaveScheduleScrollKey(currentYear, currentMonth)) return;
    const drafts = readPendingScheduleDrafts();
    const currentDrafts = Object.values(drafts).filter((draft) => (
      Number(draft?.year) === currentYear &&
      Number(draft?.month) === currentMonth &&
      draft?.key
    ));
    if (currentDrafts.length === 0) return;

    const nextPendingDisplay = {};
    const draftsToSave = [];

    currentDrafts.forEach((draft) => {
      const key = String(draft.key);
      const value = String(draft.value ?? '');
      const savedMemo = memos[key];
      const savedUpdatedAt = savedMemo?.updated_at ? Date.parse(savedMemo.updated_at) : 0;
      const draftUpdatedAt = Number(draft.updatedAt) || 0;

      if (savedMemo && savedUpdatedAt > draftUpdatedAt && String(savedMemo.content || '') !== value) {
        removePendingScheduleDraft(currentYear, currentMonth, key);
        return;
      }

      if (String(savedMemo?.content || '') === value) {
        removePendingScheduleDraft(currentYear, currentMonth, key);
        return;
      }

      nextPendingDisplay[key] = value;
      draftsToSave.push({ key, value });
    });

    if (Object.keys(nextPendingDisplay).length > 0) {
      setPendingDisplayValues((prev) => ({ ...prev, ...nextPendingDisplay }));
    }

    draftsToSave.forEach(({ key, value }) => {
      const [w, d, r, c] = key.split('-').map(Number);
      if (![w, d, r, c].every(Number.isFinite)) {
        removePendingScheduleDraft(currentYear, currentMonth, key);
        return;
      }

      Promise.resolve(onSaveMemo(currentYear, currentMonth, w, d, r, c, value))
        .then((success) => {
          if (success) {
            removePendingScheduleDraft(currentYear, currentMonth, key);
            setPendingDisplayValues((prev) => {
              if (!(key in prev)) return prev;
              const next = { ...prev };
              delete next[key];
              return next;
            });
          }
        })
        .catch((error) => {
          console.error('Failed to restore pending schedule draft:', error);
        });
    });
  }, [currentYear, currentMonth, loadedMemosKey, memos, onSaveMemo]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (loadedMemosKey !== getShockwaveScheduleScrollKey(currentYear, currentMonth)) return;

    const backup = readScheduleMonthBackups()[loadedMemosKey];
    const backupCells = backup?.cells && typeof backup.cells === 'object' ? backup.cells : null;
    if (!backupCells) return;

    const missingCells = Object.entries(backupCells).filter(([key, backupMemo]) => {
      const currentMemo = memos[key];
      const backupContent = String(backupMemo?.content || '').trim();
      if (!backupContent) return false;
      return !String(currentMemo?.content || '').trim();
    });

    if (missingCells.length === 0) return;

    const nextPendingDisplay = {};
    missingCells.forEach(([key, backupMemo]) => {
      nextPendingDisplay[key] = backupMemo.content || '';
    });
    setPendingDisplayValues((prev) => ({ ...prev, ...nextPendingDisplay }));

    missingCells.forEach(([key, backupMemo]) => {
      const [w, d, r, c] = key.split('-').map(Number);
      if (![w, d, r, c].every(Number.isFinite)) return;
      Promise.resolve(onSaveMemo(
        currentYear,
        currentMonth,
        w,
        d,
        r,
        c,
        backupMemo.content || '',
        backupMemo.bg_color,
        backupMemo.merge_span,
        backupMemo.prescription,
        backupMemo.body_part
      )).then((success) => {
        if (!success) return;
        setPendingDisplayValues((prev) => {
          if (!(key in prev)) return prev;
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }).catch((error) => {
        console.error('Failed to restore schedule month backup:', error);
      });
    });
  }, [currentYear, currentMonth, loadedMemosKey, memos, onSaveMemo]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (dayColWidth && dayColWidth > 0) window.localStorage.setItem(SHOCKWAVE_DAY_COL_WIDTH_KEY, String(dayColWidth));
    else window.localStorage.removeItem(SHOCKWAVE_DAY_COL_WIDTH_KEY);
  }, [dayColWidth]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(SHOCKWAVE_ROW_HEIGHT_KEY, String(rowHeight));
  }, [rowHeight]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (Array.isArray(colRatios) && colRatios.length > 0) {
      window.localStorage.setItem(SHOCKWAVE_COL_RATIOS_KEY, JSON.stringify(colRatios));
    } else {
      window.localStorage.removeItem(SHOCKWAVE_COL_RATIOS_KEY);
    }
  }, [colRatios]);

  const isEditableTarget = useCallback((target) => {
    return (
      (target instanceof HTMLInputElement && !target.dataset.hiddenInput) ||
      target instanceof HTMLTextAreaElement ||
      target?.isContentEditable
    );
  }, []);

  const isContextMenuTarget = useCallback((target) => {
    return Boolean(target && contextMenuRef.current?.contains(target));
  }, []);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (contextMenu && !isContextMenuTarget(e.target)) {
        setContextMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [contextMenu, isContextMenuTarget]);

  const recordUndo = useCallback((action) => {
    undoStackRef.current = [action, ...undoStackRef.current].slice(0, 50);
    setUndoStack(undoStackRef.current);
  }, []);

  const applyImmediateCellDisplay = useCallback((updates) => {
    const entries = Array.isArray(updates) ? updates : [updates];
    const nextValues = {};
    entries.forEach((item) => {
      if (!item) return;
      const key = item.key || `${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`;
      if (!key || key.includes('undefined')) return;
      nextValues[key] = String(item.content ?? '');
    });
    if (Object.keys(nextValues).length === 0) return;
    flushSync(() => {
      setPendingDisplayValues((prev) => ({ ...prev, ...nextValues }));
      setEditingCell(null);
      setContextMenu(null);
    });
  }, []);

  const clearImmediateCellDisplay = useCallback((updates) => {
    const entries = Array.isArray(updates) ? updates : [updates];
    const keys = entries
      .map((item) => item?.key || `${item?.week_index}-${item?.day_index}-${item?.row_index}-${item?.col_index}`)
      .filter((key) => key && !key.includes('undefined'));
    if (keys.length === 0) return;
    
    setTimeout(() => {
      setPendingDisplayValues((prev) => {
        let changed = false;
        const next = { ...prev };
        keys.forEach((key) => {
          if (key in next) {
            delete next[key];
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    }, 2000);
  }, []);

  const buildMemoSnapshotForKeys = useCallback((keys) => {
    return Array.from(new Set(keys || [])).map((key) => {
      const [w, d, r, c] = key.split('-').map(Number);
      const memo = memos[key] || {};
      const stableContent = key in pendingDisplayValues ? pendingDisplayValues[key] : memo.content;
      return {
        year: currentYear,
        month: currentMonth,
        week_index: w,
        day_index: d,
        row_index: r,
        col_index: c,
        content: stableContent || '',
        bg_color: memo.bg_color || null,
        merge_span: memo.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null },
        prescription: memo.prescription || null,
        body_part: memo.body_part || null,
      };
    });
  }, [currentYear, currentMonth, memos, pendingDisplayValues]);

  const doUndo = useCallback(() => {
    const [action, ...rest] = undoStackRef.current;
    if (!action) return false;
    undoStackRef.current = rest;
    flushSync(() => {
      setUndoStack(rest);
      setEditingCell(null);
      setContextMenu(null);
    });

    const undoPayload = action.type === 'bulk-edit'
      ? action.oldMemos
      : action.type === 'edit'
        ? [{
            year: action.year || currentYear,
            month: action.month || currentMonth,
            week_index: action.w,
            day_index: action.d,
            row_index: action.r,
            col_index: action.c,
            content: action.oldContent,
            bg_color: action.oldBg,
            merge_span: action.oldMergeSpan,
            prescription: action.oldPrescription,
            body_part: action.oldBodyPart,
          }]
        : [];
    applyImmediateCellDisplay(undoPayload);

    undoQueueRef.current = undoQueueRef.current.then(async () => {
      if (action.type === 'bulk-edit') {
        const success = await saveShockwaveMemosBulk(action.oldMemos);
        if (success) clearImmediateCellDisplay(action.oldMemos);
      } else if (action.type === 'edit') {
        const {
          year,
          month,
          w,
          d,
          r,
          c,
          oldContent,
          oldBg,
          oldMergeSpan,
          oldPrescription,
          oldBodyPart,
        } = action;
        const undoMemo = {
          week_index: w,
          day_index: d,
          row_index: r,
          col_index: c,
        };
        const success = await onSaveMemo(
          year || currentYear,
          month || currentMonth,
          w,
          d,
          r,
          c,
          oldContent,
          oldBg,
          oldMergeSpan,
          oldPrescription,
          oldBodyPart
        );
        if (success) clearImmediateCellDisplay(undoMemo);
      }
    }).catch((error) => {
      console.error('Undo failed:', error);
    });
    return true;
  }, [saveShockwaveMemosBulk, onSaveMemo, currentYear, currentMonth, applyImmediateCellDisplay, clearImmediateCellDisplay]);

  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      if (isUndoShortcutEvent(e)) {
        if (e.__shockwaveUndoHandled) return;
        e.__shockwaveUndoHandled = true;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();
        doUndo();
        return;
      } else if (e.key === 'Escape') {
        if (contextMenu) {
          setContextMenu(null);
        } else {
          setClipboardSource(null);
        }
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown, true);
    document.addEventListener('keydown', handleGlobalKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown, true);
      document.removeEventListener('keydown', handleGlobalKeyDown, true);
    };
  }, [doUndo, contextMenu]);

  useEffect(() => {
    if (!Array.isArray(colRatios) || colRatios.length === colCount) return;
    setColRatios(Array(colCount).fill(1));
  }, [colRatios, colCount]);

  // ── 셀 키 헬퍼 ──
  const cellKey = useCallback((w, d, r, c) => `${w}-${d}-${r}-${c}`, []);

  const computeSelectionInfo = useCallback(() => {
    if (!selectedCell || !selectedKeys || selectedKeys.size === 0) return null;
    const { w, d } = selectedCell;
    let minRow = Infinity;
    let maxRow = -Infinity;
    let minCol = Infinity;
    let maxCol = -Infinity;
    let hasValid = false;

    Array.from(selectedKeys).forEach((key) => {
      const [kw, kd, r, c] = key.split('-').map(Number);
      if (kw !== w || kd !== d) return;
      hasValid = true;
      minRow = Math.min(minRow, r);
      maxRow = Math.max(maxRow, r);
      minCol = Math.min(minCol, c);
      maxCol = Math.max(maxCol, c);

      const mergeSpan = memos[key]?.merge_span;
      if (mergeSpan?.mergedInto) {
        const masterKey = mergeSpan.mergedInto;
        const [mw, md, mr, mc] = masterKey.split('-').map(Number);
        if (mw !== w || md !== d) return;
        const masterSpan = memos[masterKey]?.merge_span || { rowSpan: 1, colSpan: 1 };
        minRow = Math.min(minRow, mr);
        minCol = Math.min(minCol, mc);
        maxRow = Math.max(maxRow, mr + masterSpan.rowSpan - 1);
        maxCol = Math.max(maxCol, mc + masterSpan.colSpan - 1);
      } else if (mergeSpan?.rowSpan > 1 || mergeSpan?.colSpan > 1) {
        maxRow = Math.max(maxRow, r + mergeSpan.rowSpan - 1);
        maxCol = Math.max(maxCol, c + mergeSpan.colSpan - 1);
      }
    });

    if (!hasValid || minRow === Infinity) return null;
    const boundedMinRow = minRow === Infinity ? selectedCell.r : minRow;
    const boundedMaxRow = maxRow === -Infinity ? selectedCell.r : maxRow;
    const boundedMinCol = minCol === Infinity ? selectedCell.c : minCol;
    const boundedMaxCol = maxCol === -Infinity ? selectedCell.c : maxCol;
    const masterKey = cellKey(w, d, boundedMinRow, boundedMinCol);
    const masterSpan = memos[masterKey]?.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null };
    const selectionRowSpan = boundedMaxRow - boundedMinRow + 1;
    const selectionColSpan = boundedMaxCol - boundedMinCol + 1;
    const isMergedMaster = masterSpan.mergedInto === null && (masterSpan.rowSpan > 1 || masterSpan.colSpan > 1);

    return {
      w,
      d,
      minRow: boundedMinRow,
      maxRow: boundedMaxRow,
      minCol: boundedMinCol,
      maxCol: boundedMaxCol,
      masterKey,
      masterSpan,
      selectionRowSpan,
      selectionColSpan,
      isMergedMaster,
      selectionMultiple: selectionRowSpan > 1 || selectionColSpan > 1,
    };
  }, [selectedCell, selectedKeys, memos, cellKey]);

  const getEffectiveMergeSpan = useCallback((key, currentMemos) => {
    const memosData = currentMemos || memos;
    const cellData = memosData[key];
    if (!cellData || !cellData.merge_span) return { rowSpan: 1, colSpan: 1, mergedInto: null };
    
    const mergeSpan = cellData.merge_span;
    if (!mergeSpan.mergedInto) return mergeSpan;
    
    const masterKey = mergeSpan.mergedInto;
    const masterData = memosData[masterKey];
    const masterSpan = masterData?.merge_span;
    
    if (!masterData || !masterSpan || masterSpan.rowSpan <= 1) {
      return { ...mergeSpan, mergedInto: null };
    }
    const [w, d, r, c] = key.split('-').map(Number);
    const [mw, md, mr, mc] = masterKey.split('-').map(Number);
    if (mw === w && md === d && mc === c) {
      const endRow = mr + (masterSpan.rowSpan || 1) - 1;
      if (r >= mr && r <= endRow) {
        return mergeSpan;
      }
    }
    return { ...mergeSpan, mergedInto: null };
  }, [memos]);

const normalizeCellToMergeMaster = useCallback((cell) => {
    if (!cell) return cell;
    const key = cellKey(cell.w, cell.d, cell.r, cell.c);
    const mergeSpan = getEffectiveMergeSpan(key);
    if (!mergeSpan.mergedInto) return cell;
    const [w, d, r, c] = mergeSpan.mergedInto.split('-').map(Number);
    return { w, d, r, c };
  }, [cellKey, getEffectiveMergeSpan]);

  
  const normalizeKeysToMergeMasters = useCallback((keys) => {
    const normalized = new Set();
    if (!keys) return normalized;

    Array.from(keys).forEach((key) => {
      const [w, d, r, c] = key.split('-').map(Number);
      const masterCell = normalizeCellToMergeMaster({w, d, r, c});
      normalized.add(cellKey(masterCell.w, masterCell.d, masterCell.r, masterCell.c));
    });

    return normalized;
  }, [normalizeCellToMergeMaster, cellKey]);

  const buildRangeKeys = useCallback((anchor, target) => {
    if (!anchor || !target) return new Set();
    if (anchor.w !== target.w || anchor.d !== target.d) {
      return new Set([cellKey(target.w, target.d, target.r, target.c)]);
    }

    const rMin = Math.min(anchor.r, target.r);
    const rMax = Math.max(anchor.r, target.r);
    const cMin = Math.min(anchor.c, target.c);
    const cMax = Math.max(anchor.c, target.c);
    const keys = new Set();
    for (let r = rMin; r <= rMax; r++) {
      for (let c = cMin; c <= cMax; c++) {
        keys.add(cellKey(anchor.w, anchor.d, r, c));
      }
    }
    return keys;
  }, [cellKey]);

  const scheduleEditDraftAutosave = useCallback((key, value) => {
    const { year, month } = scheduleDateRef.current;
    rememberPendingScheduleDraft(year, month, key, value ?? '');
    setPendingDisplayValues((prev) => ({ ...prev, [key]: value ?? '' }));
    editDraftRef.current = { key, value: value ?? '', dirty: true };
    // DB 저장은 handleCellSave(편집 완료 시)에서 처방 정보와 함께 수행.
    // 여기서 미리 저장하면 처방 없이 저장되어 노란색 '처방 없음'이 잠깐 보이는 문제 발생.
    if (editAutosaveTimerRef.current) {
      clearTimeout(editAutosaveTimerRef.current);
      editAutosaveTimerRef.current = null;
    }
  }, []);

  const flushEditDraft = useCallback(() => {
    if (editAutosaveTimerRef.current) {
      clearTimeout(editAutosaveTimerRef.current);
      editAutosaveTimerRef.current = null;
    }
    const draft = editDraftRef.current;
    if (!draft?.key || !draft.dirty) return;
    editDraftRef.current = null;
    const [w, d, r, c] = draft.key.split('-').map(Number);
    if (![w, d, r, c].every(Number.isFinite)) return;
    // handleCellSave를 통해 처방 조회 포함 저장
    Promise.resolve(handleCellSaveRef.current?.(w, d, r, c, draft.value ?? ''))
      .then(() => {})
      .catch((error) => {
        console.error('Failed to flush schedule draft:', error);
      });
  }, []);

  useEffect(() => {
    window.addEventListener('clinic-before-route-change', flushEditDraft);
    return () => window.removeEventListener('clinic-before-route-change', flushEditDraft);
  }, [flushEditDraft]);

  const selectSingleCell = useCallback((cell) => {
    const normalizedCell = normalizeCellToMergeMaster(cell);
    const key = cellKey(normalizedCell.w, normalizedCell.d, normalizedCell.r, normalizedCell.c);
    setSelectedCell(normalizedCell);
    setRangeEnd(null);
    setSelectedKeys(new Set([key]));
    viewRef.current?.focus({ preventScroll: true });
  }, [cellKey, normalizeCellToMergeMaster]);

  const updateDraggedSelection = useCallback((targetCell) => {
    const dragState = dragSelectionRef.current;
    if (!dragState) return;

    const nextKeys = buildRangeKeys(dragState.anchor, targetCell);
    setSelectedCell(dragState.anchor);
    setRangeEnd(targetCell);
    setSelectedKeys(nextKeys);
  }, [buildRangeKeys]);

  // ── 셀 클릭 = 선택 (편집 아님) ──
  const handleCellMouseDown = useCallback((w, d, r, c, e) => {
    const cell = normalizeCellToMergeMaster({ w, d, r, c });
    const key = cellKey(cell.w, cell.d, cell.r, cell.c);
    const isMeta = e?.metaKey || e?.ctrlKey;

    if (e?.button === 2) {
      dragSelectionRef.current = null;
      skipNextEditBlurSaveRef.current = true;
      window.setTimeout(() => {
        skipNextEditBlurSaveRef.current = false;
      }, 0);
      return;
    }
    if (e?.button !== 0) return;
    e.preventDefault();

    setContextMenu(null);

    if (editingCell) {
      const [editW, editD, editR, editC] = editingCell.split('-').map(Number);
      if ([editW, editD, editR, editC].every(Number.isFinite)) {
        const value = editInputRef.current?.value ?? editValue;
        skipNextEditBlurSaveRef.current = true;
        handleCellSaveRef.current?.(editW, editD, editR, editC, value);
        window.setTimeout(() => {
          skipNextEditBlurSaveRef.current = false;
        }, 0);
      }
    }

    viewRef.current?.focus({ preventScroll: true });

    if (isMeta) {
      setSelectedCell(cell);
      setRangeEnd(null);
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next.size ? next : new Set([key]);
      });
      dragSelectionRef.current = null;
    } else if (e?.shiftKey && selectedCell) {
      setSelectedCell(selectedCell);
      setRangeEnd(cell);
      setSelectedKeys(buildRangeKeys(selectedCell, cell));
      dragSelectionRef.current = { anchor: selectedCell };
    } else {
      selectSingleCell(cell);
      dragSelectionRef.current = { anchor: cell };
    }
    if (!editingCell) setEditingCell(null);
  }, [selectedCell, editingCell, editValue, buildRangeKeys, selectSingleCell, normalizeCellToMergeMaster, cellKey]);

  const handleCellMouseEnter = useCallback((w, d, r, c) => {
    if (!dragSelectionRef.current) return;
    updateDraggedSelection({ w, d, r, c });
  }, [updateDraggedSelection]);

  // ── 더블 클릭 = 편집 모드 진입 ──
  const handleCellDoubleClick = useCallback((w, d, r, c, content) => {
    selectSingleCell({ w, d, r, c });
    const key = cellKey(w, d, r, c);
    flushSync(() => {
      setEditingCell(key);
      setEditValue(content || '');
    });
    if (editInputRef.current) {
      editInputRef.current.value = content || '';
    }
  }, [selectSingleCell, cellKey]);

  // ── 편집 저장 ──
  const handleCellSave = useCallback(async (w, d, r, c, nextValue) => {
    const finalValue = nextValue !== undefined ? nextValue : (editInputRef.current?.value ?? editValue);
    const key = cellKey(w, d, r, c);
    if (editDraftRef.current?.key === key) {
      editDraftRef.current = null;
    }
    if (editAutosaveTimerRef.current) {
      clearTimeout(editAutosaveTimerRef.current);
      editAutosaveTimerRef.current = null;
    }
    const oldContent = memos[key]?.content || '';
    const immediateContent = String(finalValue ?? '').trim();
    setPendingDisplayValues((prev) => ({ ...prev, [key]: immediateContent }));
    setEditingCell(null);
    const result = await buildSchedulerAutoText(w, d, r, c, finalValue, false, editValue);
    const newContent = normalizeSchedulerVisitSuffix(
      normalize4060StarOrder(typeof result === 'string' ? result : (result?.text || ''))
    );
    let newPrescription = result?.prescription;
    const newBodyPart = result?.bodyPart;
    const newMergeSpan = result?.mergeSpan ? stripReservationTimeFromMergeSpan(result.mergeSpan) : undefined;

    // 이름에 40/60 패턴이 있으면 해당하는 40분/60분 처방을 자동 설정
    const autoDosePrescription = get4060PrescriptionFromContent(newContent);
    if (autoDosePrescription) {
      newPrescription = autoDosePrescription;
    } else if (!has4060Pattern(newContent) && /^(40|60)분$/.test(memos[key]?.prescription || '')) {
      // 이름에서 40/60이 없어졌는데 기존 처방이 40분/60분이면 처방 없음으로 변경
      newPrescription = '';
    }

    if (newContent !== immediateContent) {
      setPendingDisplayValues((prev) => ({ ...prev, [key]: newContent }));
    }

    const prescriptionChanged = (newPrescription !== undefined && newPrescription !== null && memos[key]?.prescription !== newPrescription);
    if (newContent === oldContent && !newPrescription && !newBodyPart && !prescriptionChanged) {
      setPendingDisplayValues((prev) => {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return;
    }
    setPendingDisplayValues((prev) => ({ ...prev, [key]: newContent }));
    rememberPendingScheduleDraft(currentYear, currentMonth, key, newContent);
    recordUndo({
      type: 'edit',
      year: currentYear,
      month: currentMonth,
      w,
      d,
      r,
      c,
      oldContent,
      oldBg: memos[key]?.bg_color,
      oldMergeSpan: memos[key]?.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null },
      oldPrescription: memos[key]?.prescription || null,
      oldBodyPart: memos[key]?.body_part || null,
    });
    const success = await onSaveMemo(currentYear, currentMonth, w, d, r, c, newContent, undefined, newMergeSpan, newPrescription, newBodyPart);
    if (success) removePendingScheduleDraft(currentYear, currentMonth, key);
    // pendingDisplayValues는 즉시 삭제하지 않음.
    // memos 컨텍스트가 새 값을 반영할 때까지 유지하여 깜빡임 방지.
    // 아래 useEffect(cleanupStalePendingValues)에서 memos 업데이트 후 자동 정리.
    if (!success) addToast('저장 실패', 'error');
  }, [editValue, currentYear, currentMonth, memos, onSaveMemo, addToast, buildSchedulerAutoText, recordUndo, cellKey]);

  handleCellSaveRef.current = handleCellSave;

  useEffect(() => {
    return () => {
      flushEditDraft();
    };
  }, [flushEditDraft]);

  // ── 셀 우클릭 = 처방 선택 ──
  const handleCellContextMenu = useCallback((e, w, d, r, c, currentPrescription, slotTime = '') => {
    e.preventDefault();
    e.stopPropagation();
    skipNextEditBlurSaveRef.current = true;
    setEditingCell(null);
    selectSingleCell({ w, d, r, c });
    const key = cellKey(w, d, r, c);
    setContextMenuBodyInput('');
    setContextMenuNoteInput('');
    setContextMenuMemoDrafts(getMemoListFromMergeSpan(memos[key]?.merge_span));
    setContextMenuVisitInput(getSchedulerVisitInputValue(memos[key]?.content || ''));
    const defaultReservationTime = slotTime || getDefaultReservationTime(w, d, r);
    const savedReservationTime = getReservationTimeFromMergeSpan(memos[key]?.merge_span);
    setContextMenuReservationInput(savedReservationTime || defaultReservationTime);
    const viewW = window.innerWidth;
    const isNearRightEdge = e.clientX + 180 + 300 > viewW;

    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      weekIdx: w,
      dayIdx: d,
      rowIdx: r,
      colIdx: c,
      currentPrescription,
      defaultReservationTime,
      savedReservationTime,
      isNearRightEdge
    });
    window.setTimeout(() => {
      skipNextEditBlurSaveRef.current = false;
    }, 0);
  }, [cellKey, getDefaultReservationTime, memos, selectSingleCell]);

  useEffect(() => {
    if (!contextMenu) {
      setContextMenuBodyInput('');
      setContextMenuNoteInput('');
      setContextMenuMemoDrafts([]);
      setContextMenuVisitInput('');
      setContextMenuReservationInput('');
    }
  }, [contextMenu]);

  useEffect(() => {
    if (!contextMenu) return;
    setContextMenuReservationInput(
      contextMenu.savedReservationTime || contextMenu.defaultReservationTime || getDefaultReservationTime(
        contextMenu.weekIdx,
        contextMenu.dayIdx,
        contextMenu.rowIdx
      )
    );
  }, [contextMenu?.weekIdx, contextMenu?.dayIdx, contextMenu?.rowIdx, contextMenu?.defaultReservationTime, contextMenu?.savedReservationTime, getDefaultReservationTime]);

  // ── 셀 삭제 ──
  const deleteCells = useCallback(async (keys) => {
    const affectedKeys = new Set();

    for (const key of keys || []) {
      const mergeSpan = memos[key]?.merge_span;
      const masterKey = mergeSpan?.mergedInto || key;
      const [w, d, r, c] = masterKey.split('-').map(Number);
      const masterSpan = memos[masterKey]?.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null };
      const rowSpan = Math.max(1, masterSpan.rowSpan || 1);
      const colSpan = Math.max(1, masterSpan.colSpan || 1);

      for (let row = r; row < r + rowSpan; row++) {
        for (let col = c; col < c + colSpan; col++) {
          affectedKeys.add(cellKey(w, d, row, col));
        }
      }
    }

    const oldMemos = [];
    const oldMemoKeys = new Set();
    const payloadByKey = new Map();
    const addOldMemo = (key, memoOverride = undefined) => {
      if (oldMemoKeys.has(key)) return;
      const [w, d, r, c] = key.split('-').map(Number);
      const memo = memoOverride !== undefined ? memoOverride : memos[key];
      const stableContent = key in pendingDisplayValues ? pendingDisplayValues[key] : memo?.content;
      oldMemoKeys.add(key);
      oldMemos.push({
        year: currentYear,
        month: currentMonth,
        week_index: w,
        day_index: d,
        row_index: r,
        col_index: c,
        content: stableContent || '',
        bg_color: memo?.bg_color || null,
        merge_span: memo?.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null },
        prescription: memo?.prescription || null,
        body_part: memo?.body_part || null,
      });
    };

    for (const key of affectedKeys) {
      const [w, d, r, c] = key.split('-').map(Number);
      addOldMemo(key);
      payloadByKey.set(key, {
        year: currentYear,
        month: currentMonth,
        week_index: w,
        day_index: d,
        row_index: r,
        col_index: c,
        content: '',
        bg_color: null,
        merge_span: { rowSpan: 1, colSpan: 1, mergedInto: null },
        prescription: null,
        body_part: null,
      });
    }

    Object.entries(memos || {}).forEach(([targetKey, targetMemo]) => {
      if (affectedKeys.has(targetKey)) return;
      const meta = targetMemo?.merge_span?.meta;
      const sourceKey = String(meta?.visit_copy_source_key || '').trim();
      if (!sourceKey || !affectedKeys.has(sourceKey)) return;

      const originalContent = String(meta?.visit_copy_original_content || '');
      const incrementedContent = String(meta?.visit_copy_incremented_content || '');
      const currentContent = String(targetMemo?.content || '');
      if (!originalContent || currentContent !== incrementedContent) return;

      const [w, d, r, c] = targetKey.split('-').map(Number);
      addOldMemo(targetKey, targetMemo);
      payloadByKey.set(targetKey, {
        year: currentYear,
        month: currentMonth,
        week_index: w,
        day_index: d,
        row_index: r,
        col_index: c,
        content: originalContent,
        bg_color: targetMemo?.bg_color || null,
        merge_span: clearVisitCopyLinkFromMergeSpan(targetMemo?.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null }),
        prescription: targetMemo?.prescription || null,
        body_part: targetMemo?.body_part || null,
      });
    });

    const payload = Array.from(payloadByKey.values());
    if (payload.length > 0) {
      recordUndo({ type: 'bulk-edit', oldMemos });
      applyImmediateCellDisplay(payload);
      const success = await saveShockwaveMemosBulk(payload);
      if (success) clearImmediateCellDisplay(payload);
      else {
        applyImmediateCellDisplay(oldMemos);
        addToast('삭제 실패', 'error');
      }
    }
  }, [currentYear, currentMonth, memos, pendingDisplayValues, saveShockwaveMemosBulk, recordUndo, cellKey, applyImmediateCellDisplay, clearImmediateCellDisplay, addToast]);

  const tryMergeSelection = useCallback(async () => {
    const selection = computeSelectionInfo();
    if (!selection) return;
    const { w, d, minRow, minCol, maxRow, maxCol, masterKey } = selection;
    const isAlreadyMerged = selection.isMergedMaster;
    const hasMultipleSelectedCells = (selectedKeys?.size || 0) > 1;
    if (!isAlreadyMerged && !selection.selectionMultiple && !hasMultipleSelectedCells) return;

    const oldMemos = [];
    const payload = [];
    const combinedContent = [];
    if (isAlreadyMerged) {
      for (let row = minRow; row <= maxRow; row++) {
        for (let col = minCol; col <= maxCol; col++) {
          const k = cellKey(w, d, row, col);
          const memo = memos[k];
          oldMemos.push({
            year: currentYear, month: currentMonth, week_index: w, day_index: d, row_index: row, col_index: col,
            content: memo?.content || '',
            bg_color: memo?.bg_color || null,
            merge_span: memo?.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null },
          });
          payload.push({
            year: currentYear, month: currentMonth, week_index: w, day_index: d, row_index: row, col_index: col,
            merge_span: { rowSpan: 1, colSpan: 1, mergedInto: null },
            content: memo?.content || ''
          });
        }
      }
    } else {
      for (let row = minRow; row <= maxRow; row++) {
        for (let col = minCol; col <= maxCol; col++) {
          const k = cellKey(w, d, row, col);
          const isMaster = (k === masterKey);
          const memo = memos[k];
          if (memo?.content) {
            combinedContent.push(memo.content);
          }
          oldMemos.push({
            year: currentYear, month: currentMonth, week_index: w, day_index: d, row_index: row, col_index: col,
            content: memo?.content || '',
            bg_color: memo?.bg_color || null,
            merge_span: memo?.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null },
          });
          payload.push({
            year: currentYear, month: currentMonth, week_index: w, day_index: d, row_index: row, col_index: col,
            merge_span: isMaster
              ? { rowSpan: maxRow - minRow + 1, colSpan: maxCol - minCol + 1, mergedInto: null }
              : { rowSpan: 1, colSpan: 1, mergedInto: masterKey },
            content: '' // will update master later
          });
        }
      }
      
      const mergedText = combinedContent.filter(Boolean).join('\n');
      payload.forEach(p => {
        if (!p.merge_span.mergedInto) {
          p.content = mergedText;
        }
      });
    }

    if (payload.length > 0) {
      recordUndo({ type: 'bulk-edit', oldMemos });
      await saveShockwaveMemosBulk(payload);
      addToast(isAlreadyMerged ? '병합이 해제되었습니다' : '셀이 병합되었습니다', 'info');
    }
    setContextMenu(null);
  }, [computeSelectionInfo, currentYear, currentMonth, memos, saveShockwaveMemosBulk, addToast, cellKey, recordUndo, selectedKeys]);

  const selectionInfo = computeSelectionInfo();
  const hasCompletableSelection = useMemo(() => {
    if (!selectedKeys || selectedKeys.size === 0) return false;
    const effectiveKeys = normalizeKeysToMergeMasters(selectedKeys);
    return Array.from(effectiveKeys).some((key) => String(memos[key]?.content || '').trim());
  }, [selectedKeys, memos, normalizeKeysToMergeMasters]);

  const hasCompletedSelection = useMemo(() => {
    if (!selectedKeys || selectedKeys.size === 0) return false;
    const effectiveKeys = normalizeKeysToMergeMasters(selectedKeys);
    return Array.from(effectiveKeys).some((key) => {
      const memo = memos[key];
      return String(memo?.content || '').trim() && memo?.bg_color === TREATMENT_COMPLETE_BG;
    });
  }, [selectedKeys, memos, normalizeKeysToMergeMasters]);

  const treatmentCompleteButtonLabel = hasCompletedSelection ? '방문취소' : '방문완료';
  const isAppleShortcutPlatform = useMemo(() => {
    if (typeof navigator === 'undefined') return false;
    return /Mac|iPhone|iPad|iPod/i.test(`${navigator.platform || ''} ${navigator.userAgent || ''}`);
  }, []);
  const shortcutLabels = useMemo(() => {
    const mod = isAppleShortcutPlatform ? '⌘' : 'Ctrl';
    const join = (...keys) => isAppleShortcutPlatform ? keys.join('') : keys.join('+');
    return {
      copy: join(mod, 'C'),
      cut: join(mod, 'X'),
      paste: join(mod, 'V'),
      merge: join(mod, 'E'),
      complete: join(mod, 'G'),
      cancel: join(mod, '-'),
      today: join(mod, 'O'),
    };
  }, [isAppleShortcutPlatform]);
  const effectivePrescriptionColors = useMemo(() => {
    const shockwaveSettlement = getEffectiveSettlementSettings(settings, currentYear, currentMonth, 'shockwave');
    const manualSettlement = getEffectiveSettlementSettings(settings, currentYear, currentMonth, 'manual_therapy');
    const monthlyEntries = settings?.monthly_settlement_settings && typeof settings.monthly_settlement_settings === 'object'
      ? settings.monthly_settlement_settings
      : {};
    const paddedMonthKey = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
    const legacyMonthKey = `${currentYear}-${currentMonth}`;
    const buildDirectMonthColors = (type) => {
      const legacyEntry = monthlyEntries[legacyMonthKey]?.[type] || {};
      const paddedEntry = monthlyEntries[paddedMonthKey]?.[type] || {};
      return {
        ...filterPrescriptionColorMap(legacyEntry.prescription_colors, legacyEntry.prescriptions),
        ...filterPrescriptionColorMap(paddedEntry.prescription_colors, paddedEntry.prescriptions),
      };
    };
    const colors = {
      ...(settings?.prescription_colors || {}),
      ...filterPrescriptionColorMap(shockwaveSettlement.prescription_colors, shockwaveSettlement.prescriptions),
      ...filterPrescriptionColorMap(manualSettlement.prescription_colors, manualSettlement.prescriptions),
      ...buildDirectMonthColors('shockwave'),
      ...buildDirectMonthColors('manual_therapy'),
    };
    return Object.entries(colors).reduce((acc, [key, value]) => {
      if (!key || !value) return acc;
      acc[key] = value;
      acc[normalizePrescriptionColorKey(key)] = value;
      return acc;
    }, {});
  }, [settings, currentYear, currentMonth]);
  const effectiveSchedulerTextSettings = useMemo(
    () => getEffectiveSchedulerTextSettings(settings, currentYear, currentMonth),
    [settings, currentYear, currentMonth]
  );

  const getAdjacentCell = useCallback((cell, direction) => {
    let { w, d, r, c } = cell;

    if (direction === 'ArrowLeft') {
      if (c > 0) return { w, d, r, c: c - 1 };
      if (d > 0) return { w, d: d - 1, r, c: colCount - 1 };
      if (w > 0) return { w: w - 1, d: weeks[w - 1].length - 1, r, c: colCount - 1 };
      return cell;
    }

    if (direction === 'ArrowRight') {
      if (c < colCount - 1) return { w, d, r, c: c + 1 };
      if (d < weeks[w].length - 1) return { w, d: d + 1, r, c: 0 };
      if (w < weeks.length - 1) return { w: w + 1, d: 0, r, c: 0 };
      return cell;
    }

    if (direction === 'ArrowUp') {
      if (r > 0) return { w, d, r: r - 1, c };
      if (w > 0) return { w: w - 1, d, r: baseTimeSlots.length - 1, c };
      return cell;
    }

    if (direction === 'ArrowDown') {
      if (r < baseTimeSlots.length - 1) return { w, d, r: r + 1, c };
      if (w < weeks.length - 1) return { w: w + 1, d, r: 0, c };
      return cell;
    }

    return cell;
  }, [baseTimeSlots.length, colCount, weeks]);

  const buildClipboardSelection = useCallback(() => {
    if (!selectedCell) return null;

    const range = selectionInfo || {
      w: selectedCell.w,
      d: selectedCell.d,
      minRow: selectedCell.r,
      maxRow: selectedCell.r,
      minCol: selectedCell.c,
      maxCol: selectedCell.c,
    };

    const rowCount = range.maxRow - range.minRow + 1;
    const colCountInRange = range.maxCol - range.minCol + 1;
    const cells = [];
    const plainRows = [];
    const sourceKeys = [];

    for (let rowOffset = 0; rowOffset < rowCount; rowOffset++) {
      const cellRow = [];
      const plainRow = [];
      for (let colOffset = 0; colOffset < colCountInRange; colOffset++) {
        const rowIndex = range.minRow + rowOffset;
        const colIndex = range.minCol + colOffset;
        const key = cellKey(range.w, range.d, rowIndex, colIndex);
        const memo = memos[key];
        cellRow.push({
          sourceKey: key,
          rowOffset,
          colOffset,
          content: memo?.content || '',
          bg_color: memo?.bg_color || null,
          merge_span: memo?.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null },
          prescription: memo?.prescription || '',
          body_part: memo?.body_part || '',
        });
        plainRow.push(memo?.content || '');
        sourceKeys.push(key);
      }
      cells.push(cellRow);
      plainRows.push(plainRow.join('\t'));
    }

    return {
      mode: 'copy',
      srcW: range.w,
      srcD: range.d,
      srcMinRow: range.minRow,
      srcMinCol: range.minCol,
      rowCount,
      colCount: colCountInRange,
      cells,
      sourceKeys,
      plainText: plainRows.join('\n'),
    };
  }, [selectedCell, selectionInfo, memos, cellKey]);

  const parsePlainTextClipboard = useCallback((plainText, htmlText = null) => {
    if (typeof plainText !== 'string') return null;
    const normalized = plainText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (!normalized.length) return null;

    const rawRows = normalized.split('\n');
    while (rawRows.length > 1 && rawRows[rawRows.length - 1] === '') {
      rawRows.pop();
    }

    const cells = rawRows.map((rowText, rowOffset) =>
      rowText.split('\t').map((content, colOffset) => ({
        rowOffset,
        colOffset,
        content,
        bg_color: null,
        merge_span: { rowSpan: 1, colSpan: 1, mergedInto: null },
        prescription: '',
      }))
    );

    if (htmlText) {
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlText, 'text/html');
        // Parse <style> blocks for class-based backgrounds (common in Google Sheets)
        const styleText = Array.from(doc.querySelectorAll('style')).map(s => s.textContent).join('\n');
        const classColors = {};
        if (styleText) {
          const styleRegex = /\.([\w-]+)[^{]*\{([^}]+)\}/g;
          let match;
          while ((match = styleRegex.exec(styleText)) !== null) {
            const className = match[1];
            const rules = match[2].toLowerCase();
            const bgMatch = rules.match(/background(?:-color)?\s*:\s*([^;!}]+)/);
            if (bgMatch) {
              let parsedColor = bgMatch[1].trim().split(' ')[0];
              if (parsedColor && parsedColor !== 'none' && parsedColor !== 'transparent' && parsedColor !== 'windowtext') {
                classColors[className] = parsedColor;
              }
            }
          }
        }

        // Find the most likely data table (usually the one with the most rows or just the first)
        const tables = Array.from(doc.querySelectorAll('table'));
        let targetTable = tables.length > 0 ? tables[0] : null;
        
        // If no table found, fallback to body
        const root = targetTable || doc.body;
        const rows = Array.from(root.querySelectorAll('tr'));
        
        // We need to map the parsed rows to our `cells` array. 
        // We'll skip empty rows at the beginning if there's a mismatch.
        let cellRowIdx = 0;
        
        for (let i = 0; i < rows.length; i++) {
          if (cellRowIdx >= cells.length) break;
          const tr = rows[i];
          const tds = Array.from(tr.querySelectorAll('td, th'));
          
          // Only process rows that have actual cells
          if (tds.length === 0) continue;
          
          for (let j = 0; j < tds.length; j++) {
            if (j >= cells[cellRowIdx].length) break;
            const td = tds[j];
            
            let bgColor = td.style.backgroundColor || td.getAttribute('bgcolor');
            
            // Check for background shorthand in inline style
            if (!bgColor && td.hasAttribute('style')) {
              const styleStr = td.getAttribute('style').toLowerCase();
              const bgMatch = styleStr.match(/background(?:-color)?\s*:\s*([^;]+)/);
              if (bgMatch) {
                bgColor = bgMatch[1].trim().split(' ')[0];
              }
            }

            // Check class-based styling
            if (!bgColor && td.classList.length > 0) {
              for (const cls of Array.from(td.classList)) {
                if (classColors[cls]) {
                  bgColor = classColors[cls];
                  break;
                }
              }
            }
            
            if (bgColor && bgColor !== 'transparent' && bgColor !== 'none' && bgColor !== 'windowtext') {
              cells[cellRowIdx][j].bg_color = bgColor;
            }
          }
          cellRowIdx++;
        }
      } catch (e) {
        console.error("Failed to parse HTML from clipboard", e);
      }
    }

    const rowCount = cells.length;
    const pastedColCount = cells.reduce((max, row) => Math.max(max, row.length), 0);
    if (!rowCount || !pastedColCount) return null;

    return {
      mode: 'copy',
      srcW: selectedCell?.w ?? 0,
      srcD: selectedCell?.d ?? 0,
      srcMinRow: 0,
      srcMinCol: 0,
      rowCount,
      colCount: pastedColCount,
      cells,
      sourceKeys: [],
      plainText: normalized,
    };
  }, [selectedCell]);

  const buildPastePayload = useCallback((clip, target) => {
    if (!clip?.cells?.length) return [];
    const payload = [];
    const isCrossDate = clip.srcW !== target.w || clip.srcD !== target.d;
    const sourceMasterToTargetMaster = new Map();

    for (const row of clip.cells) {
      for (const cell of row) {
        const targetRow = target.r + cell.rowOffset;
        const targetCol = target.c + cell.colOffset;
        if (targetRow >= baseTimeSlots.length || targetCol >= colCount) continue;

        const originalContent = cell.content || '';
        let nextContent = originalContent;
        let visitCopyLink = null;
        if (clip.mode === 'copy' && isCrossDate && nextContent) {
          nextContent = incrementSessionCount(nextContent);
          if (nextContent !== originalContent) {
            visitCopyLink = {
              sourceKey: cell.sourceKey || cellKey(
                clip.srcW,
                clip.srcD,
                clip.srcMinRow + cell.rowOffset,
                clip.srcMinCol + cell.colOffset
              ),
              originalContent,
              incrementedContent: nextContent,
            };
          }
        }

        let nextMergeSpan = { rowSpan: 1, colSpan: 1, mergedInto: null };
        const mergeSpan = cell.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null };
        const sourceCellKey = cellKey(
          clip.srcW,
          clip.srcD,
          clip.srcMinRow + cell.rowOffset,
          clip.srcMinCol + cell.colOffset
        );

        if (mergeSpan?.mergedInto) {
          let mappedMasterKey = sourceMasterToTargetMaster.get(mergeSpan.mergedInto);
          if (!mappedMasterKey) {
            const [, , sourceMasterRow, sourceMasterCol] = mergeSpan.mergedInto.split('-').map(Number);
            const masterRowOffset = sourceMasterRow - clip.srcMinRow;
            const masterColOffset = sourceMasterCol - clip.srcMinCol;
            mappedMasterKey = cellKey(
              target.w,
              target.d,
              target.r + masterRowOffset,
              target.c + masterColOffset
            );
            sourceMasterToTargetMaster.set(mergeSpan.mergedInto, mappedMasterKey);
          }
          nextMergeSpan = cloneMergeSpanWithMeta(mergeSpan, { rowSpan: 1, colSpan: 1, mergedInto: mappedMasterKey });
        } else if (mergeSpan?.rowSpan > 1 || mergeSpan?.colSpan > 1) {
          const mappedMasterKey = cellKey(target.w, target.d, targetRow, targetCol);
          sourceMasterToTargetMaster.set(sourceCellKey, mappedMasterKey);
          nextMergeSpan = cloneMergeSpanWithMeta(mergeSpan, {
            rowSpan: mergeSpan.rowSpan || 1,
            colSpan: mergeSpan.colSpan || 1,
            mergedInto: null,
          });
        } else if (mergeSpan?.meta) {
          nextMergeSpan = cloneMergeSpanWithMeta(mergeSpan, { rowSpan: 1, colSpan: 1, mergedInto: null });
        }
        nextMergeSpan = stripReservationTimeFromMergeSpan(nextMergeSpan);
        nextMergeSpan = visitCopyLink
          ? buildMergeSpanWithVisitCopyLink(nextMergeSpan, visitCopyLink)
          : clearVisitCopyLinkFromMergeSpan(nextMergeSpan);

        payload.push({
          year: currentYear,
          month: currentMonth,
          week_index: target.w,
          day_index: target.d,
          row_index: targetRow,
          col_index: targetCol,
          content: nextContent,
          bg_color: isCrossDate ? null : (cell.bg_color || null),
          merge_span: nextMergeSpan,
          prescription: cell.prescription || '',
          body_part: cell.body_part || '',
        });
      }
    }

    return payload;
  }, [baseTimeSlots.length, colCount, currentYear, currentMonth, cellKey]);

  const handleCopySelection = useCallback(() => {
    const clip = buildClipboardSelection();
    if (!clip) return;
    clipboardRef.current = { ...clip, mode: 'copy' };
    setClipboardSource({ keys: new Set(clip.sourceKeys), mode: 'copy' });
    navigator.clipboard.writeText(clip.plainText).catch(() => {
      console.debug('Clipboard sync failed during copy.');
    });
    addToast('복사됨', 'info');
    setContextMenu(null);
  }, [buildClipboardSelection, addToast]);

  const handleCutSelection = useCallback(async () => {
    const clip = buildClipboardSelection();
    if (!clip) return;
    clipboardRef.current = { ...clip, mode: 'cut' };
    setClipboardSource({ keys: new Set(clip.sourceKeys), mode: 'cut' });
    navigator.clipboard.writeText(clip.plainText).catch(() => {
      console.debug('Clipboard sync failed during cut.');
    });
    addToast('잘라내기됨 (붙여넣기 시 원본 삭제)', 'info');
    setContextMenu(null);
  }, [buildClipboardSelection, addToast]);

  const handlePasteSelection = useCallback(async (forcedPlainText = null, forcedHtmlText = null, explicitTargetCell = null) => {
    const targetCell = explicitTargetCell || selectedCellRef.current || selectedCell;
    if (!targetCell) return;
    let clip = clipboardRef.current;
    const currentClipboardSource = clipboardSource;

    if (typeof forcedPlainText === 'string') {
      const externalClip = parsePlainTextClipboard(forcedPlainText, forcedHtmlText);
      const internalPlainText = clipboardRef.current?.plainText || '';
      const normalizedForced = forcedPlainText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const normalizedInternal = internalPlainText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      if (externalClip?.cells?.length && normalizedForced !== normalizedInternal) {
        clip = externalClip;
      }
    } else if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
      try {
        const clipboardText = await navigator.clipboard.readText();
        if (clipboardText) {
          const externalClip = parsePlainTextClipboard(clipboardText);
          const internalPlainText = clipboardRef.current?.plainText || '';
          const normalizedForced = clipboardText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
          const normalizedInternal = internalPlainText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
          if (externalClip?.cells?.length && normalizedForced !== normalizedInternal) {
            clip = externalClip;
          }
        }
      } catch (error) {
        console.debug('Clipboard read failed during paste.', error);
      }
    }

    if (!clip?.cells?.length) {
      setContextMenu(null);
      return;
    }

    if (currentClipboardSource) {
      setClipboardSource(null);
    }

    // Record undo status for target area before paste
    const oldMemos = [];
    const targetRowCount = clip.rowCount;
    const targetColCountInRange = clip.colCount;
    for (let ro = 0; ro < targetRowCount; ro++) {
      for (let co = 0; co < targetColCountInRange; co++) {
        const tr = targetCell.r + ro;
        const tc = targetCell.c + co;
        if (tr >= baseTimeSlots.length || tc >= colCount) continue;
        const k = cellKey(targetCell.w, targetCell.d, tr, tc);
        const m = memos[k];
        oldMemos.push({
          year: currentYear, month: currentMonth,
          week_index: targetCell.w, day_index: targetCell.d,
          row_index: tr, col_index: tc,
          content: m?.content || '', bg_color: m?.bg_color || null,
          merge_span: m?.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null },
          prescription: m?.prescription || ''
        });
      }
    }

    const targetPayload = buildPastePayload(clip, targetCell);
    if (targetPayload.length === 0) {
      setContextMenu(null);
      return;
    }

    const enhancedPayload = await Promise.all(targetPayload.map(async (item) => {
      // 외부 붙여넣기 등에서 처방/부위 정보가 없는 텍스트만 들어온 경우 자동 조회
      if (item.content && !item.prescription && !item.body_part) {
        const result = await buildSchedulerAutoText(item.week_index, item.day_index, item.row_index, item.col_index, item.content, true);
        return {
          ...item,
          content: result.text || item.content,
          prescription: result.prescription || item.prescription,
          body_part: result.bodyPart || item.body_part,
          merge_span: stripReservationTimeFromMergeSpan(result.mergeSpan || item.merge_span)
        };
      }
      return item;
    }));

    const combinedPayload = new Map();

    if (clip.mode === 'cut' && currentClipboardSource?.keys) {
      Array.from(currentClipboardSource.keys).forEach((k) => {
        const [w, d, r, c] = k.split('-').map(Number);
        const m = memos[k];
        oldMemos.push({
          year: currentYear, month: currentMonth,
          week_index: w, day_index: d,
          row_index: r, col_index: c,
          content: m?.content || '', bg_color: m?.bg_color || null,
          merge_span: m?.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null },
          prescription: m?.prescription || ''
        });
        combinedPayload.set(`${w}-${d}-${r}-${c}`, {
          year: currentYear, month: currentMonth,
          week_index: w, day_index: d,
          row_index: r, col_index: c,
          content: '', bg_color: null,
          merge_span: { rowSpan: 1, colSpan: 1, mergedInto: null },
          prescription: ''
        });
      });
    }

    enhancedPayload.forEach((item) => {
      combinedPayload.set(
        `${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`,
        item
      );
    });

    await saveShockwaveMemosBulk(Array.from(combinedPayload.values()));

    if (clip.mode === 'cut' && currentClipboardSource?.keys) {
      clipboardRef.current = { ...clip, mode: 'copy' };
    }
    
    recordUndo({ type: 'bulk-edit', oldMemos });
    addToast('붙여넣기 완료', 'success');
    setContextMenu(null);
  }, [selectedCell, clipboardSource, parsePlainTextClipboard, buildPastePayload, buildSchedulerAutoText, addToast, memos, cellKey, currentYear, currentMonth, baseTimeSlots.length, colCount, saveShockwaveMemosBulk, recordUndo]);

  const buildTreatmentStatusPayload = useCallback((mode) => {
    if (!selectedKeys || selectedKeys.size === 0) return null;

    const effectiveKeys = normalizeKeysToMergeMasters(selectedKeys);
    const oldMemos = [];
    const payload = [];
    const touchedKeys = new Set();
    const statusBg = mode === 'cancel-toggle' ? TREATMENT_CANCEL_BG : TREATMENT_COMPLETE_BG;
    const shouldClearSelection =
      mode === 'toggle'
        ? Array.from(effectiveKeys).some((key) => memos[key]?.bg_color === TREATMENT_COMPLETE_BG)
        : mode === 'cancel-toggle'
          ? Array.from(effectiveKeys).some((key) => memos[key]?.bg_color === TREATMENT_CANCEL_BG)
          : mode === 'clear';

    Array.from(effectiveKeys).forEach((key) => {
      const [w, d, r, c] = key.split('-').map(Number);
      const memo = memos[key];
      const content = memo?.content || '';

      if (!String(content).trim()) return;

      const masterSpan = memo?.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null };
      const rowSpan = Math.max(1, masterSpan.rowSpan || 1);
      const colSpan = Math.max(1, masterSpan.colSpan || 1);
      const nextBgColor = shouldClearSelection ? null : statusBg;

      if ((memo?.bg_color || null) === nextBgColor) return;

      for (let row = r; row < r + rowSpan; row += 1) {
        for (let col = c; col < c + colSpan; col += 1) {
          const rangeKey = cellKey(w, d, row, col);
          if (touchedKeys.has(rangeKey)) continue;
          touchedKeys.add(rangeKey);

          const rangeMemo = memos[rangeKey];
          oldMemos.push({
            year: currentYear,
            month: currentMonth,
            week_index: w,
            day_index: d,
            row_index: row,
            col_index: col,
            content: rangeMemo?.content || '',
            bg_color: rangeMemo?.bg_color || null,
            merge_span: rangeMemo?.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null },
          });

          payload.push({
            year: currentYear,
            month: currentMonth,
            week_index: w,
            day_index: d,
            row_index: row,
            col_index: col,
            content: rangeMemo?.content || '',
            bg_color: nextBgColor,
            merge_span: rangeMemo?.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null },
          });
        }
      }
    });

    if (payload.length === 0) return null;
    return { oldMemos, payload };
  }, [selectedKeys, memos, currentYear, currentMonth, normalizeKeysToMergeMasters, cellKey]);

  const applyTreatmentCompleteToSelection = useCallback(async (mode) => {
    const batch = buildTreatmentStatusPayload(mode);
    if (!batch) {
      setContextMenu(null);
      return false;
    }

    recordUndo({ type: 'bulk-edit', oldMemos: batch.oldMemos });
    const success = await saveShockwaveMemosBulk(batch.payload);
    if (!success) {
      addToast(
        mode === 'cancel-toggle'
          ? '취소 상태 변경 실패'
          : mode === 'complete'
            ? '치료 완료 표시 실패'
          : mode === 'clear'
            ? '치료 완료 해제 실패'
            : '치료 완료/해제 실패',
        'error'
      );
      setContextMenu(null);
      return false;
    }

    setContextMenu(null);
    return true;
  }, [buildTreatmentStatusPayload, saveShockwaveMemosBulk, addToast, recordUndo]);

  const handleToggleTreatmentComplete = useCallback(async () => {
    await applyTreatmentCompleteToSelection('toggle');
  }, [applyTreatmentCompleteToSelection]);

  const handleToggleTreatmentCancel = useCallback(async () => {
    await applyTreatmentCompleteToSelection('cancel-toggle');
  }, [applyTreatmentCompleteToSelection]);

  // 환자 스케줄 내역 검색 및 적용 (Cmd+F)
  const handleOpenPatientHistoryModal = useCallback(async () => {
    try {
      // alert('디버그: 팝업 함수 진입');
      
      if (!selectedCell) {
        alert('디버그: 선택된 셀이 없습니다.');
        return;
      }
      const { w, d, r, c } = selectedCell;
      const key = cellKey(w, d, r, c);
      
      const content = editingCell === key ? editValue : (memos[key]?.content || pendingDisplayValues[key] || '');
      
      if (!content.trim()) {
        alert('디버그: 이름이나 차트번호가 비어있습니다. (' + content + ')');
        return;
      }
      
      const parsed = parseSchedulerPatientIdentity(content);
      const searchName = normalizeNameForMatch(parsed.patientName);
      const searchChart = parsed.patientChart ? String(parsed.patientChart).trim() : null;

      if (!searchName && !searchChart) {
        alert(`디버그: 이름/차트번호를 파악할 수 없습니다: ${content}`);
        return;
      }

      setPatientHistoryModalOpen(true);
      setPatientHistoryModalData({ loading: true, logs: [], searchName, searchChart });

      // DB에서 해당 환자의 내역만 조회하도록 쿼리 작성
      const shockwaveQuery = supabase.from('shockwave_patient_logs')
        .select('patient_name, chart_number, visit_count, date, prescription, body_part')
        .order('date', { ascending: false })
        .limit(50);
        
      const manualQuery = supabase.from('manual_therapy_patient_logs')
        .select('patient_name, chart_number, visit_count, date, prescription, body_part')
        .order('date', { ascending: false })
        .limit(50);

      // 이름 또는 차트번호로 필터링 (DB 레벨)
      if (searchChart) {
        shockwaveQuery.eq('chart_number', searchChart);
        manualQuery.eq('chart_number', searchChart);
      } else if (searchName) {
        // 이름은 띄어쓰기 등 변수가 있으므로 ilike(부분일치) 사용을 권장하나
        // 여기서는 정확한 이름 검색을 위해 eq 사용 후, 혹시 모를 공백 차이 대비
        shockwaveQuery.ilike('patient_name', `%${searchName}%`);
        manualQuery.ilike('patient_name', `%${searchName}%`);
      }

      const [shockwaveRes, manualRes] = await Promise.all([shockwaveQuery, manualQuery]);

      const allData = [
        ...(shockwaveRes.data || []).map(d => ({ ...d, type: 'shockwave' })),
        ...(manualRes.data || []).map(d => ({ ...d, type: 'manual' })),
      ];

      // 가져온 데이터에서 한 번 더 정확하게 필터링
      const matches = allData.filter((item) => {
        const matchChart = searchChart && String(item.chart_number || '').trim() === searchChart;
        const matchName = searchName && normalizeNameForMatch(item.patient_name).includes(searchName);
        if (searchChart) return matchChart;
        return matchName;
      });

      matches.sort((a, b) => {
        if (a.date !== b.date) return b.date.localeCompare(a.date);
        return (parseInt(b.visit_count || '0', 10) || 0) - (parseInt(a.visit_count || '0', 10) || 0);
      });

      setPatientHistoryModalData({ loading: false, logs: matches, searchName, searchChart });
    } catch (e) {
      console.error(e);
      alert(`디버그 에러 발생: ${e.message}`);
      setPatientHistoryModalData(prev => ({ ...prev, loading: false }));
    }
  }, [selectedCell, cellKey, editingCell, editValue, memos, pendingDisplayValues]);

  const handleApplyHistoryToCell = useCallback((log) => {
    if (!selectedCell) return;
    const { w, d, r, c } = selectedCell;
    const key = cellKey(w, d, r, c);
    
    const chart = String(log.chart_number || '').trim();
    const name = String(log.patient_name || '').replace(/\*/g, '').trim();
    const bodyPart = String(log.body_part || '').trim();
    const prescription = String(log.prescription || '').trim();
    const visitCount = parseInt(log.visit_count || '0', 10) || 0;
    
    let newContent = name;

    if (log.type === 'manual') {
      const doseMatch = String(prescription).match(/(40|60)/);
      if (doseMatch && !has4060Pattern(newContent)) {
        newContent = `${newContent}${doseMatch[0]}`;
      }
    }

    if (chart) {
      newContent = `${chart}/${newContent}`;
    }

    if (visitCount > 0) {
      newContent = `${newContent}(${visitCount})`;
    }

    const currentMemo = memos[key] || {};
    
    const payload = {
      year: currentYear,
      month: currentMonth,
      week_index: w,
      day_index: d,
      row_index: r,
      col_index: c,
      content: newContent,
      bg_color: currentMemo.bg_color || null,
      prescription: prescription || null,
      body_part: bodyPart || null,
      merge_span: currentMemo.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null }
    };

    setPendingDisplayValues((prev) => ({ ...prev, [key]: newContent }));
    
    saveShockwaveMemosBulk([payload]).then((success) => {
      if (success) {
        addToast('선택한 내역이 적용되었습니다.', 'success');
      } else {
        addToast('내역 적용에 실패했습니다.', 'error');
      }
      setPatientHistoryModalOpen(false);
    });
  }, [selectedCell, cellKey, currentYear, currentMonth, memos, saveShockwaveMemosBulk, addToast]);

  const handleToggleHolidayBackground = useCallback(async () => {
    if (!selectedKeys || selectedKeys.size === 0) return;

    const effectiveKeys = normalizeKeysToMergeMasters(selectedKeys);
    const shouldClearSelection = Array.from(effectiveKeys).some(
      (key) => memos[key]?.bg_color === SCHEDULER_HOLIDAY_BG
    );
    const nextBgColor = shouldClearSelection ? null : SCHEDULER_HOLIDAY_BG;
    const touchedKeys = new Set();
    const oldMemos = [];
    const payload = [];

    Array.from(effectiveKeys).forEach((key) => {
      const [w, d, r, c] = key.split('-').map(Number);
      const memo = memos[key];
      const masterSpan = memo?.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null };
      const rowSpan = Math.max(1, masterSpan.rowSpan || 1);
      const colSpan = Math.max(1, masterSpan.colSpan || 1);

      for (let row = r; row < r + rowSpan; row += 1) {
        for (let col = c; col < c + colSpan; col += 1) {
          const rangeKey = cellKey(w, d, row, col);
          if (touchedKeys.has(rangeKey)) continue;
          touchedKeys.add(rangeKey);

          const rangeMemo = memos[rangeKey];
          if ((rangeMemo?.bg_color || null) === nextBgColor) continue;

          oldMemos.push({
            year: currentYear,
            month: currentMonth,
            week_index: w,
            day_index: d,
            row_index: row,
            col_index: col,
            content: rangeMemo?.content || '',
            bg_color: rangeMemo?.bg_color || null,
            merge_span: rangeMemo?.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null },
            prescription: rangeMemo?.prescription || null,
            body_part: rangeMemo?.body_part || null,
          });

          payload.push({
            year: currentYear,
            month: currentMonth,
            week_index: w,
            day_index: d,
            row_index: row,
            col_index: col,
            content: rangeMemo?.content || '',
            bg_color: nextBgColor,
            merge_span: rangeMemo?.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null },
            prescription: rangeMemo?.prescription || null,
            body_part: rangeMemo?.body_part || null,
          });
        }
      }
    });

    if (payload.length === 0) return;
    recordUndo({ type: 'bulk-edit', oldMemos });
    const success = await saveShockwaveMemosBulk(payload);
    if (!success) addToast('배경색 변경 실패', 'error');
  }, [selectedKeys, memos, currentYear, currentMonth, normalizeKeysToMergeMasters, cellKey, saveShockwaveMemosBulk, addToast, recordUndo]);

  const handleContextAction = useCallback(async (action) => {
    const getStableMemoContent = (key, memo = {}) => {
      if (typeof memo.content === 'string') return memo.content;
      if (typeof pendingDisplayValues[key] === 'string') return pendingDisplayValues[key];
      return '';
    };

    if (action === 'copy') handleCopySelection();
    else if (action === 'cut') handleCutSelection();
    else if (action === 'paste') handlePasteSelection();
    else if (action === 'complete-toggle') handleToggleTreatmentComplete();
    else if (action === 'cancel-toggle') handleToggleTreatmentCancel();
    else if (action === 'merge' || action === 'unmerge') tryMergeSelection();
    else if (action?.type === 'prescription') {
      const keys = Array.from(selectedKeys || []);
      const oldMemos = buildMemoSnapshotForKeys(keys);
      let anyChanged = false;
      
      for (const key of keys) {
        const [w, d, r, c] = key.split('-').map(Number);
        const memo = memos[key] || {};
        let updatedContent = getStableMemoContent(key, memo);
        const prescriptionValue = action.value || '';
        const doseNumber = prescriptionValue.match(/^(40|60)분$/)?.[1];

        if (doseNumber) {
          // 40분/60분 처방 선택 시: 기존 40/60을 제거 후 이름 뒤에 해당 숫자 추가
          updatedContent = strip4060FromContent(updatedContent);
          // 이름(회차) 패턴에서 이름 뒤에 숫자 삽입
          const parenMatch = updatedContent.match(/^(.+?)(\(\d+\).*)$/);
          if (parenMatch) {
            updatedContent = `${parenMatch[1]}${doseNumber}${parenMatch[2]}`;
          } else if (updatedContent && !/\(\d+\)/.test(updatedContent)) {
            // 괄호가 없는 경우 끝에 추가
            updatedContent = `${updatedContent}${doseNumber}`;
          }
          updatedContent = normalize4060StarOrder(updatedContent);
        } else if (action.value && has4060Pattern(updatedContent)) {
          // 다른 처방(충격파 등) 설정 시 기존 40/60 제거
          updatedContent = strip4060FromContent(updatedContent);
        } else if (!action.value) {
          // 처방 없음 선택 시 기존 40/60 제거
          updatedContent = strip4060FromContent(updatedContent);
        }
        if (memo.prescription !== action.value || updatedContent !== getStableMemoContent(key, memo)) {
          const success = await onSaveMemo(currentYear, currentMonth, w, d, r, c, updatedContent, memo.bg_color, memo.merge_span, action.value);
          if (success) anyChanged = true;
        }
      }
      if (anyChanged) {
        recordUndo({ type: 'bulk-edit', oldMemos });
        addToast('처방이 적용되었습니다.', 'success');
      }
      return;
    }
    else if (action?.type === 'bodyPart') {
      const keys = Array.from(selectedKeys || []);
      const oldMemos = buildMemoSnapshotForKeys(keys);
      let anyChanged = false;
      
      for (const key of keys) {
        const [w, d, r, c] = key.split('-').map(Number);
        const memo = memos[key] || {};
        if (memo.body_part !== action.value) {
          const success = await onSaveMemo(currentYear, currentMonth, w, d, r, c, getStableMemoContent(key, memo), memo.bg_color, memo.merge_span, memo.prescription, action.value);
          if (success) anyChanged = true;
        }
      }
      if (anyChanged) {
        recordUndo({ type: 'bulk-edit', oldMemos });
        addToast('부위가 적용되었습니다.', 'success');
      }
      return; // don't close menu
    }
    else if (action?.type === 'bodyPartAdd') {
      // 기존 부위에 추가
      const keys = Array.from(selectedKeys || []);
      const oldMemos = buildMemoSnapshotForKeys(keys);
      let anyChanged = false;
      for (const key of keys) {
        const [w, d, r, c] = key.split('-').map(Number);
        const memo = memos[key] || {};
        const existing = (memo.body_part || '').trim();
        const newPart = formatBodyPartInput(action.value);
        if (!newPart) continue;
        const combined = existing ? `${existing}, ${newPart}` : newPart;
        const success = await onSaveMemo(currentYear, currentMonth, w, d, r, c, getStableMemoContent(key, memo), memo.bg_color, memo.merge_span, memo.prescription, combined);
        if (success) anyChanged = true;
      }
      if (anyChanged) {
        recordUndo({ type: 'bulk-edit', oldMemos });
        addToast('부위가 추가되었습니다.', 'success');
      }
      return;
    }
    else if (action?.type === 'bodyPartRemove') {
      // 특정 부위 삭제
      const keys = Array.from(selectedKeys || []);
      const oldMemos = buildMemoSnapshotForKeys(keys);
      let anyChanged = false;
      for (const key of keys) {
        const [w, d, r, c] = key.split('-').map(Number);
        const memo = memos[key] || {};
        const parts = (memo.body_part || '').split(',').map(p => p.trim()).filter(Boolean);
        const updated = parts.filter((_, i) => i !== action.index).join(', ');
        const success = await onSaveMemo(currentYear, currentMonth, w, d, r, c, getStableMemoContent(key, memo), memo.bg_color, memo.merge_span, memo.prescription, updated);
        if (success) anyChanged = true;
      }
      if (anyChanged) {
        recordUndo({ type: 'bulk-edit', oldMemos });
        addToast('부위가 삭제되었습니다.', 'success');
      }
      return;
    }
    else if (action?.type === 'bodyPartDeleteValue') {
      // x 버튼: 현재 셀의 body_part에서 해당 부위를 토글(제거)
      // bodyPartToggle과 동일한 동작으로 통합
      const keys = Array.from(selectedKeys || []);
      const oldMemos = buildMemoSnapshotForKeys(keys);
      let anyChanged = false;
      const targetPart = action.value.trim();
      for (const key of keys) {
        const [w, d, r, c] = key.split('-').map(Number);
        const memo = memos[key] || {};
        const parts = (memo.body_part || '').split(',').map(p => p.trim()).filter(Boolean);
        const idx = parts.findIndex(p => normalizeBodyPartKey(p) === normalizeBodyPartKey(targetPart));
        if (idx >= 0) {
          parts.splice(idx, 1);
        }
        const updated = parts.join(', ');
        if (updated === (memo.body_part || '').trim()) continue;
        const success = await onSaveMemo(currentYear, currentMonth, w, d, r, c, getStableMemoContent(key, memo), memo.bg_color, memo.merge_span, memo.prescription, updated);
        if (success) anyChanged = true;
      }
      if (anyChanged) {
        recordUndo({ type: 'bulk-edit', oldMemos });
        addToast('부위가 삭제되었습니다.', 'success');
      }
      return;
    }
    else if (action?.type === 'bodyPartEdit') {
      // 특정 부위 수정
      const keys = Array.from(selectedKeys || []);
      const oldMemos = buildMemoSnapshotForKeys(keys);
      let anyChanged = false;
      for (const key of keys) {
        const [w, d, r, c] = key.split('-').map(Number);
        const memo = memos[key] || {};
        const parts = (memo.body_part || '').split(',').map(p => p.trim()).filter(Boolean);
        parts[action.index] = formatBodyPartInput(action.value);
        const updated = parts.filter(Boolean).join(', ');
        const success = await onSaveMemo(currentYear, currentMonth, w, d, r, c, getStableMemoContent(key, memo), memo.bg_color, memo.merge_span, memo.prescription, updated);
        if (success) anyChanged = true;
      }
      if (anyChanged) {
        recordUndo({ type: 'bulk-edit', oldMemos });
        addToast('부위가 수정되었습니다.', 'success');
      }
      return;
    }
    else if (action?.type === 'bodyPartClear') {
      const keys = Array.from(selectedKeys || []);
      const oldMemos = buildMemoSnapshotForKeys(keys);
      let anyChanged = false;
      for (const key of keys) {
        const [w, d, r, c] = key.split('-').map(Number);
        const memo = memos[key] || {};
        const success = await onSaveMemo(currentYear, currentMonth, w, d, r, c, getStableMemoContent(key, memo), memo.bg_color, memo.merge_span, memo.prescription, '');
        if (success) anyChanged = true;
      }
      if (anyChanged) {
        recordUndo({ type: 'bulk-edit', oldMemos });
        addToast('부위가 삭제되었습니다.', 'success');
      }
      return;
    }
    else if (action?.type === 'bodyPartToggle') {
      const keys = Array.from(selectedKeys || []);
      const oldMemos = buildMemoSnapshotForKeys(keys);
      let anyChanged = false;
      const targetPart = action.value.trim();
      for (const key of keys) {
        const [w, d, r, c] = key.split('-').map(Number);
        const memo = memos[key] || {};
        const parts = (memo.body_part || '').split(',').map(p => p.trim()).filter(Boolean);
        const idx = parts.findIndex(p => p.toLowerCase() === targetPart.toLowerCase());
        if (idx >= 0) {
          parts.splice(idx, 1);
        } else {
          parts.push(targetPart);
        }
        const updated = parts.join(', ');
        const success = await onSaveMemo(currentYear, currentMonth, w, d, r, c, getStableMemoContent(key, memo), memo.bg_color, memo.merge_span, memo.prescription, updated);
        if (success) anyChanged = true;
      }
      if (anyChanged) {
        recordUndo({ type: 'bulk-edit', oldMemos });
      }
      return;
    }
    else if (action?.type === 'memoAdd') {
      const keys = Array.from(selectedKeys || []);
      const oldMemos = buildMemoSnapshotForKeys(keys);
      let anyChanged = false;
      const newMemo = String(action.value || '').trim();
      if (!newMemo) return;
      setContextMenuMemoDrafts((prev) => [...prev, newMemo]);
      for (const key of keys) {
        const [w, d, r, c] = key.split('-').map(Number);
        const memo = memos[key] || {};
        const memoList = getMemoListFromMergeSpan(memo.merge_span);
        const nextMemoList = [...memoList, newMemo];
        const nextMergeSpan = buildMergeSpanWithMemoList(memo.merge_span, nextMemoList);
        const success = await onSaveMemo(currentYear, currentMonth, w, d, r, c, getStableMemoContent(key, memo), memo.bg_color, nextMergeSpan, memo.prescription, memo.body_part);
        if (success) anyChanged = true;
      }
      if (anyChanged) {
        recordUndo({ type: 'bulk-edit', oldMemos });
        addToast('메모가 추가되었습니다.', 'success');
      }
      return;
    }
    else if (action?.type === 'memoRemove') {
      const keys = Array.from(selectedKeys || []);
      const oldMemos = buildMemoSnapshotForKeys(keys);
      let anyChanged = false;
      setContextMenuMemoDrafts((prev) => prev.filter((_, index) => index !== action.index));
      for (const key of keys) {
        const [w, d, r, c] = key.split('-').map(Number);
        const memo = memos[key] || {};
        const memoList = getMemoListFromMergeSpan(memo.merge_span);
        const nextMemoList = memoList.filter((_, index) => index !== action.index);
        const nextMergeSpan = buildMergeSpanWithMemoList(memo.merge_span, nextMemoList);
        const success = await onSaveMemo(currentYear, currentMonth, w, d, r, c, getStableMemoContent(key, memo), memo.bg_color, nextMergeSpan, memo.prescription, memo.body_part);
        if (success) anyChanged = true;
      }
      if (anyChanged) {
        recordUndo({ type: 'bulk-edit', oldMemos });
        addToast('메모가 삭제되었습니다.', 'success');
      }
      return;
    }
    else if (action?.type === 'memoUpdate') {
      const keys = Array.from(selectedKeys || []);
      const oldMemos = buildMemoSnapshotForKeys(keys);
      let anyChanged = false;
      const nextValue = String(action.value || '').trim();
      setContextMenuMemoDrafts((prev) => prev.map((item, index) => index === action.index ? nextValue : item).filter(Boolean));
      for (const key of keys) {
        const [w, d, r, c] = key.split('-').map(Number);
        const memo = memos[key] || {};
        const memoList = getMemoListFromMergeSpan(memo.merge_span);
        const nextMemoList = memoList.map((item, index) => index === action.index ? nextValue : item).filter(Boolean);
        const nextMergeSpan = buildMergeSpanWithMemoList(memo.merge_span, nextMemoList);
        const success = await onSaveMemo(currentYear, currentMonth, w, d, r, c, getStableMemoContent(key, memo), memo.bg_color, nextMergeSpan, memo.prescription, memo.body_part);
        if (success) anyChanged = true;
      }
      if (anyChanged) {
        recordUndo({ type: 'bulk-edit', oldMemos });
        addToast('메모가 수정되었습니다.', 'success');
      }
      return;
    }
    else if (action?.type === 'reservationTime') {
      const keys = contextMenu
        ? [`${contextMenu.weekIdx}-${contextMenu.dayIdx}-${contextMenu.rowIdx}-${contextMenu.colIdx}`]
        : Array.from(selectedKeys || []);
      const oldMemos = buildMemoSnapshotForKeys(keys);
      let anyChanged = false;
      const nextTime = normalizeReservationTimeValue(action.value);
      setContextMenuReservationInput(nextTime);
      if (contextMenu) {
        setContextMenu((prev) => prev ? { ...prev, savedReservationTime: nextTime } : prev);
      }
      for (const key of keys) {
        const [w, d, r, c] = key.split('-').map(Number);
        const memo = memos[key] || {};
        const nextMergeSpan = buildMergeSpanWithReservationTime(memo.merge_span, nextTime);
        const currentTime = getReservationTimeFromMergeSpan(memo.merge_span);
        if (currentTime === getReservationTimeFromMergeSpan(nextMergeSpan)) continue;
        const success = await onSaveMemo(currentYear, currentMonth, w, d, r, c, getStableMemoContent(key, memo), memo.bg_color, nextMergeSpan, memo.prescription, memo.body_part);
        if (success) anyChanged = true;
      }
      if (anyChanged) {
        recordUndo({ type: 'bulk-edit', oldMemos });
        addToast('예약 시간이 수정되었습니다.', 'success');
      }
      return;
    }
    else if (action?.type === 'reservationTimeReset') {
      const keys = contextMenu
        ? [`${contextMenu.weekIdx}-${contextMenu.dayIdx}-${contextMenu.rowIdx}-${contextMenu.colIdx}`]
        : Array.from(selectedKeys || []);
      const oldMemos = buildMemoSnapshotForKeys(keys);
      let anyChanged = false;
      const defaultTime = contextMenu?.defaultReservationTime || (contextMenu ? getDefaultReservationTime(contextMenu.weekIdx, contextMenu.dayIdx, contextMenu.rowIdx) : '');
      setContextMenuReservationInput(defaultTime);
      for (const key of keys) {
        const [w, d, r, c] = key.split('-').map(Number);
        const memo = memos[key] || {};
        const currentTime = getReservationTimeFromMergeSpan(memo.merge_span);
        if (!currentTime) continue;
        const nextMergeSpan = buildMergeSpanWithReservationTime(memo.merge_span, '');
        const success = await onSaveMemo(currentYear, currentMonth, w, d, r, c, getStableMemoContent(key, memo), memo.bg_color, nextMergeSpan, memo.prescription, memo.body_part);
        if (success) anyChanged = true;
      }
      if (contextMenu) {
        setContextMenu((prev) => prev ? { ...prev, savedReservationTime: '' } : prev);
      }
      if (anyChanged) {
        recordUndo({ type: 'bulk-edit', oldMemos });
        addToast('예약 시간이 기본 시간으로 복구되었습니다.', 'success');
      }
      return;
    }
    else if (action?.type === 'visitCount') {
      const keys = Array.from(selectedKeys || []);
      const oldMemos = buildMemoSnapshotForKeys(keys);
      let anyChanged = false;
      const nextVisitInput = normalizeVisitInputValue(action.value);
      setContextMenuVisitInput(nextVisitInput);
      for (const key of keys) {
        const [w, d, r, c] = key.split('-').map(Number);
        const memo = memos[key] || {};
        const stableContent = getStableMemoContent(key, memo);
        const updatedContent = applyVisitCountToSchedulerContent(stableContent, nextVisitInput);
        if (updatedContent === stableContent) continue;
        const success = await onSaveMemo(
          currentYear,
          currentMonth,
          w,
          d,
          r,
          c,
          updatedContent,
          memo.bg_color,
          memo.merge_span,
          memo.prescription,
          memo.body_part
        );
        if (success) anyChanged = true;
      }
      if (anyChanged) {
        recordUndo({ type: 'bulk-edit', oldMemos });
        addToast('회차가 수정되었습니다.', 'success');
      }
      return;
    }
    setContextMenu(null);
  }, [selectedKeys, memos, pendingDisplayValues, currentYear, currentMonth, onSaveMemo, addToast, handleCopySelection, handleCutSelection, handlePasteSelection, handleToggleTreatmentComplete, handleToggleTreatmentCancel, tryMergeSelection, buildMemoSnapshotForKeys, recordUndo]);

  const submitContextMenuBodyInput = useCallback(() => {
    const val = contextMenuBodyInput.trim();
    if (!val) return false;
    handleContextAction({ type: 'bodyPartAdd', value: val });
    setContextMenuBodyInput('');
    return true;
  }, [contextMenuBodyInput, handleContextAction]);

  const submitContextMenuNoteInput = useCallback(() => {
    const val = contextMenuNoteInput.trim();
    if (!val) return false;
    handleContextAction({ type: 'memoAdd', value: val });
    setContextMenuNoteInput('');
    return true;
  }, [contextMenuNoteInput, handleContextAction]);

  const submitContextMenuVisitInput = useCallback(() => {
    const val = normalizeVisitInputValue(contextMenuVisitInput);
    setContextMenuVisitInput(val);
    handleContextAction({ type: 'visitCount', value: val });
    return true;
  }, [contextMenuVisitInput, handleContextAction]);

  const stepContextMenuVisitInput = useCallback((delta) => {
    const nextValue = stepVisitInputValue(contextMenuVisitInput, delta);
    setContextMenuVisitInput(nextValue);
    handleContextAction({ type: 'visitCount', value: nextValue });
  }, [contextMenuVisitInput, handleContextAction]);

  const repositionContextMenu = useCallback(() => {
    if (!contextMenuRef.current) return;
    const rect = contextMenuRef.current.getBoundingClientRect();
    const VIEWPORT_GAP = 12;
    const maxX = Math.max(VIEWPORT_GAP, window.innerWidth - rect.width - VIEWPORT_GAP);
    const maxY = Math.max(VIEWPORT_GAP, window.innerHeight - rect.height - VIEWPORT_GAP);

    setContextMenu((prev) => {
      if (!prev) return prev;
      const nextX = Math.min(Math.max(VIEWPORT_GAP, prev.x), maxX);
      const nextY = Math.min(Math.max(VIEWPORT_GAP, prev.y), maxY);
      if (nextX === prev.x && nextY === prev.y) return prev;
      return { ...prev, x: nextX, y: nextY };
    });
  }, []);

  const focusEditInputImmediately = useCallback(() => {
    const input = editInputRef.current;
    if (!input) return;
    input.focus();
    if (!imeOpenRef.current && document.activeElement === input) {
      const len = input.value?.length || 0;
      input.setSelectionRange(len, len);
    }
  }, []);

  const beginEditingCell = useCallback((key, nextValue, preserveValue = false) => {
    editDraftRef.current = { key, value: nextValue || '', dirty: false };
    flushSync(() => {
      setEditingCell(key);
      setEditValue(nextValue);
    });
    if (editInputRef.current) {
      editInputRef.current.value = nextValue || '';
    }
    focusEditInputImmediately();
  }, [focusEditInputImmediately]);

  const promoteFocusedInputToEditor = useCallback((key, value) => {
    editDraftRef.current = { key, value: value || '', dirty: true };
    flushSync(() => {
      setEditingCell(key);
      setEditValue(value);
    });
  }, []);

  // ── 키보드 이벤트 핸들러 (구글 시트 방식) ──
  const handleKeyDown = useCallback((e) => {
    if (e.defaultPrevented) return;
    if (isContextMenuTarget(e.target)) return;
    if (isUndoShortcutEvent(e)) {
      if (e.__shockwaveUndoHandled) return;
      e.__shockwaveUndoHandled = true;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation?.();
      doUndo();
      return;
    }
    const isMeta = e.metaKey || e.ctrlKey;

    // Cmd+F → 환자 내역 검색 팝업 (가장 우선 처리)
    if (isMeta && (e.code === 'KeyF' || e.key.toLowerCase() === 'f')) {
      e.preventDefault();
      e.stopPropagation();
      handleOpenPatientHistoryModal();
      return;
    }

    if (isEditableTarget(e.target)) return;
    if (contextMenu) {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    if (!selectedCell) return;
    const { w, d, r, c } = selectedCell;

    // 편집 중이면 대부분의 키를 무시
    if (editingCell) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setEditingCell(null);
      }
      return; // 편집 중에는 input이 키 이벤트를 처리
    }

    // Enter → 편집 모드 진입
    if (e.key === 'Enter') {
      e.preventDefault();
      const key = cellKey(w, d, r, c);
      beginEditingCell(key, memos[key]?.content || '', true);
      return;
    }

    // F2 → 편집 모드 진입
    if (e.key === 'F2') {
      e.preventDefault();
      const key = cellKey(w, d, r, c);
      beginEditingCell(key, memos[key]?.content || '', true);
      return;
    }

    // Delete / Backspace → 선택된 셀 내용 삭제
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      deleteCells(selectedKeys);
      return;
    }

    // 화살표 키 → 셀 이동
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      const nextCell = getAdjacentCell({ w, d, r, c }, e.key);

      if (e.shiftKey) {
        setRangeEnd(nextCell);
        setSelectedKeys(buildRangeKeys(selectedCell, nextCell));
      } else {
        selectSingleCell(nextCell);
      }
      return;
    }

    // Ctrl/Cmd+- → 예약 취소 토글
    if (isMeta && (e.code === 'Minus' || e.key === '-')) {
      e.preventDefault();
      e.stopPropagation();
      handleToggleTreatmentCancel();
      return;
    }

    // Ctrl/Cmd+G → 치료 완료 토글
    if (isMeta && e.code === 'KeyG') {
      e.preventDefault();
      e.stopPropagation();
      handleToggleTreatmentComplete();
      return;
    }

    // Ctrl/Cmd+B -> 휴일 배경색 토글
    if (isMeta && e.code === 'KeyB') {
      e.preventDefault();
      e.stopPropagation();
      handleToggleHolidayBackground();
      return;
    }

    // Cmd+E → 병합 / 병합 해제
    if (isMeta && e.code === 'KeyE') {
      e.preventDefault();
      tryMergeSelection();
      return;
    }

    // Tab → 우측 이동
    if (e.key === 'Tab') {
      e.preventDefault();
      const nc = e.shiftKey ? Math.max(0, c - 1) : Math.min(colCount - 1, c + 1);
      selectSingleCell({ w, d, r, c: nc });
      return;
    }

    // Cmd+C → 복사
    if (isMeta && e.code === 'KeyC') {
      e.preventDefault();
      handleCopySelection();
      return;
    }

    // Cmd+X → 잘라내기
    if (isMeta && e.code === 'KeyX') {
      e.preventDefault();
      handleCutSelection();
      return;
    }


    // 일반 문자 입력 → 편집 모드 진입 (기존 내용 대체)
    if ((e.key.length === 1 || e.key === 'Process' || e.keyCode === 229) && !isMeta && !e.altKey) {
      const key = cellKey(w, d, r, c);
      const isImeCompositionKey =
        e.key === 'Process' ||
        e.keyCode === 229 ||
        e.nativeEvent?.isComposing ||
        (e.key.length === 1 && e.key.charCodeAt(0) > 127);
      if (isImeCompositionKey) {
        imeOpenRef.current = true;
        // Let the focused hidden input receive the IME composition intact.
        // Promoting here splits Korean syllables such as "길" into "ㄱㅣㄹ".
      } else {
        e.preventDefault();
        beginEditingCell(key, e.key, false);
      }
      return;
    }
  }, [contextMenu, selectedCell, editingCell, selectedKeys, deleteCells, buildRangeKeys, selectSingleCell, getAdjacentCell, beginEditingCell, handleCopySelection, handleCutSelection, handlePasteSelection, handleToggleTreatmentComplete, handleToggleTreatmentCancel, handleToggleHolidayBackground, tryMergeSelection, doUndo, isEditableTarget, isContextMenuTarget, cellKey, colCount, memos, handleOpenPatientHistoryModal]);

  // 키보드 이벤트 등록

  useEffect(() => {
    const el = viewRef.current;
    if (el) {
      el.addEventListener('keydown', handleKeyDown);
      return () => el.removeEventListener('keydown', handleKeyDown);
    }
  }, [handleKeyDown]);

  // 최신 모달 호출 함수를 Ref에 저장하여 클로저 문제 해결
  const openModalRef = useRef(handleOpenPatientHistoryModal);
  useEffect(() => {
    openModalRef.current = handleOpenPatientHistoryModal;
  }, [handleOpenPatientHistoryModal]);

  // 전역 Cmd+F 가로채기 (캡처링 단계)
  useEffect(() => {
    const handleGlobalCmdF = (e) => {
      const isMeta = e.metaKey || e.ctrlKey;
      const isKeyF = e.code === 'KeyF' || e.key.toLowerCase() === 'f';
      
      if (isMeta && isKeyF) {
        // 셀이 선택되어 있으면 브라우저 기본 검색을 막고 팝업 호출
        if (selectedCellRef.current) {
          e.preventDefault();
          e.stopPropagation();
          openModalRef.current();
        }
      }
    };
    
    // 캡처링 단계에서 가장 먼저 잡음
    window.addEventListener('keydown', handleGlobalCmdF, { capture: true });
    return () => window.removeEventListener('keydown', handleGlobalCmdF, { capture: true });
  }, []); // 의존성 배열을 비워 한 번만 등록

  useEffect(() => {
    const handlePasteEvent = (event) => {
      if (!selectedCell) return;

      const target = event.target;
      if (isContextMenuTarget(target)) return;
      const isEditableTarget =
        (target instanceof HTMLInputElement && !target.dataset.hiddenInput) ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable;
      if (isEditableTarget) return;

      const pastedText = event.clipboardData?.getData('text/plain');
      const pastedHtml = event.clipboardData?.getData('text/html');
      if (!pastedText) return;
      event.preventDefault();
      handlePasteSelection(pastedText, pastedHtml);
    };

    window.addEventListener('paste', handlePasteEvent, true);
    return () => window.removeEventListener('paste', handlePasteEvent, true);
  }, [selectedCell, handlePasteSelection, isContextMenuTarget]);

  useEffect(() => {
    const handleWindowKeyDown = (event) => {
      const target = event.target;
      if (isContextMenuTarget(target)) return;
      if (isEditableTarget(target)) return;
      handleKeyDown(event);
    };

    window.addEventListener('keydown', handleWindowKeyDown, true);
    return () => window.removeEventListener('keydown', handleWindowKeyDown, true);
  }, [handleKeyDown, isEditableTarget, isContextMenuTarget]);

  useEffect(() => {
    const handleMouseUp = () => {
      dragSelectionRef.current = null;
    };

    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, []);

  useEffect(() => {
    const el = viewRef.current;
    if (!el) return;
    const handleContext = (event) => {
      if (!selectedKeys || selectedKeys.size === 0 || editingCell) {
        setContextMenu(null);
        return;
      }
      event.preventDefault();
      const MENU_WIDTH = 180;
      const MENU_HEIGHT = 180;
      const VIEWPORT_GAP = 12;
      const SUBMENU_WIDTH = 300;
      const isNearRightEdge = event.clientX + MENU_WIDTH + SUBMENU_WIDTH > window.innerWidth;
      
      const maxX = Math.max(VIEWPORT_GAP, window.innerWidth - MENU_WIDTH - VIEWPORT_GAP);
      const maxY = Math.max(VIEWPORT_GAP, window.innerHeight - MENU_HEIGHT - VIEWPORT_GAP);
      setContextMenu({
        x: Math.min(event.clientX, maxX),
        y: Math.min(event.clientY, maxY),
        isNearRightEdge,
      });
    };
    el.addEventListener('contextmenu', handleContext);
    return () => el.removeEventListener('contextmenu', handleContext);
  }, [selectedKeys, editingCell]);

  useEffect(() => {
    if (!contextMenu || !contextMenuRef.current) return;

    repositionContextMenu();

    const menuEl = contextMenuRef.current;
    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => {
          repositionContextMenu();
        })
      : null;

    if (resizeObserver) resizeObserver.observe(menuEl);
    window.addEventListener('resize', repositionContextMenu);
    window.addEventListener('scroll', repositionContextMenu, true);

    return () => {
      if (resizeObserver) resizeObserver.disconnect();
      window.removeEventListener('resize', repositionContextMenu);
      window.removeEventListener('scroll', repositionContextMenu, true);
    };
  }, [contextMenu, repositionContextMenu]);

  useEffect(() => {
    if (contextMenu && (!selectedKeys || selectedKeys.size === 0)) {
      setContextMenu(null);
    }
  }, [contextMenu, selectedKeys]);

  useEffect(() => {
    const handleWindowClick = (event) => {
      if (contextMenuRef.current?.contains(event.target)) return;
      setContextMenu(null);
    };
    window.addEventListener('click', handleWindowClick);
    return () => window.removeEventListener('click', handleWindowClick);
  }, []);

  useEffect(() => {
    if (!editingCell) return;
    // Double rAF ensures the input DOM node exists after React re-renders the cell
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (editInputRef.current) {
          editInputRef.current.focus();
          if (!imeOpenRef.current && document.activeElement === editInputRef.current) {
            const len = editInputRef.current.value?.length || 0;
            editInputRef.current.setSelectionRange(len, len);
          }
        }
      });
    });
  }, [editingCell]);

  useEffect(() => {
    if (!selectedCell || editingCell) return;
    if (isEditableTarget(document.activeElement)) return;
    requestAnimationFrame(() => {
      const input = editInputRef.current;
      if (!input || !input.dataset.hiddenInput) return;
      input.focus();
    });
  }, [selectedCell, editingCell, isEditableTarget]);

  // 편집 완료 후 아래로 이동
  const handleEditKeyDown = useCallback((e, w, d, r, c) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      const { selectionStart, selectionEnd, value } = e.target;
      
      // If Left arrow, let it move cursor if not at the beginning
      if (e.key === 'ArrowLeft' && (selectionStart > 0 || selectionEnd > 0)) {
        return; // default behavior moves cursor left
      }
      // If Right arrow, let it move cursor if not at the end
      if (e.key === 'ArrowRight' && (selectionStart < value.length || selectionEnd < value.length)) {
        return; // default behavior moves cursor right
      }

      e.preventDefault();
      e.stopPropagation();
      e.target.blur();
      const nextCell = getAdjacentCell({ w, d, r, c }, e.key);
      selectSingleCell(nextCell);
      return;
    }

    if (e.key === 'Enter') {
      if (e.nativeEvent?.isComposing) return;
      e.target.blur();
      // Enter 후 아래 셀로 이동
      const nr = Math.min(baseTimeSlots.length - 1, r + 1);
      selectSingleCell({ w, d, r: nr, c });
    }
    if (e.key === 'Escape') {
      setEditingCell(null);
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      e.target.blur();
      const nc = e.shiftKey ? Math.max(0, c - 1) : Math.min(colCount - 1, c + 1);
      selectSingleCell({ w, d, r, c: nc });
    }
  }, [baseTimeSlots.length, colCount, selectSingleCell, getAdjacentCell]);

  const handleChartSelectorClose = useCallback((selected) => {
    if (!chartSelector) return;
    chartSelector.resolve(selected || null);
    setChartSelector(null);
  }, [chartSelector]);

  const positionTooltip = useCallback((clientX, clientY) => {
    const tooltipEl = tooltipRef.current;
    if (!tooltipEl) return;

    const offset = 14;
    const edgePadding = 8;
    const { width, height } = tooltipEl.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let left = clientX + offset;
    let top = clientY + offset;

    if (left + width + edgePadding > viewportWidth) {
      left = clientX - width - offset;
    }
    if (top + height + edgePadding > viewportHeight) {
      top = clientY - height - offset;
    }

    left = Math.min(Math.max(edgePadding, left), Math.max(edgePadding, viewportWidth - width - edgePadding));
    top = Math.min(Math.max(edgePadding, top), Math.max(edgePadding, viewportHeight - height - edgePadding));

    tooltipEl.style.left = `${left}px`;
    tooltipEl.style.top = `${top}px`;
    tooltipEl.style.opacity = hoverData ? '1' : '0';
  }, [hoverData]);

  useEffect(() => {
    if (!hoverData || !tooltipRef.current) return;
    const { x, y } = tooltipMousePosRef.current;
    const rafId = window.requestAnimationFrame(() => {
      positionTooltip(x, y);
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [hoverData, positionTooltip]);

  const scrollToTodayWeek = useCallback((instant = false) => {
    if (todayWeekIdx < 0) return;
    const weekEl = weekRefs.current[todayWeekIdx];
    if (!weekEl) return;
    weekEl.scrollIntoView({ behavior: instant ? 'instant' : 'smooth', block: 'start', inline: 'nearest' });
  }, [todayWeekIdx]);

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
    setTodayShortcutTooltip({ x, y, text: `오늘 ${shortcutLabels.today}` });
  }, [shortcutLabels.today]);

  useEffect(() => {
    const handleTodayShortcut = (event) => {
      const key = String(event.key || '').toLowerCase();
      const isOpenShortcut = (event.metaKey || event.ctrlKey) && (
        event.code === 'KeyO' ||
        key === 'o' ||
        key === 'ㅐ'
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

  // 최초 마운트 시 오늘 주차로 즉시 이동 (모션 없이)
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
        scrollToTodayWeek(true); // instant
      } else {
        const firstWeekEl = weekRefs.current[0];
        if (firstWeekEl) {
          firstWeekEl.scrollIntoView({ behavior: 'instant', block: 'start', inline: 'nearest' });
        }
      }
      initialScrollDoneRef.current = true;
    }, 80);
    return () => clearTimeout(timer);
  }, [scheduleScrollKey, todayWeekIdx, scrollToTodayWeek]);

  // 월이 변경될 때 스크롤 위치 초기화 (최초 마운트 이후에만 smooth로)
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
  }, [currentYear, currentMonth, todayWeekIdx, scrollToTodayWeek]);

  // 최상위 CSS 변수로 그리드 컬럼 너비를 통일 (모든 주차에 동일하게 적용)
  const therapistColsCSS = useMemo(() => {
    return colRatios
      ? colRatios.map(r => `minmax(0, ${r}fr)`).join(' ')
      : `repeat(${colCount}, minmax(0, 1fr))`;
  }, [colRatios, colCount]);
  const isScheduleMonthLoading = loadedMemosKey !== scheduleScrollKey;
  const renderMemos = isScheduleMonthLoading ? {} : memos;

  return (
    <>
      <div 
        className={`shockwave-view animate-fade-in${isScheduleMonthLoading ? ' is-month-loading' : ''}`}
        ref={viewRef} 
        tabIndex={0} 
        style={{
          outline: 'none',
          '--sw-row-height': `${rowHeight}px`,
          '--sw-cell-font-size': `${effectiveSchedulerTextSettings.font_size}px`,
          '--sw-cell-font-weight': effectiveSchedulerTextSettings.font_weight,
          '--sw-therapist-cols': therapistColsCSS,
          '--sw-day-col-width': dayColWidth ? `${dayColWidth}px` : 'none',
        }}
        onMouseLeave={() => setHoverData(null)}
        onMouseMove={(e) => {
          tooltipMousePosRef.current = { x: e.clientX, y: e.clientY };
          if (tooltipRef.current) positionTooltip(e.clientX, e.clientY);
        }}
      >
      {isScheduleMonthLoading && (
        <div className="shockwave-month-loading" role="status" aria-live="polite">
          <div className="shockwave-month-loading-card">
            <span className="shockwave-month-loading-spinner" />
            <span>{currentYear}년 {String(currentMonth).padStart(2, '0')}월 스케줄 불러오는 중</span>
          </div>
        </div>
      )}
      {weeks.map((weekDays, weekIdx) => (
        <div
          key={weekIdx}
          className={`shockwave-week${weekIdx === todayWeekIdx ? ' is-today-week' : ''}`}
          ref={(el) => {
            weekRefs.current[weekIdx] = el;
          }}
        >
          {weekIdx === 0 && (
            <div className="shockwave-week-label">
              <div className="shockwave-week-label-main">
                <div className="shockwave-month-title-group">
                  <button
                    type="button"
                    className="shockwave-month-nav-btn"
                    onClick={() => navigateMonth(-1)}
                    aria-label="이전 달"
                  >
                    ‹
                  </button>
                  <span className="shockwave-month-title">
                    {currentYear}년 {String(currentMonth).padStart(2, '0')}월 충격파/도수 스케줄
                  </span>
                  <button
                    type="button"
                    className="shockwave-month-nav-btn"
                    onClick={() => navigateMonth(1)}
                    aria-label="다음 달"
                  >
                    ›
                  </button>
                </div>
                <button
                  type="button"
                  className="shockwave-row-height-handle"
                  title={`행 높이 조절 (${rowHeight}px)`}
                  aria-label="시간 행 높이 조절"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    rowResizeRef.current = { active: true, startY: e.clientY, startHeight: rowHeight };
                    const onMove = (ev) => {
                      if (!rowResizeRef.current.active) return;
                      const delta = ev.clientY - rowResizeRef.current.startY;
                      setRowHeight(Math.max(18, Math.min(44, rowResizeRef.current.startHeight + delta)));
                    };
                    const onUp = () => {
                      rowResizeRef.current.active = false;
                      window.removeEventListener('mousemove', onMove);
                      window.removeEventListener('mouseup', onUp);
                    };
                    window.addEventListener('mousemove', onMove);
                    window.addEventListener('mouseup', onUp);
                  }}
                >
                  ↕
                </button>
              </div>
              <div className="shockwave-week-label-actions">
                <button
                  type="button"
                  className="shockwave-week-today-btn"
                  onClick={() => setShowTherapistConfig(true)}
                >
                  설정
                </button>
              </div>
            </div>
          )}
          <div className="shockwave-days" style={{ position: 'relative' }}>
            <div className="shockwave-week-floating-actions shockwave-week-floating-actions--left">
              <button
                type="button"
                className="shockwave-week-today-btn"
                onClick={scrollToTodayWeek}
                onMouseEnter={updateTodayShortcutTooltip}
                onMouseMove={updateTodayShortcutTooltip}
                onMouseLeave={() => setTodayShortcutTooltip(null)}
                onFocus={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  updateTodayShortcutTooltip({
                    clientX: rect.left + rect.width / 2,
                    clientY: rect.top,
                  });
                }}
                onBlur={() => setTodayShortcutTooltip(null)}
                disabled={todayWeekIdx < 0}
              >
                오늘
              </button>
            </div>
            <div className="shockwave-week-floating-actions shockwave-week-floating-actions--right">
              <button
                type="button"
                className="shockwave-week-today-btn"
                onClick={scrollToTodayWeek}
                onMouseEnter={updateTodayShortcutTooltip}
                onMouseMove={updateTodayShortcutTooltip}
                onMouseLeave={() => setTodayShortcutTooltip(null)}
                onFocus={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  updateTodayShortcutTooltip({
                    clientX: rect.left + rect.width / 2,
                    clientY: rect.top,
                  });
                }}
                onBlur={() => setTodayShortcutTooltip(null)}
                disabled={todayWeekIdx < 0}
              >
                오늘
              </button>
            </div>
            {weekDays.map((dayInfo, dayIdx) => {
              const isToday = isSameDate(dayInfo.date, today);
              const daySlots = getTimeSlotsForDay(dayInfo);
              // 첫 번째 요일에만 시간 열 표사
              const showTimeCol = dayIdx === 0;
              const gridCols = showTimeCol
                ? `${TIME_COL_WIDTH}px ${therapistColsCSS}`
                : therapistColsCSS;

              let headerClass = 'sw-day-header-cell';
              if (dayInfo.isHoliday) headerClass += ' holiday';
              else if (!dayInfo.isCurrentMonth) headerClass += ' other-month';
              else if (isToday) headerClass += ' today';
              else if (dayInfo.dow === 6) headerClass += ' saturday';

              const targetColWidth = showTimeCol && dayColWidth ? dayColWidth + TIME_COL_WIDTH : dayColWidth;
              const flexBasis = showTimeCol ? TIME_COL_WIDTH : 0;
              const dayFlexStyle = targetColWidth
                ? { flex: `0 0 ${targetColWidth}px`, width: `${targetColWidth}px` }
                : { flex: `1 1 ${flexBasis}px`, minWidth: 0 };

              return (
                <div key={dayIdx} className={`shockwave-day${isToday ? ' is-today' : ''}${showTimeCol ? ' has-time-col' : ''}`} style={dayFlexStyle}>
                  {/* 날짜 헤더 */}
                  <div className="sw-day-header-row" style={{ gridTemplateColumns: gridCols }}>
                    {showTimeCol && (
                      <div className="sw-week-header-cell">{weekIdx + 1}주차</div>
                    )}
                    <div className={`${headerClass}${showTimeCol ? ' with-week-col' : ''}`}>
                      {dayInfo.month}월 {dayInfo.day}일 {DAY_NAMES[dayInfo.dow]}요일
                    </div>
                  </div>

                  {/* 치료사 이름 헤더 + 열 리사이즈 */}
                  <div className="sw-therapist-header-wrapper" style={{ position: 'relative' }}>
                    <div className="sw-therapist-header" style={{ gridTemplateColumns: gridCols }}>
                      {showTimeCol && (
                        <div className="sw-time-label" style={{ borderBottom: 'none' }}>시간</div>
                      )}
                      {Array.from({ length: colCount }, (_, ci) => {
                        let nameClass = 'sw-therapist-name';
                        if (dayInfo.isHoliday) nameClass += ' holiday';
                        else if (!dayInfo.isCurrentMonth) nameClass += ' other-month';
                        return (
                          <div key={ci} className={nameClass} style={ci === colCount - 1 ? { borderRight: 'none' } : undefined}>
                            {getTherapistNameForDate(ci, dayInfo.day) || `치료사${ci + 1}`}
                          </div>
                        );
                      })}
                    </div>
                    {/* 열 리사이즈 핸들 오버레이 */}
                    {colCount > 1 && Array.from({ length: colCount - 1 }, (_, ci) => {
                      const ratios = colRatios || Array(colCount).fill(1);
                      const totalR = ratios.reduce((a, b) => a + b, 0);
                      const leftPct = ratios.slice(0, ci + 1).reduce((a, b) => a + b, 0) / totalR * 100;
                      const timeColPx = showTimeCol ? TIME_COL_WIDTH : 0;
                      return (
                        <div
                          key={`col-resize-${ci}`}
                          className="sw-col-resize-handle"
                          style={{
                            position: 'absolute', top: 0, height: '100%',
                            left: `calc(${timeColPx}px + (100% - ${timeColPx}px) * ${leftPct / 100})`,
                            transform: 'translateX(-4px)',
                          }}
                          onMouseDown={(e) => {
                            e.preventDefault(); e.stopPropagation();
                            const cur = colRatios ? [...colRatios] : Array(colCount).fill(1);
                            const cw = e.target.closest('.sw-therapist-header-wrapper').getBoundingClientRect().width - timeColPx;
                            colResizeRef.current = { active: true, colIdx: ci, startX: e.clientX, startRatios: [...cur], containerWidth: cw };
                            const onMove = (ev) => {
                              if (!colResizeRef.current.active) return;
                              const { startRatios: sr, containerWidth: w, colIdx: c, startX } = colResizeRef.current;
                              const d = ev.clientX - startX;
                              const tR = sr.reduce((a, b) => a + b, 0);
                              const dR = (d / w) * tR;
                              const nr = [...sr]; nr[c] = Math.max(0.2, sr[c] + dR); nr[c+1] = Math.max(0.2, sr[c+1] - dR);
                              setColRatios(nr);
                            };
                            const onUp = () => { colResizeRef.current.active = false; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
                            window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
                          }}
                        />
                      );
                    })}
                  </div>

                  {/* 스케줄 바디 */}
                  <div className="sw-schedule-body" style={{ display: 'grid', gridTemplateColumns: gridCols, gridAutoRows: 'var(--sw-row-height)' }}>
                    {daySlots.flatMap((slotInfo, slotRenderIndex) => {
                      const rowIdx = slotInfo.idx;
                      const gridRowStart = slotRenderIndex + 1;
                      const isLastRenderedRow = slotRenderIndex === daySlots.length - 1;
                      const elements = [];
                      
                      // 1. Time Label
                      if (showTimeCol) {
                        elements.push(
                          <div
                            key={`time-${rowIdx}`}
                            className={`sw-time-label${slotInfo.isLunch ? ' lunch' : ''}${slotInfo.disabled ? ' disabled' : ''}`}
                            style={{
                              gridColumn: '1',
                              gridRow: `${gridRowStart}`,
                              borderBottom: isLastRenderedRow ? 'none' : `1px solid ${HORIZONTAL_BORDER_COLOR}`,
                            }}
                          >
                            {slotInfo.label}
                          </div>
                        );
                      }

                      // 2. Cells
                      for (let colIdx = 0; colIdx < colCount; colIdx++) {
                        const key = cellKey(weekIdx, dayIdx, rowIdx, colIdx);
                        const cellData = dayInfo.isCurrentMonth ? renderMemos[key] : null;
                        const content = dayInfo.isCurrentMonth ? normalizeSchedulerVisitSuffix(pendingDisplayValues[key] ?? cellData?.content ?? '') : '';
                        let mergeSpan = dayInfo.isCurrentMonth ? getEffectiveMergeSpan(key, renderMemos) : { rowSpan: 1, colSpan: 1, mergedInto: null };

                        const cellPrescription = cellData?.prescription || mergeSpan?.meta?.prescription || '';
                        const displayData = buildSchedulerCellDisplay(content, mergeSpan);
                          
                          if (mergeSpan.mergedInto) {
                            continue; // 병합된 하위 셀은 묶어서 렌더링 생략
                          }

                          const isEditing = dayInfo.isCurrentMonth && editingCell === key;
                          const isImePreview = dayInfo.isCurrentMonth && imePreviewCell === key;
                          const isSelected = dayInfo.isCurrentMonth && selectedKeys.has(key);
                          const isPrimary = dayInfo.isCurrentMonth && selectedCell && selectedCell.w === weekIdx && selectedCell.d === dayIdx && selectedCell.r === rowIdx && selectedCell.c === colIdx;
                          const gridColumnStart = showTimeCol ? colIdx + 2 : colIdx + 1;

                          // View Span Calculation (in case it spans across omitted rows like lunch)
                          let visualRowSpan = 1;
                          if (mergeSpan.rowSpan > 1) {
                            const endRowIdx = rowIdx + mergeSpan.rowSpan - 1;
                            visualRowSpan = daySlots.filter(s => s.idx >= rowIdx && s.idx <= endRowIdx).length;
                          }

                          let cls = 'sw-cell';
                          if (!dayInfo.isCurrentMonth) cls += ' other-month-bg disabled-cell';
                          else if (dayInfo.isHoliday) cls += ' holiday-bg';
                          
                          if (slotInfo.disabled && !displayData.hasDisplayText) cls += ' disabled';
                          
                          if (cellData?.bg_color === TREATMENT_COMPLETE_BG) cls += ' preserve';
                          if (cellData?.bg_color === TREATMENT_CANCEL_BG) cls += ' cancelled';
                          if (has4060Pattern(content)) cls += ' color-4060';
                          if (isSelected) cls += ' selected';
                          if (isPrimary) cls += ' primary-selected';

                          // Marching Ants Feedback
                          if (clipboardSource?.keys?.has(key)) {
                            cls += ` ants-active ${clipboardSource.mode === 'cut' ? 'ants-red' : 'ants-blue'}`;
                          }

                          const dateKey = `${dayInfo.year}-${dayInfo.month}-${dayInfo.day}`;
                          const therapistName = getTherapistNameForDate(colIdx, dayInfo.day) || '';
                          const workState = getTherapistWorkState(dateKey, therapistName);
                          const staffBlockRule = getStaffScheduleBlockForCell(dateKey, therapistName, slotInfo.time);
                          if (!isSelected && workState === 'off') {
                            cls += ' staff-off';
                          } else if (!isSelected && workState === 'early-leave' && isLastHourSlot(dayInfo, slotInfo.time)) {
                            cls += ' staff-off';
                          }

                          let inlineStyle = {
                            gridColumn: `${gridColumnStart}${mergeSpan.colSpan > 1 ? ` / span ${mergeSpan.colSpan}` : ''}`,
                            gridRow: `${gridRowStart}${visualRowSpan > 1 ? ` / span ${visualRowSpan}` : ''}`,
                            borderBottom: isLastRenderedRow ? 'none' : `1px solid ${HORIZONTAL_BORDER_COLOR}`,
                          };

                          // 마지막 열의 셀은 자체 우측 테두리를 없애서 날짜 경계의 두꺼운 선과 중복되지 않게 함
                          if (colIdx + mergeSpan.colSpan - 1 === colCount - 1) {
                            inlineStyle.borderRight = 'none';
                          }

                          if (cellData?.bg_color) {
                            inlineStyle.backgroundColor = cellData.bg_color;
                          } else if (staffBlockRule?.bg_color) {
                            inlineStyle.backgroundColor = staffBlockRule.bg_color;
                          }
                          
                          if (staffBlockRule?.font_color) {
                            inlineStyle.color = staffBlockRule.font_color;
                          }

                          const prescriptionColor = getPrescriptionColor(cellPrescription, effectivePrescriptionColors);
                          const hasMeaningfulContent = displayData.hasDisplayText && content.trim() && content.trim() !== '\u200B';
                          const noPrescription = hasMeaningfulContent && !cellPrescription;
                          const noBodyPart = hasMeaningfulContent && !String(cellData?.body_part || '').trim();
                          
                          let baseTextColor = undefined;
                          let visitSuffixColor = undefined;

                          if (noPrescription) {
                            baseTextColor = '#b8860b';
                            visitSuffixColor = '#b8860b';
                            cls += ' no-prescription';
                            inlineStyle.color = '#b8860b';
                          } else if (noBodyPart) {
                            baseTextColor = prescriptionColor || undefined;
                            visitSuffixColor = '#b8860b';
                            if (prescriptionColor) {
                              cls += ' has-prescription-color';
                              inlineStyle.color = prescriptionColor;
                              inlineStyle['--prescription-color'] = prescriptionColor;
                            }
                          } else if (prescriptionColor) {
                            baseTextColor = prescriptionColor;
                            visitSuffixColor = prescriptionColor;
                            cls += ' has-prescription-color';
                            inlineStyle.color = prescriptionColor;
                            inlineStyle['--prescription-color'] = prescriptionColor;
                          }

                          // 마스터 셀 중앙 효과
                          if (visualRowSpan > 1 || mergeSpan.colSpan > 1) {
                            inlineStyle.display = 'flex';
                            inlineStyle.alignItems = 'center';
                            inlineStyle.justifyContent = 'center';
                            cls += ' merged-master';
                          }

                          const showInput = isPrimary || isEditing;



                          if (showInput) {
                            elements.push(
                              <div key={key} className={`sw-cell ${isEditing ? 'editing' : ''} ${cls}`} style={inlineStyle}
                                onMouseDown={(e) => {
                                  if (!dayInfo.isCurrentMonth) return;
                                  handleCellMouseDown(weekIdx, dayIdx, rowIdx, colIdx, e);
                                }}
                                onMouseEnter={() => {
                                  if (!dayInfo.isCurrentMonth) return;
                                  handleCellMouseEnter(weekIdx, dayIdx, rowIdx, colIdx);
                                  const reservationTime = getReservationTimeForMemo(cellData, weekIdx, dayIdx, rowIdx);
                                  let text = `⏱ ${reservationTime || slotInfo.label}`;
                                  if (content && content !== '\u200B') text += `\n👤 ${content}`;
                                  if (staffBlockRule) text += `\n근무표: ${staffBlockRule.keyword}`;
                                  if (cellPrescription) text += `\n💊 처방: ${cellPrescription}`;
                                  if (cellData?.body_part) text += `\n🦴 부위: ${cellData.body_part}`;
                                  const memoList = getMemoListFromMergeSpan(cellData?.merge_span);
                                  if (memoList.length > 0) text += `\n📝 메모: ${memoList.join(' / ')}`;
                                  setHoverData({ text });
                                }}
                                onMouseLeave={() => setHoverData(null)}
                                onDoubleClick={() => {
                                  if (!dayInfo.isCurrentMonth) return;
                                  handleCellDoubleClick(weekIdx, dayIdx, rowIdx, colIdx, content);
                                }}
                                onContextMenu={(e) => {
                                  if (!dayInfo.isCurrentMonth) {
                                    e.preventDefault();
                                    return;
                                  }
                                  // 내용이 있을 때만 처방을 설정할 수 있도록 함
                                  if (displayData.hasDisplayText && content.trim() !== '\u200B') {
                                    handleCellContextMenu(e, weekIdx, dayIdx, rowIdx, colIdx, cellPrescription, slotInfo.time || slotInfo.label);
                                  }
                                }}
                              >
                                {!isEditing && !isImePreview && (
                                  <div className="sw-cell-display" style={{ pointerEvents: 'none' }}>
                                    {displayData.hasDisplayText ? (
                                      <span className="sw-cell-main">
                                        <span style={baseTextColor ? { color: baseTextColor } : undefined}>{displayData.baseText}</span>
                                        {displayData.visitSuffix ? <span style={visitSuffixColor ? { color: visitSuffixColor } : undefined}>{displayData.visitSuffix}</span> : null}
                                      </span>
                                    ) : null}
                                  </div>
                                )}
                                <input
                                  ref={(isEditing || isPrimary) ? editInputRef : null}
                                  className="sw-cell-input"
                                  data-hidden-input={!isEditing && !isImePreview ? 'true' : undefined}
                                  defaultValue={isEditing ? editValue : ''}
                                  onMouseDown={(e) => e.stopPropagation()}
                                  onClick={(e) => e.stopPropagation()}
                                  style={(isEditing || isImePreview) ? {
                                    position: 'relative',
                                    width: '100%', height: '100%',
                                    zIndex: 2,
                                    boxSizing: 'border-box'
                                  } : {
                                    position: 'absolute',
                                    top: 0, left: 0,
                                    width: '100%', height: '100%',
                                    opacity: 0,
                                    padding: 0, border: 'none', outline: 'none',
                                    pointerEvents: 'none',
                                    zIndex: 1,
                                  }}
                                  onInput={(e) => {
                                    const nextValue = e.currentTarget.value;
                                    editDraftRef.current = { key, value: nextValue, dirty: true };
                                    if (imeOpenRef.current || e.nativeEvent?.isComposing) return;
                                    scheduleEditDraftAutosave(key, nextValue);
                                    if (!isEditing && e.currentTarget.value) {
                                      promoteFocusedInputToEditor(key, e.currentTarget.value);
                                    }
                                  }}
                                  onBlur={(e) => {
                                    setImePreviewCell((prev) => (prev === key ? null : prev));
                                    if (skipNextEditBlurSaveRef.current) {
                                      skipNextEditBlurSaveRef.current = false;
                                      return;
                                    }
                                    if (contextMenuRef.current?.contains(e.relatedTarget)) return;
                                    if (isEditing) handleCellSave(weekIdx, dayIdx, rowIdx, colIdx, e.target.value);
                                  }}
                                  onKeyDown={e => {
                                    if (isEditing) handleEditKeyDown(e, weekIdx, dayIdx, rowIdx, colIdx);
                                  }}
                                  onCompositionStart={() => {
                                    imeOpenRef.current = true;
                                    setImePreviewCell(key);
                                    editDraftRef.current = { key, value: editInputRef.current?.value || '', dirty: true };
                                  }}
                                  onCompositionEnd={(e) => {
                                    imeOpenRef.current = false;
                                    setImePreviewCell((prev) => (prev === key ? null : prev));
                                    scheduleEditDraftAutosave(key, e.currentTarget.value);
                                    if (!isEditing && e.currentTarget.value) {
                                      promoteFocusedInputToEditor(key, e.currentTarget.value);
                                    }
                                  }}
                                />
                              </div>
                            );
                          } else {
                            elements.push(
                              <div
                                key={key}
                                className={cls}
                                style={inlineStyle}
                                onMouseDown={(e) => handleCellMouseDown(weekIdx, dayIdx, rowIdx, colIdx, e)}
                                onMouseEnter={() => {
                                  handleCellMouseEnter(weekIdx, dayIdx, rowIdx, colIdx);
                                  const reservationTime = getReservationTimeForMemo(cellData, weekIdx, dayIdx, rowIdx);
                                  let text = `⏱ ${reservationTime || slotInfo.label}`;
                                  if (content && content !== '\u200B') text += `\n👤 ${content}`;

                                  if (isSelected && selectedKeys.size > 1 && selectionInfo && selectionInfo.w === weekIdx && selectionInfo.d === dayIdx && selectionInfo.minRow !== selectionInfo.maxRow) {
                                    const slots = getTimeSlotsForDay(dayInfo);
                                    const sStart = slots.find(s => s.idx === selectionInfo.minRow);
                                    const sEnd = slots.find(s => s.idx === selectionInfo.maxRow);
                                    if (sStart && sEnd) {
                                      const t1 = sStart.time || sStart.label;
                                      
                                      const t2_time = new Date(`2000-01-01T${sEnd.time || sEnd.label}:00`);
                                      t2_time.setMinutes(t2_time.getMinutes() + (settings?.interval_minutes || 30));
                                      const t2_hh = String(t2_time.getHours()).padStart(2, '0');
                                      const t2_mm = String(t2_time.getMinutes()).padStart(2, '0');
                                      const t2 = `${t2_hh}:${t2_mm}`;
                                      
                                      const diffMin = (selectionInfo.maxRow - selectionInfo.minRow + 1) * (settings?.interval_minutes || 30);
                                      const hrs = Math.floor(diffMin / 60);
                                      const mns = diffMin % 60;
                                      let dStr = '';
                                      if (hrs > 0) dStr += `${hrs}시간`;
                                      if (mns > 0) dStr += (hrs > 0 ? ' ' : '') + `${mns}분`;
                                      
                                      text = `⏱ ${t1} ~ ${t2} (총 ${dStr})`;
                                      if (content && content !== '\u200B') text += `\n👤 ${content}`;
                                    }
                                  }
                                  if (cellPrescription) text += `\n💊 처방: ${cellPrescription}`;
                                  if (cellData?.body_part) text += `\n🦴 부위: ${cellData.body_part}`;
                                  if (staffBlockRule) text += `\n근무표: ${staffBlockRule.keyword}`;
                                  const memoList = getMemoListFromMergeSpan(cellData?.merge_span);
                                  if (memoList.length > 0) text += `\n📝 메모: ${memoList.join(' / ')}`;
                                  setHoverData({ text });
                                }}
                                onMouseLeave={() => setHoverData(null)}
                                onDoubleClick={() => handleCellDoubleClick(weekIdx, dayIdx, rowIdx, colIdx, content)}
                                onContextMenu={(e) => {
                                  // 내용이 있을 때만 처방을 설정할 수 있도록 함
                                  if (displayData.hasDisplayText && content.trim() !== '\u200B') {
                                    handleCellContextMenu(e, weekIdx, dayIdx, rowIdx, colIdx, cellPrescription, slotInfo.time || slotInfo.label);
                                  }
                                }}
                              >
                                <div className="sw-cell-display">
                                  {displayData.hasDisplayText ? (
                                    <span className="sw-cell-main">
                                      <span style={baseTextColor ? { color: baseTextColor } : undefined}>{displayData.baseText}</span>
                                      {displayData.visitSuffix ? <span style={visitSuffixColor ? { color: visitSuffixColor } : undefined}>{displayData.visitSuffix}</span> : null}
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                            );
                          }
                        }
                      return elements;
                    })}
                  </div>

                  {dayIdx < weekDays.length - 1 && (
                    <div
                      className="sw-day-resize-handle"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const currentDayWidth = e.currentTarget.closest('.shockwave-day').getBoundingClientRect().width;
                        const normalizedDayWidth = showTimeCol
                          ? Math.max(100, currentDayWidth - TIME_COL_WIDTH)
                          : currentDayWidth;
                        dayResizeRef.current = { active: true, startX: e.clientX, startWidth: currentDayWidth, factor: 1 };
                        const onMove = (ev) => {
                          if (!dayResizeRef.current.active) return;
                          const { startX } = dayResizeRef.current;
                          const delta = ev.clientX - startX;
                          const newWidth = Math.max(100, Math.min(600, normalizedDayWidth + delta));
                          setDayColWidth(newWidth);
                        };
                        const onUp = () => {
                          dayResizeRef.current.active = false;
                          window.removeEventListener('mousemove', onMove);
                          window.removeEventListener('mouseup', onUp);
                        };
                        window.addEventListener('mousemove', onMove);
                        window.addEventListener('mouseup', onUp);
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      </div>
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className={`shockwave-context-menu ${contextMenu.isNearRightEdge ? 'submenu-pop-left' : ''}`}
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onKeyDown={(e) => e.stopPropagation()}
          onKeyUp={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {(() => {
            const firstKey = selectedKeys ? Array.from(selectedKeys)[0] : null;
            const currentMemo = firstKey ? (renderMemos[firstKey] || {}) : {};
            const currentPrescription = currentMemo?.prescription || '';
            const currentBodyPart = currentMemo?.body_part || '';
            const currentParts = splitBodyParts(currentBodyPart);
            const { patientChart, patientName } = parseSchedulerPatientIdentity(currentMemo?.content || '');
            const currentKeyParts = firstKey ? firstKey.split('-').map(Number) : null;
            const currentSortKey = currentKeyParts
              ? buildSchedulerMemoSortKey(firstKey, weeks)
              : '';
            let previousPrescription = null;

            const patientBodyPartsMap = new Map();
            Object.entries(renderMemos || {}).forEach(([memoKey, m]) => {
              if (!m?.content) return;
              const { patientChart: mChart, patientName: mName } = parseSchedulerPatientIdentity(m.content);
              const isMatch = (patientChart && mChart && patientChart === mChart) || (patientName && mName && patientName === mName);
              if (isMatch) {
                if (m.body_part) {
                  splitBodyParts(m.body_part).forEach((part) => addBodyPartToMap(patientBodyPartsMap, part));
                }
                if (!m.prescription || memoKey === firstKey) return;
                const memoSortKey = buildSchedulerMemoSortKey(memoKey, weeks);
                if (memoSortKey < currentSortKey && (!previousPrescription || memoSortKey > previousPrescription.sortKey)) {
                  previousPrescription = { value: m.prescription, sortKey: memoSortKey };
                }
              }
            });
            currentParts.forEach((part) => addBodyPartToMap(patientBodyPartsMap, part));
            const availableParts = Array.from(patientBodyPartsMap.values()).sort();
            const previousPrescriptionValue = previousPrescription?.value || '';
            const shockwavePrescriptions = Array.isArray(settings?.prescriptions)
              ? settings.prescriptions.filter(Boolean)
              : [];
            const manualTherapyPrescriptions = Array.isArray(settings?.manual_therapy_prescriptions)
              ? settings.manual_therapy_prescriptions.filter((pres) => pres && !shockwavePrescriptions.includes(pres))
              : [];

            return (
              <>
                <button
                  type="button"
                  className="context-menu-item"
                  data-shortcut-tooltip={`복사 ${shortcutLabels.copy}`}
                  onClick={() => handleContextAction('copy')}
                >
                  복사
                </button>
                <button
                  type="button"
                  className="context-menu-item"
                  data-shortcut-tooltip={`잘라내기 ${shortcutLabels.cut}`}
                  onClick={() => handleContextAction('cut')}
                >
                  잘라내기
                </button>
                <button
                  type="button"
                  className="context-menu-item"
                  data-shortcut-tooltip={`붙여넣기 ${shortcutLabels.paste}`}
                  onClick={() => handleContextAction('paste')}
                >
                  붙여넣기
                </button>
                <div className="context-menu-divider" />
                {!selectionInfo?.isMergedMaster ? (
                  <button
                    type="button"
                    className="context-menu-item"
                    data-shortcut-tooltip={`셀 병합 ${shortcutLabels.merge}`}
                    onClick={() => handleContextAction('merge')}
                    disabled={!selectionInfo?.selectionMultiple}
                  >
                    셀 병합
                  </button>
                ) : (
                  <button
                    type="button"
                    className="context-menu-item"
                    data-shortcut-tooltip={`병합 해제 ${shortcutLabels.merge}`}
                    onClick={() => handleContextAction('unmerge')}
                  >
                    병합 해제
                  </button>
                )}
                <div className="context-menu-divider" />
                <button
                  type="button"
                  className="context-menu-item context-menu-item-complete"
                  data-shortcut-tooltip={`${treatmentCompleteButtonLabel} ${shortcutLabels.complete}`}
                  onClick={() => handleContextAction('complete-toggle')}
                  disabled={!hasCompletableSelection}
                >
                  {treatmentCompleteButtonLabel}
                </button>
                <button
                  type="button"
                  className="context-menu-item context-menu-item-clear-complete"
                  data-shortcut-tooltip={`예약 취소 ${shortcutLabels.cancel}`}
                  onClick={() => handleContextAction('cancel-toggle')}
                  disabled={!hasCompletableSelection}
                >
                  예약 취소
                </button>
                <div className="context-menu-divider" />

                <div className="context-menu-meta-section">
                  <div className="context-menu-item context-menu-item-inline-edit context-menu-meta-item" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} style={{ cursor: 'default' }}>
                    <label className="context-menu-time-editor" style={{ width: '100%', margin: 0, padding: 0 }}>
                      <span className="context-menu-time-label">예약시간 :</span>
                      <span className="context-menu-time-control">
                        <button
                          type="button"
                          className="context-menu-time-reset"
                          aria-label="예약시간 기본값으로 되돌리기"
                          title="기본 시간으로"
                          disabled={!contextMenu?.savedReservationTime}
                          onMouseDown={e => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleContextAction({ type: 'reservationTimeReset' });
                          }}
                        >
                          ↺
                        </button>
                        <input
                          type="text"
                          placeholder={contextMenu?.defaultReservationTime || ''}
                          className="context-menu-time-input"
                          value={contextMenuReservationInput}
                          readOnly
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                              e.preventDefault();
                              const baseTime = contextMenu.defaultReservationTime || getDefaultReservationTime(
                                contextMenu.weekIdx,
                                contextMenu.dayIdx,
                                contextMenu.rowIdx
                              );
                              const nextTime = stepReservationTimeWithinCellBase(
                                contextMenuReservationInput,
                                baseTime,
                                e.key === 'ArrowUp' ? 10 : -10
                              );
                              setContextMenuReservationInput(nextTime);
                              handleContextAction({ type: 'reservationTime', value: nextTime });
                            }
                          }}
                          onMouseDown={e => e.stopPropagation()}
                          onClick={e => e.stopPropagation()}
                        />
                        <span className="context-menu-time-stepper">
                          <button
                            type="button"
                            className="context-menu-time-step"
                            aria-label="현재 셀 기준 예약시간 10분 증가"
                            onMouseDown={e => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              const baseTime = contextMenu.defaultReservationTime || getDefaultReservationTime(
                                contextMenu.weekIdx,
                                contextMenu.dayIdx,
                                contextMenu.rowIdx
                              );
                              const nextTime = stepReservationTimeWithinCellBase(contextMenuReservationInput, baseTime, 10);
                              setContextMenuReservationInput(nextTime);
                              handleContextAction({ type: 'reservationTime', value: nextTime });
                            }}
                          >
                            ▲
                          </button>
                          <button
                            type="button"
                            className="context-menu-time-step"
                            aria-label="현재 셀 기준 예약시간 10분 감소"
                            onMouseDown={e => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              const baseTime = contextMenu.defaultReservationTime || getDefaultReservationTime(
                                contextMenu.weekIdx,
                                contextMenu.dayIdx,
                                contextMenu.rowIdx
                              );
                              const nextTime = stepReservationTimeWithinCellBase(contextMenuReservationInput, baseTime, -10);
                              setContextMenuReservationInput(nextTime);
                              handleContextAction({ type: 'reservationTime', value: nextTime });
                            }}
                          >
                            ▼
                          </button>
                        </span>
                      </span>
                    </label>
                  </div>

                  <div className="context-menu-item has-submenu context-menu-meta-item">
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      처방 : {currentPrescription || '없음'}
                    </span>
                    <div className="context-menu-submenu context-menu-submenu--prescription">
                      <div className="context-menu-editor-panel">
                        <div className="context-menu-inline-column">
                          <div className="context-menu-prescription-row context-menu-prescription-row--dual">
                            <div className="context-menu-prescription-select-group">
                              <label className="context-menu-prescription-select-label">
                                충격파
                                {previousPrescriptionValue && shockwavePrescriptions.includes(previousPrescriptionValue) ? (
                                  <span className="context-menu-current-prescription" style={{ marginLeft: '6px' }}>{previousPrescriptionValue}</span>
                                ) : null}
                              </label>
                              <select
                                className="context-menu-select"
                                value={shockwavePrescriptions.includes(currentPrescription) ? currentPrescription : ''}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  handleContextAction({ type: 'prescription', value: e.target.value || null });
                                }}
                                onMouseDown={e => e.stopPropagation()}
                                onClick={e => e.stopPropagation()}
                              >
                                <option value="">처방 없음</option>
                                {shockwavePrescriptions.map((pres) => (
                                  <option key={pres} value={pres}>{pres}</option>
                                ))}
                              </select>
                            </div>
                            <div className="context-menu-prescription-select-group">
                              <label className="context-menu-prescription-select-label">
                                도수치료
                                {previousPrescriptionValue && manualTherapyPrescriptions.includes(previousPrescriptionValue) ? (
                                  <span className="context-menu-current-prescription" style={{ marginLeft: '6px' }}>{previousPrescriptionValue}</span>
                                ) : null}
                              </label>
                              <select
                                className="context-menu-select"
                                value={manualTherapyPrescriptions.includes(currentPrescription) ? currentPrescription : ''}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  handleContextAction({ type: 'prescription', value: e.target.value || null });
                                }}
                                onMouseDown={e => e.stopPropagation()}
                                onClick={e => e.stopPropagation()}
                              >
                                <option value="">처방 없음</option>
                                {manualTherapyPrescriptions.map((pres) => (
                                  <option key={pres} value={pres}>{pres}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="context-menu-item has-submenu context-menu-meta-item">
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      부위 : {currentParts.join(', ') || '없음'}
                    </span>
                    <div className="context-menu-submenu">
                      <div className="context-menu-editor-panel">
                        <div className="context-menu-inline-column">
                          <div className="context-menu-body-dropdown">
                          <div
                            className="context-menu-body-panel"
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {availableParts.length > 0 ? (
                              <div className="context-menu-checklist">
                                {availableParts.map((part, idx) => {
                                  const isChecked = currentParts.some((p) => normalizeBodyPartKey(p) === normalizeBodyPartKey(part));
                                  return (
                                    <div key={idx} className={`context-menu-check-item${isChecked ? ' is-checked' : ''}`}>
                                      <label className="context-menu-check-label">
                                        <input
                                          type="checkbox"
                                          checked={isChecked}
                                          onChange={(e) => {
                                            e.stopPropagation();
                                            handleContextAction({ type: 'bodyPartToggle', value: part });
                                          }}
                                          onMouseDown={e => e.stopPropagation()}
                                          onClick={e => e.stopPropagation()}
                                        />
                                        <span>{part}</span>
                                      </label>
                                      <button
                                        type="button"
                                        className="context-menu-body-delete"
                                        title={`${part} 삭제`}
                                        onMouseDown={e => e.stopPropagation()}
                                        onClick={(e) => {
                                          e.preventDefault();
                                          e.stopPropagation();
                                          handleContextAction({ type: 'bodyPartDeleteValue', value: part });
                                        }}
                                      >
                                        ×
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : currentParts.length === 0 ? (
                              <div className="context-menu-empty">등록된 부위가 없습니다.</div>
                            ) : null}
                            <div className="context-menu-input-row" style={{ marginTop: '8px' }}>
                              <input
                                type="text"
                                placeholder="새 부위 추가"
                                className="context-menu-input"
                                autoComplete="off"
                                value={contextMenuBodyInput}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  setContextMenuBodyInput(e.target.value);
                                }}
                                onKeyDown={(e) => {
                                  e.stopPropagation();
                                  if (e.nativeEvent?.isComposing || e.keyCode === 229) return;
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    submitContextMenuBodyInput();
                                  }
                                }}
                                onCompositionStart={() => {
                                  imeOpenRef.current = true;
                                }}
                                onCompositionEnd={() => {
                                  imeOpenRef.current = false;
                                }}
                                onMouseDown={e => e.stopPropagation()}
                                onClick={e => e.stopPropagation()}
                              />
                              <button
                                type="button"
                                className="context-menu-inline-button"
                                onMouseDown={e => e.stopPropagation()}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  submitContextMenuBodyInput();
                                }}
                              >
                                추가
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="context-menu-item" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => {
                  e.stopPropagation();
                  setContextMenu(null);
                  handleOpenPatientHistoryModal();
                }}>
                  <div className="context-menu-label" style={{ fontWeight: 600, color: 'var(--brand-primary)' }}>
                    🔍 환자 내역 검색 (Cmd+F)
                  </div>
                </div>

                <div className="context-menu-item context-menu-item-inline-edit context-menu-meta-item" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} style={{ cursor: 'default' }}>
                  <label className="context-menu-visit-editor" style={{ width: '100%', margin: 0, padding: 0 }}>
                    <span style={{ flexShrink: 0, width: '40px' }}>회차 :</span>
                    <span className="context-menu-visit-control" style={{ flexGrow: 1 }}>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9*-]*"
                        autoComplete="off"
                        className="context-menu-visit-input"
                        value={contextMenuVisitInput}
                        onChange={(e) => {
                          e.stopPropagation();
                          setContextMenuVisitInput(e.target.value.replace(/[^\d*-]/g, ''));
                        }}
                        onBlur={(e) => {
                          e.stopPropagation();
                          submitContextMenuVisitInput();
                        }}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.nativeEvent?.isComposing || e.keyCode === 229) return;
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            submitContextMenuVisitInput();
                          }
                          if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            stepContextMenuVisitInput(1);
                          }
                          if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            stepContextMenuVisitInput(-1);
                          }
                        }}
                        onMouseDown={e => e.stopPropagation()}
                        onClick={e => e.stopPropagation()}
                      />
                      <span className="context-menu-visit-stepper">
                        <button
                          type="button"
                          className="context-menu-visit-step"
                          aria-label="회차 증가"
                          onMouseDown={e => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            stepContextMenuVisitInput(1);
                          }}
                        >
                          ▲
                        </button>
                        <button
                          type="button"
                          className="context-menu-visit-step"
                          aria-label="회차 감소"
                          onMouseDown={e => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            stepContextMenuVisitInput(-1);
                          }}
                        >
                          ▼
                        </button>
                      </span>
                    </span>
                  </label>
                </div>

                <div className="context-menu-item has-submenu context-menu-meta-item">
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    메모 : {contextMenuMemoDrafts.length > 0 ? contextMenuMemoDrafts.join(', ') : '없음'}
                  </span>
                  <div className="context-menu-submenu">
                    <div className="context-menu-editor-panel">
                      <div className="context-menu-inline-column">
                        <div className="context-menu-inline-label">
                          <span>
                            메모 목록
                            <span className="context-menu-note-status">
                              ({contextMenuMemoDrafts.length > 0 ? `${contextMenuMemoDrafts.length}개` : '없음'})
                            </span>
                          </span>
                        </div>
                        <div className="context-menu-inline-memo-box">
                          {contextMenuMemoDrafts.length > 0 ? (
                            <div className="context-menu-note-list">
                              {contextMenuMemoDrafts.map((item, index) => (
                                <div key={`${index}-${item}`} className="context-menu-note-item">
                                  <input
                                    type="text"
                                    className="context-menu-input context-menu-input--memo"
                                    value={item}
                                    onChange={(e) => {
                                      e.stopPropagation();
                                      const value = e.target.value;
                                      setContextMenuMemoDrafts((prev) => prev.map((memo, memoIndex) => memoIndex === index ? value : memo));
                                    }}
                                    onBlur={(e) => {
                                      e.stopPropagation();
                                      handleContextAction({ type: 'memoUpdate', index, value: e.target.value });
                                    }}
                                    onMouseDown={e => e.stopPropagation()}
                                    onClick={e => e.stopPropagation()}
                                  />
                                  <button
                                    type="button"
                                    className="context-menu-note-remove"
                                    onMouseDown={e => e.stopPropagation()}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleContextAction({ type: 'memoRemove', index });
                                    }}
                                  >
                                    삭제
                                  </button>
                                </div>
                              ))}
                            </div>
                          ) : null}
                          <div className="context-menu-input-row">
                            <input
                              type="text"
                              placeholder="새 메모 추가"
                              className="context-menu-input"
                              autoComplete="off"
                              value={contextMenuNoteInput}
                              onChange={(e) => {
                                e.stopPropagation();
                                setContextMenuNoteInput(e.target.value);
                              }}
                              onKeyDown={(e) => {
                                e.stopPropagation();
                                if (e.nativeEvent?.isComposing || e.keyCode === 229) return;
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  submitContextMenuNoteInput();
                                }
                              }}
                              onMouseDown={e => e.stopPropagation()}
                              onClick={e => e.stopPropagation()}
                            />
                            <button
                              type="button"
                              className="context-menu-inline-button"
                              onMouseDown={e => e.stopPropagation()}
                              onClick={(e) => {
                                e.stopPropagation();
                                submitContextMenuNoteInput();
                              }}
                            >
                              추가
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                </div>
              </>
            );
          })()}
        </div>
      )}

      <SchedulerPatientSelector
        selector={chartSelector}
        onSelect={handleChartSelectorClose}
        onCancel={() => handleChartSelectorClose(null)}
      />

      {patientHistoryModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 999999 }} onClick={() => setPatientHistoryModalOpen(false)}>
          <div style={{ background: 'var(--bg-primary, #fff)', maxWidth: 800, width: '90%', borderRadius: '12px', boxShadow: '0 8px 32px rgba(0,0,0,0.15)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border-color, #eee)', background: 'var(--bg-secondary, #f8f9fa)' }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600 }}>환자 스케줄 내역 검색</h3>
              <button onClick={() => setPatientHistoryModalOpen(false)} style={{ background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer', padding: '0 4px', color: 'var(--text-secondary, #666)' }}>✕</button>
            </div>
            <div style={{ padding: '16px 20px', maxHeight: '70vh', overflowY: 'auto' }}>
              <div style={{ marginBottom: 16, fontSize: '1.05rem', fontWeight: 600 }}>
                검색 대상: <span style={{ color: 'var(--brand-primary)' }}>{patientHistoryModalData.searchName}</span> {patientHistoryModalData.searchChart ? `(${patientHistoryModalData.searchChart})` : ''}
              </div>
              
              {patientHistoryModalData.loading ? (
                <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-tertiary)' }}>내역을 불러오는 중...</div>
              ) : patientHistoryModalData.logs.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-tertiary)' }}>해당하는 내역이 없습니다.</div>
              ) : (
                <div className="sw-compact-table-wrap">
                  <table className="sw-summary-table sw-compact-summary-table" style={{ width: '100%', margin: 0 }}>
                    <thead>
                      <tr>
                        <th style={{ width: '12%', textAlign: 'center' }}>날짜</th>
                        <th style={{ width: '12%', textAlign: 'center' }}>차트</th>
                        <th style={{ width: '10%', textAlign: 'center' }}>이름</th>
                        <th style={{ width: '12%', textAlign: 'center' }}>처방</th>
                        <th style={{ width: '15%', textAlign: 'center' }}>부위</th>
                        <th style={{ width: '8%', textAlign: 'center' }}>회차</th>
                        <th style={{ width: '21%', textAlign: 'left' }}>메모</th>
                        <th style={{ width: '10%', textAlign: 'center' }}>선택</th>
                      </tr>
                    </thead>
                    <tbody>
                      {patientHistoryModalData.logs.map((log, idx) => (
                        <tr 
                          key={`${log.date}-${idx}`} 
                          onClick={() => handleApplyHistoryToCell(log)}
                          style={{ cursor: 'pointer' }}
                          title="클릭하여 내역을 현재 셀에 적용합니다"
                        >
                          <td style={{ textAlign: 'center' }}>{log.date}</td>
                          <td style={{ textAlign: 'center' }}>{log.chart_number}</td>
                          <td style={{ textAlign: 'center' }}>{log.patient_name}</td>
                          <td style={{ textAlign: 'center', color: log.type === 'manual' ? 'var(--brand-primary)' : 'inherit', fontWeight: log.type === 'manual' ? 600 : 400 }}>
                            {log.prescription}
                          </td>
                          <td style={{ textAlign: 'center' }}>{log.body_part}</td>
                          <td style={{ textAlign: 'center' }}>{log.visit_count ? `${log.visit_count}회` : '-'}</td>
                          <td style={{ textAlign: 'left', color: 'var(--text-secondary)', fontSize: '0.85em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {log.memo}
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <button 
                              className="btn btn-primary" 
                              style={{ padding: '4px 12px', fontSize: '0.85rem', minHeight: 'unset', height: 'auto', borderRadius: '4px' }} 
                              onClick={(e) => { e.stopPropagation(); handleApplyHistoryToCell(log); }}
                            >
                              적용
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {hoverData && (
        <div
          ref={tooltipRef}
          className="sw-custom-tooltip"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            opacity: 0,
          }}
        >
          {hoverData.text.split('\n').map((line, i) => (
            <div key={i} className={i === 0 ? 'sw-custom-tooltip-time' : undefined}>
              {i === 0 && line.startsWith('⏱') ? (
                <>
                  <span className="sw-custom-tooltip-clock">⏱</span>
                  {line.slice(1)}
                </>
              ) : line}
            </div>
          ))}
        </div>
      )}

      {todayShortcutTooltip && (
        <div
          className="sw-shortcut-floating-tooltip"
          style={{
            left: todayShortcutTooltip.x,
            top: todayShortcutTooltip.y,
          }}
        >
          {todayShortcutTooltip.text}
        </div>
      )}

      {showTherapistConfig && (
        <MonthlyTherapistConfig
          year={currentYear}
          month={currentMonth}
          therapists={therapists}
          manualTherapists={manualTherapists}
          monthlyTherapists={monthlyTherapists}
          monthlyManualTherapists={monthlyManualTherapists}
          onSave={saveMonthlyTherapists}
          onSaveRoster={saveTherapistRoster}
          settings={settings}
          onSaveSettings={saveShockwaveSettings}
          onClose={() => setShowTherapistConfig(false)}
        />
      )}
    </>
  );
}
