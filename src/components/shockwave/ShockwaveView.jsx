import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { flushSync } from 'react-dom';
import { useSchedule } from '../../contexts/ScheduleContext';
import { generateShockwaveCalendar, getTodayKST, isSameDate, formatDisplayDate } from '../../lib/calendarUtils';
import { supabase } from '../../lib/supabaseClient';
import { has4060Pattern, incrementSessionCount, normalizeNameForMatch } from '../../lib/memoParser';
import { useToast } from '../common/Toast';

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
const HORIZONTAL_BORDER_COLOR = '#b7b7b7';
const SHOCKWAVE_DAY_COL_WIDTH_KEY = 'shockwave-day-col-width';
const SHOCKWAVE_COL_RATIOS_KEY = 'shockwave-col-ratios';

export default function ShockwaveView({ therapists, settings, memos = {}, onLoadMemos, onSaveMemo, holidays, staffMemos = {} }) {
  const { currentYear, currentMonth, saveShockwaveMemosBulk } = useSchedule();
  const { addToast } = useToast();
  const viewRef = useRef(null);
  const dragSelectionRef = useRef(null);

  // ── 셀 조작 상태 (구글 시트 방식) ──
  const [selectedCell, setSelectedCell] = useState(null);     // { w, d, r, c }
  const [rangeEnd, setRangeEnd] = useState(null);             // { w, d, r, c } (Shift 선택 끝점)
  const [selectedKeys, setSelectedKeys] = useState(() => new Set());
  const [editingCell, setEditingCell] = useState(null);       // "w-d-r-c" 키 문자열
  const [editValue, setEditValue] = useState('');
  const [pendingDisplayValues, setPendingDisplayValues] = useState({});
  const clipboardRef = useRef({ content: '', mode: null });   // mode: 'copy' | 'cut'
  const [clipboardSource, setClipboardSource] = useState(null); // { keys: Set, mode: 'copy'|'cut' }
  const [undoStack, setUndoStack] = useState([]);
  const [contextMenu, setContextMenu] = useState(null);

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

  const tooltipRef = useRef(null);
  const [hoverData, setHoverData] = useState(null);
  const [chartSelector, setChartSelector] = useState(null);
  const contextMenuRef = useRef(null);
  const editInputRef = useRef(null);
  const imeOpenRef = useRef(false);

  const colCount = Math.max(1, therapists.length);
  const therapistShiftByDate = useMemo(() => {
    const map = {};

    Object.values(staffMemos || {}).forEach((item) => {
      if (!item?.content) return;

      const dateKey = `${item.year}-${item.month}-${item.day}`;
      const text = String(item.content).trim();
      if (!/pt\s*\//i.test(text)) return;

      const isNightShift = /야간\s*pt\s*\//i.test(text) || /^야\s*pt\s*\//i.test(text);
      const slashIndex = text.indexOf('/');
      if (slashIndex < 0) return;

      const names = text
        .slice(slashIndex + 1)
        .split(',')
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
  }, [staffMemos]);

  const isLastHourSlot = useCallback((dayInfo, slotTime) => {
    if (!slotTime || !settings?.end_time) return false;

    const dayOverride = settings.day_overrides?.[dayInfo.dow] || {};
    const effectiveEnd = (dayOverride.end_time || settings.end_time || '18:00:00').slice(0, 5);
    const [endHour, endMinute] = effectiveEnd.split(':').map(Number);
    const endTotal = endHour * 60 + endMinute;
    const [slotHour, slotMinute] = String(slotTime).split(':').map(Number);
    const slotTotal = slotHour * 60 + slotMinute;

    return slotTotal >= (endTotal - 60) && slotTotal < endTotal;
  }, [settings]);

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
    const dayOv = settings?.day_overrides?.[dow] || {};
    const dayStart = dayOv.start_time || (settings?.start_time?.substring(0, 5)) || '09:00';
    const dayEnd = dayOv.end_time || (settings?.end_time?.substring(0, 5)) || '18:00';
    
    const skipLunch = !dayInfo.isCurrentMonth || dayInfo.isHoliday;
    const noLunch = dayOv.no_lunch === true || skipLunch;
    
    const lunchStart = noLunch ? null : (dayOv.lunch_start || null);
    const lunchEnd = noLunch ? null : (dayOv.lunch_end || null);

    const result = [];
    let lunchAdded = false;

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
  }, [baseTimeSlots, settings]);

  const today = getTodayKST();
  const weeks = useMemo(() => {
    return generateShockwaveCalendar(currentYear, currentMonth, holidays);
  }, [currentYear, currentMonth, holidays]);

  const shouldAutoFormatSchedulerName = useCallback((value) => {
    const text = String(value || '').trim();
    if (!text) return false;
    if (text.includes('/')) return false;
    if (/[()*]/.test(text)) return false;
    if (has4060Pattern(text)) return false;
    if (/^\d+$/.test(text)) return false;
    if (/^(휴무|연차|반차|출근|퇴근|근무|야간|오전|오후)$/u.test(text)) return false;
    return true;
  }, []);

  const pickChartOption = useCallback((options, rawName) => {
    return new Promise((resolve) => {
      setChartSelector({ options, rawName, resolve });
    });
  }, []);

  const parseSchedulerPatientText = useCallback((text) => {
    const raw = String(text || '').trim();
    if (!raw.includes('/')) return null;

    const match = raw.match(/^([^/]+)\/(.+?)(\((-|\d+)\)|\*)?$/);
    if (!match) return null;

    const chartNumber = String(match[1] || '').trim();
    const namePart = String(match[2] || '').trim();
    const suffixToken = match[3] || '';
    const suffixValue = match[4] || '';
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

  const buildSchedulerAutoText = useCallback(async (w, d, nextValue) => {
    const rawName = String(nextValue || '').trim();
    if (!shouldAutoFormatSchedulerName(rawName)) return rawName;
    const normalizedName = normalizeNameForMatch(rawName);
    const cleanDisplayName = String(rawName).replace(/\(-\)/g, '').trim();
    if (!normalizedName) return rawName;

    const dayInfo = weeks[w]?.[d];
    if (!dayInfo) return rawName;
    const targetDate = `${dayInfo.year}-${String(dayInfo.month).padStart(2, '0')}-${String(dayInfo.day).padStart(2, '0')}`;

    const schedulerCandidates = Object.entries(memos || [])
      .map(([key, memo]) => {
        const [mw, md] = key.split('-').map(Number);
        const memoDay = weeks[mw]?.[md];
        if (!memoDay) return null;
        const memoDate = `${memoDay.year}-${String(memoDay.month).padStart(2, '0')}-${String(memoDay.day).padStart(2, '0')}`;
        if (memoDate >= targetDate) return null;

        const parsed = parseSchedulerPatientText(memo?.content);
        if (!parsed || parsed.normalizedName !== normalizedName) return null;

        return { ...parsed, memoDate };
      })
      .filter(Boolean)
      .sort((a, b) => b.memoDate.localeCompare(a.memoDate));

    if (schedulerCandidates.length > 0) {
      const latest = schedulerCandidates[0];
      if (latest.suffixToken === '(-)') {
        return `${latest.chartNumber}/${cleanDisplayName}(-)`;
      }
      if (latest.suffixToken === '*') {
        return `${latest.chartNumber}/${cleanDisplayName}(2)`;
      }
      if (/^\(\d+\)$/.test(latest.suffixToken)) {
        const nextVisit = (parseInt(latest.suffixValue || '0', 10) || 0) + 1;
        return `${latest.chartNumber}/${cleanDisplayName}(${nextVisit})`;
      }
      return `${latest.chartNumber}/${cleanDisplayName}`;
    }

    const { data, error } = await supabase
      .from('shockwave_patient_logs')
      .select('patient_name, chart_number, visit_count, date')
      .lt('date', targetDate)
      .in('patient_name', [cleanDisplayName, `${cleanDisplayName}*`, rawName, `${rawName}*`])
      .order('date', { ascending: false });

    if (error) {
      console.error('Failed to lookup patient chart history:', error);
      return rawName;
    }

    const matches = (data || []).filter((item) => normalizeNameForMatch(item.patient_name) === normalizedName);
    if (matches.length === 0) return rawName;

    const chartMap = new Map();
    matches.forEach((item) => {
      const chartNumber = String(item.chart_number || '').trim();
      if (!chartNumber) return;
      const current = chartMap.get(chartNumber);
      if (!current) {
        chartMap.set(chartNumber, item);
        return;
      }

      if ((item.date || '') > (current.date || '')) {
        chartMap.set(chartNumber, item);
        return;
      }

      if ((item.date || '') === (current.date || '')) {
        const currentVisit = parseInt(current.visit_count || '0', 10) || 0;
        const nextVisit = parseInt(item.visit_count || '0', 10) || 0;
        if (nextVisit > currentVisit) chartMap.set(chartNumber, item);
      }
    });

    const options = Array.from(chartMap.entries())
      .map(([chartNumber, item]) => {
        const lastVisit = parseInt(item.visit_count || '0', 10) || 0;
        return {
          chartNumber,
          nextVisit: lastVisit > 0 ? lastVisit + 1 : 1,
          lastDate: item.date || '',
        };
      })
      .sort((a, b) => {
        if (a.lastDate !== b.lastDate) return b.lastDate.localeCompare(a.lastDate);
        return a.chartNumber.localeCompare(b.chartNumber);
      });

    if (options.length === 0) return rawName;

    let selected = options[0];
    if (options.length > 1) {
      selected = await pickChartOption(options, rawName);
      if (!selected) return rawName;
    }

    return `${selected.chartNumber}/${cleanDisplayName}(${selected.nextVisit})`;
  }, [memos, parseSchedulerPatientText, pickChartOption, shouldAutoFormatSchedulerName, weeks]);

  useEffect(() => {
    onLoadMemos(currentYear, currentMonth);
  }, [currentYear, currentMonth, onLoadMemos]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (dayColWidth && dayColWidth > 0) window.localStorage.setItem(SHOCKWAVE_DAY_COL_WIDTH_KEY, String(dayColWidth));
    else window.localStorage.removeItem(SHOCKWAVE_DAY_COL_WIDTH_KEY);
  }, [dayColWidth]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (Array.isArray(colRatios) && colRatios.length > 0) {
      window.localStorage.setItem(SHOCKWAVE_COL_RATIOS_KEY, JSON.stringify(colRatios));
    } else {
      window.localStorage.removeItem(SHOCKWAVE_COL_RATIOS_KEY);
    }
  }, [colRatios]);

  const recordUndo = (action) => {
    setUndoStack(prev => [action, ...prev].slice(0, 50));
  };

  const doUndo = async () => {
    const action = undoStack[0];
    if (!action) return;
    setUndoStack(prev => prev.slice(1));

    if (action.type === 'bulk-edit') {
      await saveShockwaveMemosBulk(action.oldMemos);
    } else if (action.type === 'edit') {
      const { w, d, r, c, oldContent, oldBg } = action;
      await onSaveMemo(currentYear, currentMonth, w, d, r, c, oldContent, oldBg);
    }
  };

  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
        const activeItem = document.activeElement;
        if (activeItem?.tagName === 'INPUT' || activeItem?.tagName === 'TEXTAREA') return;
        e.preventDefault();
        doUndo();
      } else if (e.key === 'Escape') {
        setClipboardSource(null);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown, true);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown, true);
  }, [undoStack, doUndo]);

  useEffect(() => {
    if (!Array.isArray(colRatios) || colRatios.length === colCount) return;
    setColRatios(Array(colCount).fill(1));
  }, [colRatios, colCount]);

  // ── 셀 키 헬퍼 ──
  const cellKey = (w, d, r, c) => `${w}-${d}-${r}-${c}`;
  const dayKey = (w, d) => `${w}-${d}`;

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

  const normalizeKeysToMergeMasters = useCallback((keys) => {
    const normalized = new Set();
    if (!keys) return normalized;

    Array.from(keys).forEach((key) => {
      const mergeSpan = memos[key]?.merge_span;
      if (mergeSpan?.mergedInto) normalized.add(mergeSpan.mergedInto);
      else normalized.add(key);
    });

    return normalized;
  }, [memos]);

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
  }, []);

  const selectSingleCell = useCallback((cell) => {
    const key = cellKey(cell.w, cell.d, cell.r, cell.c);
    setSelectedCell(cell);
    setRangeEnd(null);
    setSelectedKeys(new Set([key]));
  }, []);

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
    const cell = { w, d, r, c };
    const key = cellKey(w, d, r, c);
    const isMeta = e?.metaKey || e?.ctrlKey;

    if (e?.button !== 0) return;
    viewRef.current?.focus();

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
    setEditingCell(null);
  }, [selectedCell, buildRangeKeys, selectSingleCell]);

  const handleCellMouseEnter = useCallback((w, d, r, c) => {
    if (!dragSelectionRef.current) return;
    updateDraggedSelection({ w, d, r, c });
  }, [updateDraggedSelection]);

  // ── 더블 클릭 = 편집 모드 진입 ──
  const handleCellDoubleClick = useCallback((w, d, r, c, content) => {
    const key = cellKey(w, d, r, c);
    viewRef.current?.focus();
    setEditingCell(key);
    setEditValue(content || '');
    selectSingleCell({ w, d, r, c });
  }, [selectSingleCell]);

  // ── 편집 저장 ──
  const handleCellSave = useCallback(async (w, d, r, c, nextValue = editValue) => {
    const key = cellKey(w, d, r, c);
    const oldContent = memos[key]?.content || '';
    const immediateContent = String(nextValue ?? '').trim();
    setPendingDisplayValues((prev) => ({ ...prev, [key]: immediateContent }));
    setEditingCell(null);
    const newContent = (await buildSchedulerAutoText(w, d, nextValue)).trim();

    if (newContent !== immediateContent) {
      setPendingDisplayValues((prev) => ({ ...prev, [key]: newContent }));
    }

    if (newContent === oldContent) {
      setPendingDisplayValues((prev) => {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return;
    }
    setPendingDisplayValues((prev) => ({ ...prev, [key]: newContent }));
    recordUndo({ type: 'edit', w, d, r, c, oldContent, oldBg: memos[key]?.bg_color });
    const success = await onSaveMemo(currentYear, currentMonth, w, d, r, c, newContent);
    setPendingDisplayValues((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    if (!success) addToast('저장 실패', 'error');
  }, [editValue, currentYear, currentMonth, memos, onSaveMemo, addToast, buildSchedulerAutoText]);

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
    const payload = [];
    for (const key of affectedKeys) {
      const [w, d, r, c] = key.split('-').map(Number);
      const memo = memos[key];
      oldMemos.push({
        year: currentYear,
        month: currentMonth,
        week_index: w,
        day_index: d,
        row_index: r,
        col_index: c,
        content: memo?.content || '',
        bg_color: memo?.bg_color || null,
        merge_span: memo?.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null },
      });
      payload.push({
        year: currentYear,
        month: currentMonth,
        week_index: w,
        day_index: d,
        row_index: r,
        col_index: c,
        content: '',
        bg_color: null,
        merge_span: { rowSpan: 1, colSpan: 1, mergedInto: null },
      });
    }
    if (payload.length > 0) {
      recordUndo({ type: 'bulk-edit', oldMemos });
      await saveShockwaveMemosBulk(payload);
    }
  }, [currentYear, currentMonth, memos, saveShockwaveMemosBulk]);

  const tryMergeSelection = useCallback(() => {
    const selection = computeSelectionInfo();
    if (!selection) return;
    const { w, d, minRow, minCol, maxRow, maxCol, masterKey } = selection;
    const isAlreadyMerged = selection.isMergedMaster;
    if (!isAlreadyMerged && !selection.selectionMultiple) return;

    const payload = [];
    if (isAlreadyMerged) {
      for (let row = minRow; row <= maxRow; row++) {
        for (let col = minCol; col <= maxCol; col++) {
          const k = cellKey(w, d, row, col);
          payload.push({
            year: currentYear, month: currentMonth, week_index: w, day_index: d, row_index: row, col_index: col,
            merge_span: { rowSpan: 1, colSpan: 1, mergedInto: null },
            content: memos[k]?.content || ''
          });
        }
      }
    } else {
      for (let row = minRow; row <= maxRow; row++) {
        for (let col = minCol; col <= maxCol; col++) {
          const k = cellKey(w, d, row, col);
          const isMaster = (k === masterKey);
          payload.push({
            year: currentYear, month: currentMonth, week_index: w, day_index: d, row_index: row, col_index: col,
            merge_span: isMaster
              ? { rowSpan: maxRow - minRow + 1, colSpan: maxCol - minCol + 1, mergedInto: null }
              : { rowSpan: 1, colSpan: 1, mergedInto: masterKey },
            content: isMaster ? (memos[k]?.content || '') : ''
          });
        }
      }
    }

    if (payload.length > 0) {
      saveShockwaveMemosBulk(payload);
      addToast(isAlreadyMerged ? '병합이 해제되었습니다' : '셀이 병합되었습니다', 'info');
    }
    setContextMenu(null);
  }, [computeSelectionInfo, currentYear, currentMonth, memos, saveShockwaveMemosBulk, addToast, cellKey]);

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
      return String(memo?.content || '').trim() && memo?.bg_color === '#ffe599';
    });
  }, [selectedKeys, memos, normalizeKeysToMergeMasters]);

  // 날짜 비교 헬퍼: 원본(w,d)와 대상(w,d)의 실제 날짜를 비교
  const isLaterDate = useCallback((srcW, srcD, dstW, dstD) => {
    const srcDay = weeks[srcW]?.[srcD];
    const dstDay = weeks[dstW]?.[dstD];
    if (!srcDay || !dstDay) return false;
    const srcDate = new Date(srcDay.year, srcDay.month - 1, srcDay.day);
    const dstDate = new Date(dstDay.year, dstDay.month - 1, dstDay.day);
    return dstDate > srcDate;
  }, [weeks]);

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
          rowOffset,
          colOffset,
          content: memo?.content || '',
          bg_color: memo?.bg_color || null,
          merge_span: memo?.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null },
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

  const pasteClipboardSelection = useCallback(async (clip, target) => {
    if (!clip?.cells?.length) return false;

    const payload = [];
    const isCrossDate = clip.srcW !== target.w || clip.srcD !== target.d;
    const sourceMasterToTargetMaster = new Map();

    for (const row of clip.cells) {
      for (const cell of row) {
        const targetRow = target.r + cell.rowOffset;
        const targetCol = target.c + cell.colOffset;
        if (targetRow >= baseTimeSlots.length || targetCol >= colCount) continue;

        let nextContent = cell.content || '';
        if (clip.mode === 'copy' && isCrossDate && nextContent) {
          nextContent = incrementSessionCount(nextContent);
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
          nextMergeSpan = { rowSpan: 1, colSpan: 1, mergedInto: mappedMasterKey };
        } else if (mergeSpan?.rowSpan > 1 || mergeSpan?.colSpan > 1) {
          const mappedMasterKey = cellKey(target.w, target.d, targetRow, targetCol);
          sourceMasterToTargetMaster.set(sourceCellKey, mappedMasterKey);
          nextMergeSpan = {
            rowSpan: mergeSpan.rowSpan || 1,
            colSpan: mergeSpan.colSpan || 1,
            mergedInto: null,
          };
        }

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
        });
      }
    }

    if (payload.length === 0) return false;
    await saveShockwaveMemosBulk(payload);
    return true;
  }, [baseTimeSlots.length, colCount, currentYear, currentMonth, saveShockwaveMemosBulk]);

  const handleCopySelection = useCallback(() => {
    const clip = buildClipboardSelection();
    if (!clip) return;
    clipboardRef.current = { ...clip, mode: 'copy' };
    setClipboardSource({ keys: new Set(clip.sourceKeys), mode: 'copy' });
    try { navigator.clipboard.writeText(clip.plainText); } catch (_) {}
    addToast('복사됨', 'info');
    setContextMenu(null);
  }, [buildClipboardSelection, addToast]);

  const handleCutSelection = useCallback(async () => {
    const clip = buildClipboardSelection();
    if (!clip) return;
    clipboardRef.current = { ...clip, mode: 'cut' };
    setClipboardSource({ keys: new Set(clip.sourceKeys), mode: 'cut' });
    try { navigator.clipboard.writeText(clip.plainText); } catch (_) {}
    addToast('잘라내기됨 (붙여넣기 시 원본 삭제)', 'info');
    setContextMenu(null);
  }, [buildClipboardSelection, addToast]);

  const handlePasteSelection = useCallback(async () => {
    if (!selectedCell) return;
    const clip = clipboardRef.current;
    if (!clip?.cells?.length) {
      setContextMenu(null);
      return;
    }

    // Record undo status for target area before paste
    const oldMemos = [];
    const targetRowCount = clip.rowCount;
    const targetColCountInRange = clip.colCount;
    for (let ro = 0; ro < targetRowCount; ro++) {
      for (let co = 0; co < targetColCountInRange; co++) {
        const tr = selectedCell.r + ro;
        const tc = selectedCell.c + co;
        if (tr >= baseTimeSlots.length || tc >= colCount) continue;
        const k = cellKey(selectedCell.w, selectedCell.d, tr, tc);
        const m = memos[k];
        oldMemos.push({
          year: currentYear, month: currentMonth,
          week_index: selectedCell.w, day_index: selectedCell.d,
          row_index: tr, col_index: tc,
          content: m?.content || '', bg_color: m?.bg_color || null,
          merge_span: m?.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null }
        });
      }
    }

    const success = await pasteClipboardSelection(clip, selectedCell);
    if (!success) {
      setContextMenu(null);
      return;
    }

    // Delayed cut execution
    if (clip.mode === 'cut' && clipboardSource?.keys) {
      const sourcePayload = Array.from(clipboardSource.keys).map(k => {
        const [w, d, r, c] = k.split('-').map(Number);
        const m = memos[k];
        // Also record source old state for undo
        oldMemos.push({
          year: currentYear, month: currentMonth,
          week_index: w, day_index: d,
          row_index: r, col_index: c,
          content: m?.content || '', bg_color: m?.bg_color || null,
          merge_span: m?.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null }
        });
        return {
          year: currentYear, month: currentMonth,
          week_index: w, day_index: d,
          row_index: r, col_index: c,
          content: '', bg_color: null,
          merge_span: { rowSpan: 1, colSpan: 1, mergedInto: null }
        };
      });
      await saveShockwaveMemosBulk(sourcePayload);
      clipboardRef.current = { ...clip, mode: 'copy' }; // Change mode to copy after cut-paste
    }

    if (clipboardSource) {
      setClipboardSource(null);
    }
    
    recordUndo({ type: 'bulk-edit', oldMemos });
    addToast('붙여넣기 완료', 'success');
    setContextMenu(null);
  }, [selectedCell, pasteClipboardSelection, addToast, clipboardSource, memos, cellKey, currentYear, currentMonth, baseTimeSlots.length, colCount, saveShockwaveMemosBulk]);

  const buildTreatmentCompletePayload = useCallback((mode) => {
    if (!selectedKeys || selectedKeys.size === 0) return null;

    const effectiveKeys = normalizeKeysToMergeMasters(selectedKeys);
    const oldMemos = [];
    const payload = [];
    const shouldClearSelection =
      mode === 'toggle'
        ? Array.from(effectiveKeys).some((key) => memos[key]?.bg_color === '#ffe599')
        : mode === 'clear';

    Array.from(effectiveKeys).forEach((key) => {
      const [w, d, r, c] = key.split('-').map(Number);
      const memo = memos[key];
      const content = memo?.content || '';

      if (!String(content).trim()) return;

      const isCompleted = memo?.bg_color === '#ffe599';
      const nextBgColor = shouldClearSelection ? null : '#ffe599';

      if (isCompleted === (nextBgColor === '#ffe599')) return;

      oldMemos.push({
        year: currentYear,
        month: currentMonth,
        week_index: w,
        day_index: d,
        row_index: r,
        col_index: c,
        content,
        bg_color: memo?.bg_color || null,
      });

      payload.push({
        year: currentYear,
        month: currentMonth,
        week_index: w,
        day_index: d,
        row_index: r,
        col_index: c,
        content,
        bg_color: nextBgColor,
      });
    });

    if (payload.length === 0) return null;
    return { oldMemos, payload };
  }, [selectedKeys, memos, currentYear, currentMonth, normalizeKeysToMergeMasters]);

  const applyTreatmentCompleteToSelection = useCallback(async (mode) => {
    const batch = buildTreatmentCompletePayload(mode);
    if (!batch) {
      setContextMenu(null);
      return false;
    }

    recordUndo({ type: 'bulk-edit', oldMemos: batch.oldMemos });
    const success = await saveShockwaveMemosBulk(batch.payload);
    if (!success) {
      addToast(
        mode === 'complete'
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
  }, [buildTreatmentCompletePayload, saveShockwaveMemosBulk, addToast]);

  const handleMarkTreatmentComplete = useCallback(async () => {
    await applyTreatmentCompleteToSelection('complete');
  }, [applyTreatmentCompleteToSelection]);

  const handleClearTreatmentComplete = useCallback(async () => {
    await applyTreatmentCompleteToSelection('clear');
  }, [applyTreatmentCompleteToSelection]);

  const handleToggleTreatmentComplete = useCallback(async () => {
    await applyTreatmentCompleteToSelection('toggle');
  }, [applyTreatmentCompleteToSelection]);

  const handleContextAction = useCallback((action) => {
    if (action === 'copy') handleCopySelection();
    if (action === 'cut') handleCutSelection();
    if (action === 'paste') handlePasteSelection();
    if (action === 'complete') handleMarkTreatmentComplete();
    if (action === 'clear-complete') handleClearTreatmentComplete();
    if (action === 'merge' || action === 'unmerge') tryMergeSelection();
  }, [handleCopySelection, handleCutSelection, handlePasteSelection, handleMarkTreatmentComplete, handleClearTreatmentComplete, tryMergeSelection]);

  const beginEditingCell = useCallback((key, nextValue, imeStart = false) => {
    imeOpenRef.current = imeStart;
    flushSync(() => {
      setEditingCell(key);
      setEditValue(nextValue);
    });
    editInputRef.current?.focus();
  }, []);

  // ── 키보드 이벤트 핸들러 (구글 시트 방식) ──
  const handleKeyDown = useCallback((e) => {
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

    const isMeta = e.metaKey || e.ctrlKey;

    // Enter → 편집 모드 진입
    if (e.key === 'Enter') {
      e.preventDefault();
      const key = cellKey(w, d, r, c);
      setEditingCell(key);
      setEditValue(memos[key]?.content || '');
      return;
    }

    // F2 → 편집 모드 진입
    if (e.key === 'F2') {
      e.preventDefault();
      const key = cellKey(w, d, r, c);
      setEditingCell(key);
      setEditValue(memos[key]?.content || '');
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

    // Ctrl/Cmd+G → 치료 완료 토글
    if (isMeta && e.code === 'KeyG') {
      e.preventDefault();
      e.stopPropagation();
      handleToggleTreatmentComplete();
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

    // Cmd+V → 붙여넣기
    if (isMeta && e.code === 'KeyV') {
      e.preventDefault();
      handlePasteSelection();
      return;
    }

    // 일반 문자 입력 → 편집 모드 진입 (기존 내용 대체)
    if ((e.key.length === 1 || e.key === 'Process' || e.keyCode === 229) && !isMeta && !e.altKey) {
      const key = cellKey(w, d, r, c);
      beginEditingCell(key, '', true);
      return;
    }
  }, [selectedCell, editingCell, selectedKeys, deleteCells, buildRangeKeys, selectSingleCell, getAdjacentCell, beginEditingCell, handleCopySelection, handleCutSelection, handlePasteSelection, handleToggleTreatmentComplete, tryMergeSelection]);

  const dismissContextMenu = useCallback(() => setContextMenu(null), []);

  // 키보드 이벤트 등록

  useEffect(() => {
    const el = viewRef.current;
    if (el) {
      el.addEventListener('keydown', handleKeyDown);
      return () => el.removeEventListener('keydown', handleKeyDown);
    }
  }, [handleKeyDown]);

  useEffect(() => {
    const handleWindowKeyDown = (event) => {
      const target = event.target;
      const isEditableTarget =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable;

      if (isEditableTarget) return;
      handleKeyDown(event);
    };

    window.addEventListener('keydown', handleWindowKeyDown, true);
    return () => window.removeEventListener('keydown', handleWindowKeyDown, true);
  }, [handleKeyDown]);

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
      const maxX = Math.max(VIEWPORT_GAP, window.innerWidth - MENU_WIDTH - VIEWPORT_GAP);
      const maxY = Math.max(VIEWPORT_GAP, window.innerHeight - MENU_HEIGHT - VIEWPORT_GAP);
      setContextMenu({
        x: Math.min(event.clientX, maxX),
        y: Math.min(event.clientY, maxY),
      });
    };
    el.addEventListener('contextmenu', handleContext);
    return () => el.removeEventListener('contextmenu', handleContext);
  }, [selectedKeys, editingCell]);

  useEffect(() => {
    if (!contextMenu || !contextMenuRef.current) return;
    const rect = contextMenuRef.current.getBoundingClientRect();
    const VIEWPORT_GAP = 12;
    let nextX = contextMenu.x;
    let nextY = contextMenu.y;

    if (rect.right > window.innerWidth - VIEWPORT_GAP) {
      nextX = Math.max(VIEWPORT_GAP, window.innerWidth - rect.width - VIEWPORT_GAP);
    }
    if (rect.bottom > window.innerHeight - VIEWPORT_GAP) {
      nextY = Math.max(VIEWPORT_GAP, window.innerHeight - rect.height - VIEWPORT_GAP);
    }

    if (nextX !== contextMenu.x || nextY !== contextMenu.y) {
      setContextMenu((prev) => prev ? { ...prev, x: nextX, y: nextY } : prev);
    }
  }, [contextMenu]);

  useEffect(() => {
    if (contextMenu && (!selectedKeys || selectedKeys.size === 0)) {
      setContextMenu(null);
    }
  }, [contextMenu, selectedKeys]);

  useEffect(() => {
    const handleWindowClick = () => setContextMenu(null);
    window.addEventListener('click', handleWindowClick);
    return () => window.removeEventListener('click', handleWindowClick);
  }, []);

  useEffect(() => {
    if (!editingCell || !editInputRef.current) return;
    requestAnimationFrame(() => {
      editInputRef.current?.focus();
      if (!imeOpenRef.current && document.activeElement === editInputRef.current) {
        const len = editInputRef.current.value?.length || 0;
        editInputRef.current.setSelectionRange(len, len);
      }
    });
  }, [editingCell]);

  // 편집 완료 후 아래로 이동
  const handleEditKeyDown = useCallback((e, w, d, r, c) => {
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
  }, [baseTimeSlots.length, colCount, selectSingleCell]);

  const handleContextMerge = useCallback(() => {
    tryMergeSelection();
  }, [tryMergeSelection]);

  const handleChartSelectorClose = useCallback((selected) => {
    if (!chartSelector) return;
    chartSelector.resolve(selected || null);
    setChartSelector(null);
  }, [chartSelector]);

  return (
    <>
      <div 
        className="shockwave-view animate-fade-in" 
        ref={viewRef} 
        tabIndex={0} 
        style={{ outline: 'none' }}
        onMouseLeave={() => setHoverData(null)}
        onMouseMove={(e) => {
          if (tooltipRef.current) {
            tooltipRef.current.style.left = `${e.clientX + 14}px`;
            tooltipRef.current.style.top = `${e.clientY + 14}px`;
            tooltipRef.current.style.opacity = hoverData ? '1' : '0';
          }
        }}
      >
      {weeks.map((weekDays, weekIdx) => (
        <div key={weekIdx} className="shockwave-week">
          <div className="shockwave-week-label">
            📅 {weekIdx + 1}주차
          </div>
          <div className="shockwave-days" style={{ position: 'relative' }}>
            {weekDays.map((dayInfo, dayIdx) => {
              const isToday = isSameDate(dayInfo.date, today);
              const thisDayKey = dayKey(weekIdx, dayIdx);
              const daySlots = getTimeSlotsForDay(dayInfo);
              // 첫 번째 요일에만 시간 열 표사
              const showTimeCol = dayIdx === 0;
              const therapistCols = colRatios
                ? colRatios.map(r => `minmax(0, ${r}fr)`).join(' ')
                : `repeat(${colCount}, minmax(0, 1fr))`;
              const gridCols = showTimeCol
                ? `46px ${therapistCols}`
                : therapistCols;

              let headerClass = 'sw-day-header';
              if (dayInfo.isHoliday) headerClass += ' holiday';
              else if (!dayInfo.isCurrentMonth) headerClass += ' other-month';
              else if (isToday) headerClass += ' today';
              else if (dayInfo.dow === 6) headerClass += ' saturday';

              const targetColWidth = showTimeCol && dayColWidth ? dayColWidth + 46 : dayColWidth;
              const flexBasis = showTimeCol ? 46 : 0;
              const dayFlexStyle = targetColWidth
                ? { flex: `0 0 ${targetColWidth}px`, width: `${targetColWidth}px` }
                : { flex: `1 1 ${flexBasis}px`, minWidth: 0 };

              return (
                <div key={dayIdx} className={`shockwave-day${isToday ? ' is-today' : ''}`} style={dayFlexStyle}>
                  {/* 날짜 헤더 */}
                  <div className={headerClass}>
                    {formatDisplayDate(dayInfo.year, dayInfo.month, dayInfo.day)} ({DAY_NAMES[dayInfo.dow]})
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
                          <div key={ci} className={nameClass}>
                            {therapists[ci]?.name || `치료사${ci + 1}`}
                          </div>
                        );
                      })}
                    </div>
                    {/* 열 리사이즈 핸들 오버레이 */}
                    {colCount > 1 && Array.from({ length: colCount - 1 }, (_, ci) => {
                      const ratios = colRatios || Array(colCount).fill(1);
                      const totalR = ratios.reduce((a, b) => a + b, 0);
                      const leftPct = ratios.slice(0, ci + 1).reduce((a, b) => a + b, 0) / totalR * 100;
                      const timeColPx = showTimeCol ? 46 : 0;
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
                        const cellData = memos[key];
                        const content = pendingDisplayValues[key] ?? cellData?.content ?? '';
                        const mergeSpan = cellData?.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null };
                          
                          if (mergeSpan.mergedInto) {
                            continue; // 병합된 하위 셀은 묶어서 렌더링 생략
                          }

                          const isEditing = editingCell === key;
                          const isSelected = selectedKeys.has(key);
                          const isPrimary = selectedCell && selectedCell.w === weekIdx && selectedCell.d === dayIdx && selectedCell.r === rowIdx && selectedCell.c === colIdx;
                          const gridColumnStart = showTimeCol ? colIdx + 2 : colIdx + 1;

                          // View Span Calculation (in case it spans across omitted rows like lunch)
                          let visualRowSpan = 1;
                          if (mergeSpan.rowSpan > 1) {
                            const endRowIdx = rowIdx + mergeSpan.rowSpan - 1;
                            visualRowSpan = daySlots.filter(s => s.idx >= rowIdx && s.idx <= endRowIdx).length;
                          }

                          let cls = 'sw-cell';
                          if (!dayInfo.isCurrentMonth) cls += ' other-month-bg';
                          else if (dayInfo.isHoliday) cls += ' holiday-bg';
                          
                          if (slotInfo.disabled && !content) cls += ' disabled';
                          
                          if (cellData?.bg_color === '#ffe599') cls += ' preserve';
                          if (has4060Pattern(content)) cls += ' color-4060';
                          if (isSelected) cls += ' selected';
                          if (isPrimary) cls += ' primary-selected';

                          // Marching Ants Feedback
                          if (clipboardSource?.keys?.has(key)) {
                            cls += ` ants-active ${clipboardSource.mode === 'cut' ? 'ants-red' : 'ants-blue'}`;
                          }

                          const dateKey = `${dayInfo.year}-${dayInfo.month}-${dayInfo.day}`;
                          const therapistName = therapists[colIdx]?.name || '';
                          const workState = getTherapistWorkState(dateKey, therapistName);
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
                          
                          // 마스터 셀 중앙 효과
                          if (visualRowSpan > 1 || mergeSpan.colSpan > 1) {
                            inlineStyle.display = 'flex';
                            inlineStyle.alignItems = 'center';
                            inlineStyle.justifyContent = 'center';
                            cls += ' merged-master';
                          }

                          if (isEditing) {
                            elements.push(
                              <div key={key} className="sw-cell editing" style={inlineStyle}>
                                <input
                                  ref={editInputRef}
                                  className="sw-cell-input"
                                  value={editValue}
                                  onChange={e => setEditValue(e.target.value)}
                                  onCompositionStart={() => {
                                    if (!imeOpenRef.current) return;
                                    imeOpenRef.current = false;
                                    setEditValue('');
                                  }}
                                  onBlur={(e) => handleCellSave(weekIdx, dayIdx, rowIdx, colIdx, e.target.value)}
                                  onKeyDown={e => handleEditKeyDown(e, weekIdx, dayIdx, rowIdx, colIdx)}
                                  autoFocus
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
                                  let text = `⏱ [${slotInfo.label}]`;
                                  if (content && content !== '\u200B') text += `\n📝 ${content}`;

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
                                      
                                      text = `⏱ [${t1} ~ ${t2}] (총 ${dStr})`;
                                      if (content && content !== '\u200B') text += `\n📝 ${content}`;
                                    }
                                  }
                                  setHoverData({ text });
                                }}
                                onMouseLeave={() => setHoverData(null)}
                                onDoubleClick={() => handleCellDoubleClick(weekIdx, dayIdx, rowIdx, colIdx, content)}
                              >
                                {content}
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
                        dayResizeRef.current = { active: true, startX: e.clientX, startWidth: currentDayWidth, factor: 1 };
                        const onMove = (ev) => {
                          if (!dayResizeRef.current.active) return;
                          const { startWidth, startX } = dayResizeRef.current;
                          const delta = ev.clientX - startX;
                          const newWidth = Math.max(100, Math.min(600, startWidth + delta));
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
          className="shockwave-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button type="button" className="context-menu-item" onClick={() => handleContextAction('copy')}>
            복사 (Cmd+C)
          </button>
          <button type="button" className="context-menu-item" onClick={() => handleContextAction('cut')}>
            잘라내기 (Cmd+X)
          </button>
          <button type="button" className="context-menu-item" onClick={() => handleContextAction('paste')}>
            붙여넣기 (Cmd+V)
          </button>
          <button
            type="button"
            className="context-menu-item context-menu-item-complete"
            onClick={() => handleContextAction('complete')}
            disabled={!hasCompletableSelection}
          >
            치료 완료 (Ctrl/Cmd+G)
          </button>
          <button
            type="button"
            className="context-menu-item context-menu-item-clear-complete"
            onClick={() => handleContextAction('clear-complete')}
            disabled={!hasCompletedSelection}
          >
            치료 완료 해제
          </button>
          <div className="context-menu-divider" />
          {!selectionInfo?.isMergedMaster && (
            <button
              type="button"
              className="context-menu-item"
              onClick={() => handleContextAction('merge')}
              disabled={!selectionInfo?.selectionMultiple}
            >
              셀 병합 (Cmd+E)
            </button>
          )}
          {selectionInfo?.isMergedMaster && (
            <button
              type="button"
              className="context-menu-item"
              onClick={() => handleContextAction('unmerge')}
            >
              병합 해제 (Cmd+E)
            </button>
          )}
        </div>
      )}

      {chartSelector && (
        <div className="shockwave-chart-selector-backdrop" onMouseDown={() => handleChartSelectorClose(null)}>
          <div className="shockwave-chart-selector" onMouseDown={(e) => e.stopPropagation()}>
            <div className="shockwave-chart-selector-title">차트번호 선택</div>
            <div className="shockwave-chart-selector-subtitle">
              {chartSelector.rawName} 환자의 차트번호를 선택하세요.
            </div>
            <div className="shockwave-chart-selector-options">
              {chartSelector.options.map((option) => (
                <button
                  key={`${option.chartNumber}-${option.lastDate}`}
                  type="button"
                  className="shockwave-chart-selector-option"
                  onClick={() => handleChartSelectorClose(option)}
                >
                  <span>{option.chartNumber}</span>
                  <span>{option.nextVisit}회차</span>
                  <span>{option.lastDate}</span>
                </button>
              ))}
            </div>
            <div className="shockwave-chart-selector-actions">
              <button
                type="button"
                className="shockwave-chart-selector-cancel"
                onClick={() => handleChartSelectorClose(null)}
              >
                취소
              </button>
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
          {hoverData.text.split('\n').map((line, i) => <div key={i}>{line}</div>)}
        </div>
      )}
    </>
  );
}
