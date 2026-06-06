import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { flushSync, createPortal } from 'react-dom';
import { useSchedule } from '../../contexts/ScheduleContext';
import { generateCalendarGrid, getTodayKST, isSameDate } from '../../lib/calendarUtils';
import { WEEKDAYS } from '../../lib/constants';
import {
  getEffectiveStaffScheduleBlockRules,
  normalizeStaffScheduleRuleText,
} from '../../lib/staffScheduleBlockRules';
import { getEffectiveStaffDisplayRules, getMemoFontColorByRule } from '../../lib/staffDisplayRules';
import { shouldHideStaffMemoByDepartment } from '../../lib/staffDepartmentFilters';
import { useToast } from '../common/Toast';
import MemoSlot from './MemoSlot';
import { usePersistentNumber } from '../../hooks/usePersistentState';
import { useAuth } from '../../contexts/AuthContext';
import { isAdminUser } from '../../lib/authPermissions';

const COL_W_KEY = 'staff-calendar-col-width';
const ROW_H_KEY = 'staff-calendar-row-height';
const DATE_H_KEY = 'staff-calendar-date-row-height';
const MEMO_FONT_SIZE_KEY = 'staff-calendar-memo-font-size';
const DATE_FONT_SIZE_KEY = 'staff-calendar-date-font-size';
const DATE_FONT_WEIGHT_KEY = 'staff-calendar-date-font-weight';
const WEEKDAY_FONT_SIZE_KEY = 'staff-calendar-weekday-font-size';
const MIN_COL_WIDTH = 30;
const MIN_ROW_HEIGHT = 28;
const MIN_DATE_ROW_HEIGHT = 16;
const MAX_DATE_ROW_HEIGHT = 64;
const NUMERIC_ONLY_STAFF_COUNT_PATTERN = /^\d+$/;
const MEMO_FONT_SIZE_OPTIONS = Array.from({ length: 21 }, (_, index) => 10 + index * 0.5);
const DATE_FONT_SIZE_OPTIONS = Array.from({ length: 25 }, (_, index) => 8 + index * 0.5);
const WEEKDAY_FONT_SIZE_OPTIONS = Array.from({ length: 25 }, (_, index) => 8 + index * 0.5);
const DATE_FONT_WEIGHT_OPTIONS = [500, 600, 700, 800, 900];
const STAFF_CUSTOM_COLORS_KEY = 'staff-calendar-custom-colors';
const SHEETS_COLOR_GRID = [
  ['#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc', '#d9d9d9', '#efefef', '#f3f3f3', '#ffffff'],
  ['#980000', '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#4a86e8', '#0000ff', '#9900ff', '#ff00ff'],
  ['#e6b8af', '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3', '#c9daf8', '#cfe2f3', '#d9d2e9', '#ead1dc'],
  ['#dd7e6b', '#ea9999', '#f9cb9c', '#ffe599', '#b6d7a8', '#a2c4c9', '#a4c2f4', '#9fc5e8', '#b4a7d6', '#d5a6bd'],
  ['#cc4125', '#e06666', '#f6b26b', '#ffd966', '#93c47d', '#76a5af', '#6d9eeb', '#6fa8dc', '#8e7cc3', '#c27ba0'],
  ['#a61c00', '#cc0000', '#e69138', '#f1c232', '#6aa84f', '#45818e', '#3c78d8', '#3d85c6', '#674ea7', '#a64d79'],
  ['#85200c', '#990000', '#b45f06', '#bf9000', '#38761d', '#134f5c', '#1155cc', '#0b5394', '#351c75', '#741b47'],
  ['#5b0f00', '#660000', '#783f04', '#7f6000', '#274e13', '#0c343d', '#1c4587', '#073763', '#20124d', '#4c1130'],
];
const SHEETS_STANDARD_COLORS = ['#000000', '#ffffff', '#4a86e8', '#e74c3c', '#f6c143', '#57a863', '#f97316', '#5fc0cc'];
const DEFAULT_CUSTOM_COLORS = ['#93c47d', '#f6c143', '#d9d9d9', '#ead1dc', '#6aa84f', '#f97316'];

function getStaffCalendarDisplayMemo(memo, isLastSlot) {
  const content = memo?.content || '';
  const trimmedContent = content.trim();
  if (!isLastSlot || !NUMERIC_ONLY_STAFF_COUNT_PATTERN.test(trimmedContent)) {
    return memo;
  }
  return { ...(memo || {}), content: `${trimmedContent}명` };
}

function normalizeHexColor(value) {
  const text = String(value || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(text)) return text.toLowerCase();
  return '';
}

function isDarkHexColor(value) {
  const color = normalizeHexColor(value);
  if (!color) return false;
  const red = parseInt(color.slice(1, 3), 16);
  const green = parseInt(color.slice(3, 5), 16);
  const blue = parseInt(color.slice(5, 7), 16);
  return (red * 299 + green * 587 + blue * 114) / 1000 < 150;
}

function loadStaffCustomColors() {
  if (typeof window === 'undefined') return DEFAULT_CUSTOM_COLORS;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STAFF_CUSTOM_COLORS_KEY) || 'null');
    if (Array.isArray(parsed)) {
      const colors = parsed.map(normalizeHexColor).filter(Boolean);
      return colors.length > 0 ? colors : DEFAULT_CUSTOM_COLORS;
    }
  } catch {
    // Ignore malformed storage.
  }
  return DEFAULT_CUSTOM_COLORS;
}

function saveStaffCustomColors(colors) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STAFF_CUSTOM_COLORS_KEY, JSON.stringify(colors));
}

function getShortcutModifierLabel() {
  if (typeof navigator === 'undefined') return 'Ctrl';
  return /Mac|iPhone|iPad|iPod/i.test(`${navigator.platform || ''} ${navigator.userAgent || ''}`)
    ? 'Cmd'
    : 'Ctrl';
}

function FillColorIcon() {
  return (
    <svg viewBox="0 0 28 28" aria-hidden="true" focusable="false">
      <path d="M4.3 13.4h12.1l-5 5a3 3 0 0 1-4.2 0L3.8 15c-.4-.4-.2-1.6.5-1.6Z" fill="#93c47d" />
      <path d="M8.4 3.2 18 12.8 11.4 19.4a3 3 0 0 1-4.2 0L3.8 16a3 3 0 0 1 0-4.2l8.1-8.1" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="square" strokeLinejoin="round" />
      <path d="M5.2 11.2h12.4" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M21.5 14.2c1.9 2.5 2.9 4.2 2.9 5.5a3.1 3.1 0 0 1-6.2 0c0-1.3 1-3 3.3-5.5Z" fill="currentColor" />
      <rect x="2" y="23" width="24" height="4" fill="#93c47d" />
    </svg>
  );
}

export default function StaffCalendar({ hiddenDepartments = [], showLastRows = true }) {
  const { currentYear, currentMonth, staffMemos, loadStaffMemos, saveStaffMemo, holidays, holidayNames, loadHolidays, shockwaveSettings, loadShockwaveSettings, calendarSlotSettings, loadCalendarSlotSettings, saveCalendarSlotSettings } = useSchedule();
  const { addToast } = useToast();
  const { user } = useAuth();
  const canManageCalendarSettings = isAdminUser(user);
  const [showSlotSettings, setShowSlotSettings] = useState(false);
  const slotSettingsRef = useRef(null);

  const [portalTarget, setPortalTarget] = useState(null);
  useEffect(() => {
    setPortalTarget(document.getElementById('staff-settings-portal'));
  }, []);

  useEffect(() => {
    if (!canManageCalendarSettings && showSlotSettings) {
      setShowSlotSettings(false);
    }
  }, [canManageCalendarSettings, showSlotSettings]);

  // 설정 팝업 외부 클릭 시 닫기
  useEffect(() => {
    if (!showSlotSettings) return;
    const handleClickOutside = (e) => {
      if (slotSettingsRef.current && !slotSettingsRef.current.contains(e.target)) {
        setShowSlotSettings(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showSlotSettings]);

  const [colWidth, setColWidth] = usePersistentNumber(COL_W_KEY, 0);
  const [rowHeight, setRowHeight] = usePersistentNumber(ROW_H_KEY, 120, MIN_ROW_HEIGHT);
  const [dateRowHeight, setDateRowHeight] = usePersistentNumber(DATE_H_KEY, 28, MIN_DATE_ROW_HEIGHT);
  const [memoFontSize, setMemoFontSize] = usePersistentNumber(MEMO_FONT_SIZE_KEY, 13, 10);
  const [dateFontSize, setDateFontSize] = usePersistentNumber(DATE_FONT_SIZE_KEY, 15, 8);
  const [dateFontWeight, setDateFontWeight] = usePersistentNumber(DATE_FONT_WEIGHT_KEY, 700, 500);
  const [weekdayFontSize, setWeekdayFontSize] = usePersistentNumber(WEEKDAY_FONT_SIZE_KEY, 16, 8);
  const [undoStack, setUndoStack] = useState([]);
  const [selectedCell, setSelectedCell] = useState(null);
  const [, setRangeEnd] = useState(null);
  const [selectedKeys, setSelectedKeys] = useState(() => new Set());
  const [editingCell, setEditingCell] = useState(null);
  const [clipboardSource, setClipboardSource] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [colorMenu, setColorMenu] = useState(null); // { type: 'font' | 'bg', x: number, y: number }
  const [customColors, setCustomColors] = useState(loadStaffCustomColors);
  const [customColorDraft, setCustomColorDraft] = useState('#000000');
  const [pendingCustomColorType, setPendingCustomColorType] = useState(null);
  const shortcutModifier = useMemo(() => getShortcutModifierLabel(), []);
  const viewRef = useRef(null);
  const contextMenuRef = useRef(null);
  const colorMenuRef = useRef(null);
  const customColorInputRef = useRef(null);
  const pendingCustomColorTypeRef = useRef(null);
  const dragRef = useRef(null);
  const pendingDragRef = useRef(null);
  const hiddenInputRef = useRef(null);
  const skipNextBlurSaveRef = useRef(false);

  const today = getTodayKST();
  const { grid } = useMemo(() => generateCalendarGrid(currentYear, currentMonth, holidays), [currentYear, currentMonth, holidays]);

  // 주차별 슬롯 수 헬퍼
  const getSlotCount = useCallback((wi) => {
    if (!calendarSlotSettings?.week_slot_counts) return 6;
    return Number(calendarSlotSettings.week_slot_counts[String(wi)]) || 6;
  }, [calendarSlotSettings]);

  const staffBlockRules = useMemo(
    () => getEffectiveStaffScheduleBlockRules(shockwaveSettings, currentYear, currentMonth).rules,
    [shockwaveSettings, currentYear, currentMonth]
  );
  const displayRules = useMemo(
    () => getEffectiveStaffDisplayRules(shockwaveSettings, currentYear, currentMonth).rules,
    [shockwaveSettings, currentYear, currentMonth]
  );
  const normalizeRuleText = useCallback((value) => normalizeStaffScheduleRuleText(value), []);
  const getAutoFontColorForStaffMemo = useCallback((content) => {
    const normalizedContent = normalizeRuleText(content);
    if (!normalizedContent) return null;
    // 1. staffBlockRules (스케줄러 색칠 규칙)에서 먼저 매칭
    const matchedRules = (staffBlockRules || [])
      .filter((item) => {
        if (item?.enabled === false || !item?.keyword || !item?.font_color) return false;
        return normalizedContent.includes(normalizeRuleText(item.keyword));
      })
      .sort((a, b) => normalizeRuleText(b.keyword).length - normalizeRuleText(a.keyword).length);
    const rule = matchedRules[0];
    if (rule?.font_color) return rule.font_color;
    // 2. displayRules (부서/이름 표시 규칙)에서 매칭
    const displayColor = getMemoFontColorByRule(content, displayRules);
    if (displayColor) return displayColor;
    return null;
  }, [staffBlockRules, normalizeRuleText, displayRules]);

  // ── Key helpers: memoKey = "year-month-day-slot" matching staffMemos format ──
  const memoKey = useCallback((wi, di, slot) => {
    const d = grid[wi]?.[di];
    return d ? `${d.year}-${d.month}-${d.day}-${slot}` : null;
  }, [grid]);

  const makeCell = useCallback((wi, di, slot) => {
    const key = memoKey(wi, di, slot);
    if (!key) return null;
    // 누적 y 좌표 계산 (가변 슬롯)
    let y = 0;
    for (let w = 0; w < wi; w++) y += getSlotCount(w);
    y += slot;
    return { x: di, y, wi, di, slot, key };
  }, [memoKey, getSlotCount]);

  const cellFromXY = useCallback((x, y) => {
    if (x < 0 || x >= 7) return null;
    let cumY = 0;
    for (let w = 0; w < grid.length; w++) {
      const sc = getSlotCount(w);
      if (y < cumY + sc) {
        return makeCell(w, x, y - cumY);
      }
      cumY += sc;
    }
    return null;
  }, [grid, makeCell, getSlotCount]);

  const buildRange = useCallback((a, b) => {
    if (!a || !b) return new Set();
    const [x1, x2] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
    const [y1, y2] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
    const keys = new Set();
    for (let x = x1; x <= x2; x++)
      for (let y = y1; y <= y2; y++) {
        const c = cellFromXY(x, y);
        if (c) keys.add(c.key);
      }
    return keys;
  }, [cellFromXY]);

  // ── Data helpers ──
  const dayFromKey = useCallback((key) => {
    const p = key.split('-').map(Number);
    return { year: p[0], month: p[1], day: p[2], slot: p[3] };
  }, []);

  const buildUndoItem = useCallback((key) => {
    const { year, month, day, slot } = dayFromKey(key);
    const memo = staffMemos[key] || {};
    return {
      year,
      month,
      day,
      slot,
      content: memo.content || '',
      fontColor: memo.font_color ?? null,
      bgColor: memo.bg_color ?? null,
    };
  }, [dayFromKey, staffMemos]);

  const getEffectiveMemoFontColor = useCallback((memo) => {
    const content = memo?.content || '';
    return getAutoFontColorForStaffMemo(content) || memo?.font_color || null;
  }, [getAutoFontColorForStaffMemo]);

  const getActiveColorForMenu = useCallback((type) => {
    const key = selectedCell?.key || [...selectedKeys][0];
    if (!key) return '';
    const memo = staffMemos[key] || {};
    return normalizeHexColor(type === 'font' ? getEffectiveMemoFontColor(memo) : memo.bg_color);
  }, [selectedCell, selectedKeys, staffMemos, getEffectiveMemoFontColor]);

  const getSwatchClassName = useCallback((color, extraClass = '') => {
    const activeColor = colorMenu ? getActiveColorForMenu(colorMenu.type) : '';
    const selectedClass = normalizeHexColor(color) === activeColor
      ? ` staff-sheets-swatch--selected ${isDarkHexColor(color) ? 'staff-sheets-swatch--selected-dark' : 'staff-sheets-swatch--selected-light'}`
      : '';
    return `staff-sheets-swatch${extraClass ? ` ${extraClass}` : ''}${selectedClass}`;
  }, [colorMenu, getActiveColorForMenu]);

  const recordUndo = useCallback((a) => setUndoStack(p => [a, ...p].slice(0, 50)), []);

  const doUndo = useCallback(async () => {
    const a = undoStack[0]; if (!a) return;
    setUndoStack(p => p.slice(1));
    if (a.type === 'edit') await saveStaffMemo(a.year, a.month, a.day, a.slot, a.oldVal);
    else if (a.type === 'bulk') await Promise.all(a.items.map(m => saveStaffMemo(m.year, m.month, m.day, m.slot, m.content, m.fontColor, m.bgColor)));
  }, [undoStack, saveStaffMemo]);

  // ── Resize ──
  const startColResize = (e) => {
    e.preventDefault(); e.stopPropagation();
    const sx = e.clientX, cw = colWidth || e.target.parentElement.offsetWidth;
    let latestWidth = colWidth || cw;
    const move = (ev) => {
      latestWidth = Math.max(MIN_COL_WIDTH, cw + ev.clientX - sx);
      setColWidth(latestWidth);
    };
    const up = () => {
      setColWidth(latestWidth);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('blur', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    window.addEventListener('blur', up);
  };
  const startRowResize = (e) => {
    e.preventDefault(); e.stopPropagation();
    const sy = e.clientY, ch = rowHeight;
    let latestHeight = rowHeight || ch;
    const move = (ev) => {
      latestHeight = Math.max(MIN_ROW_HEIGHT, ch + ev.clientY - sy);
      setRowHeight(latestHeight);
    };
    const up = () => {
      setRowHeight(latestHeight);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('blur', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    window.addEventListener('blur', up);
  };
  const startDateRowResize = (e) => {
    e.preventDefault(); e.stopPropagation();
    const sy = e.clientY;
    const startHeight = dateRowHeight;
    let latestHeight = dateRowHeight || startHeight;
    const move = (ev) => {
      latestHeight = Math.min(MAX_DATE_ROW_HEIGHT, Math.max(MIN_DATE_ROW_HEIGHT, startHeight + ev.clientY - sy));
      setDateRowHeight(latestHeight);
    };
    const up = () => {
      setDateRowHeight(latestHeight);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('blur', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    window.addEventListener('blur', up);
  };

  useEffect(() => {
    loadStaffMemos(currentYear, currentMonth, { includeAdjacentMonths: true });
    loadHolidays(currentYear, currentMonth);
    loadShockwaveSettings();
    loadCalendarSlotSettings(currentYear, currentMonth);
  }, [currentYear, currentMonth, loadStaffMemos, loadHolidays, loadShockwaveSettings, loadCalendarSlotSettings]);

  // ── Actions ──
  const focusHiddenInput = useCallback(() => {
    setTimeout(() => { hiddenInputRef.current?.focus({ preventScroll: true }); }, 0);
  }, []);

  const selectSingle = useCallback((cell) => {
    if (!cell) return;
    setSelectedCell(cell); setRangeEnd(cell); setSelectedKeys(new Set([cell.key]));
    if (editingCell && editingCell !== cell.key) setEditingCell(null);
    focusHiddenInput();
  }, [editingCell, focusHiddenInput]);

  const beginEdit = useCallback((key, val, preserve, selectAll = preserve) => {
    flushSync(() => {
      setEditingCell(key);
    });
    // Position the input over the target cell
    requestAnimationFrame(() => {
      const el = hiddenInputRef.current;
      const cellEl = viewRef.current?.querySelector(`[data-cell-id="${key}"]`);
      if (el && cellEl) {
        const rect = cellEl.getBoundingClientRect();
        const parentRect = viewRef.current.getBoundingClientRect();
        el.style.position = 'absolute';
        el.style.top = `${rect.top - parentRect.top}px`;
        el.style.left = `${rect.left - parentRect.left}px`;
        el.style.width = `${rect.width}px`;
        el.style.height = `${rect.height}px`;
        el.style.opacity = '1';
        el.style.pointerEvents = 'auto';
        el.style.zIndex = '20';
        el.style.padding = '2px 6px';
        el.style.border = '2px solid var(--brand-primary)';
        el.style.borderRadius = '3px';
        el.style.fontSize = `${memoFontSize}px`;
        el.style.fontWeight = '600';
        el.style.textAlign = 'right';
        el.style.boxSizing = 'border-box';
        el.style.background = 'var(--bg-input, #fff)';
        el.style.color = 'var(--text-primary, #000)';
        el.style.outline = 'none';
        if (preserve) {
          el.value = val;
        }
        el.focus({ preventScroll: true });
        if (preserve) {
          if (selectAll) {
            el.select();
          } else {
            const cursor = el.value.length;
            el.setSelectionRange(cursor, cursor);
          }
        }
      }
    });
  }, [memoFontSize]);

  const resetInputToHidden = useCallback(() => {
    const el = hiddenInputRef.current;
    if (el) {
      el.value = '';
      el.style.position = 'absolute';
      el.style.top = '0';
      el.style.left = '0';
      el.style.width = '1px';
      el.style.height = '1px';
      el.style.opacity = '0';
      el.style.pointerEvents = 'none';
      el.style.zIndex = '-1';
      el.style.padding = '0';
      el.style.border = 'none';
      el.style.borderRadius = '0';
      el.style.fontSize = 'inherit';
      el.style.fontWeight = 'inherit';
      el.style.textAlign = 'left';
      el.style.background = 'transparent';
      el.style.color = 'inherit';
    }
  }, []);

  const saveCell = useCallback(async (wi, di, slot, val) => {
    setEditingCell(null);
    resetInputToHidden();
    const key = memoKey(wi, di, slot);
    const old = (staffMemos[key]?.content || '').trim();
    const nv = (val || '').trim();
    if (old !== nv) {
      const d = grid[wi][di];
      recordUndo({ type: 'edit', year: d.year, month: d.month, day: d.day, slot, oldVal: old });
      if (!await saveStaffMemo(d.year, d.month, d.day, slot, nv)) addToast('저장 실패', 'error');
    }
    focusHiddenInput();
  }, [staffMemos, memoKey, grid, saveStaffMemo, addToast, recordUndo, resetInputToHidden, focusHiddenInput]);

  const commitActiveEdit = useCallback(() => {
    if (!editingCell) return;
    const currentKey = editingCell;
    const { year, month, day, slot } = dayFromKey(currentKey);
    const old = (staffMemos[currentKey]?.content || '').trim();
    const nv = (hiddenInputRef.current?.value || '').trim();
    skipNextBlurSaveRef.current = true;
    setTimeout(() => {
      skipNextBlurSaveRef.current = false;
    }, 0);
    setEditingCell(null);
    resetInputToHidden();
    if (old !== nv) {
      recordUndo({ type: 'edit', year, month, day, slot, oldVal: old });
      saveStaffMemo(year, month, day, slot, nv).then((success) => {
        if (!success) addToast('저장 실패', 'error');
      });
    }
  }, [editingCell, dayFromKey, staffMemos, resetInputToHidden, recordUndo, saveStaffMemo, addToast]);

  const deleteCells = useCallback(async (keys) => {
    const items = [], proms = [];
    for (const k of keys || []) {
      if (staffMemos[k]?.content) {
        const { year, month, day, slot } = dayFromKey(k);
        items.push(buildUndoItem(k));
        proms.push(saveStaffMemo(year, month, day, slot, '', null, null));
      }
    }
    if (proms.length) { recordUndo({ type: 'bulk', items }); await Promise.all(proms); }
  }, [staffMemos, dayFromKey, buildUndoItem, saveStaffMemo, recordUndo]);

  const handleCopy = useCallback(() => {
    if (!selectedKeys?.size) return;
    // Build coord map from keys
    const cells = [];
    grid.forEach((week, wi) => week.forEach((d, di) => {
      for (let s = 0; s < 6; s++) {
        const k = `${d.year}-${d.month}-${d.day}-${s}`;
        if (selectedKeys.has(k)) cells.push({ x: di, y: wi * 6 + s, key: k });
      }
    }));
    if (!cells.length) return;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    cells.forEach(c => { minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x); minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y); });

    const data = new Map();
    cells.forEach(c => {
      const memo = staffMemos[c.key] || {};
      data.set(`${c.x - minX}-${c.y - minY}`, {
        content: memo.content || '',
        fontColor: getEffectiveMemoFontColor(memo),
        bgColor: memo.bg_color ?? null,
      });
    });

    setClipboardSource({ keys: new Set(selectedKeys), minX, maxX, minY, maxY, mode: 'copy', data });
    const rows = [];
    for (let y = minY; y <= maxY; y++) { const r = []; for (let x = minX; x <= maxX; x++) r.push(data.get(`${x - minX}-${y - minY}`)?.content || ''); rows.push(r.join('\t')); }
    navigator.clipboard?.writeText(rows.join('\n')).catch(() => {});
    addToast('복사됨', 'info');
  }, [selectedKeys, staffMemos, grid, getEffectiveMemoFontColor, addToast]);

  const handleCut = useCallback(() => { handleCopy(); setClipboardSource(p => p ? { ...p, mode: 'cut' } : null); }, [handleCopy]);

  const handlePaste = useCallback(async (text) => {
    if (!selectedCell) return;
    const sx = selectedCell.x, sy = selectedCell.y;
    const items = [], proms = [];

    if (clipboardSource && !text) {
      for (let dx = 0; dx <= clipboardSource.maxX - clipboardSource.minX; dx++) {
        for (let dy = 0; dy <= clipboardSource.maxY - clipboardSource.minY; dy++) {
          const v = clipboardSource.data.get(`${dx}-${dy}`); if (v === undefined) continue;
          const tc = cellFromXY(sx + dx, sy + dy); if (!tc) continue;
          const d = grid[tc.wi]?.[tc.di]; if (!d) continue;
          const oldMemo = staffMemos[tc.key] || {};
          const oldContent = oldMemo.content || '';
          const oldFontColor = oldMemo.font_color ?? null;
          const oldBgColor = oldMemo.bg_color ?? null;
          if (oldContent !== v.content || oldFontColor !== v.fontColor || oldBgColor !== v.bgColor) {
            items.push(buildUndoItem(tc.key));
            proms.push(saveStaffMemo(d.year, d.month, d.day, tc.slot, v.content, v.fontColor, v.bgColor));
          }
        }
      }
      if (clipboardSource.mode === 'cut') {
        for (const k of clipboardSource.keys) {
          const { year, month, day, slot } = dayFromKey(k);
          const memo = staffMemos[k] || {};
          if (memo.content || memo.font_color || memo.bg_color) {
            items.push(buildUndoItem(k));
            proms.push(saveStaffMemo(year, month, day, slot, '', null, null));
          }
        }
        setClipboardSource(null);
      }
    } else if (text) {
      const rows = text.split(/\r?\n/).map(r => r.split('\t'));
      for (let dy = 0; dy < rows.length; dy++) for (let dx = 0; dx < rows[dy].length; dx++) {
        const v = rows[dy][dx].trim(); const tc = cellFromXY(sx + dx, sy + dy); if (!tc) continue;
        const d = grid[tc.wi]?.[tc.di]; if (!d) continue;
        const old = staffMemos[tc.key]?.content || '';
        if (old !== v) { items.push(buildUndoItem(tc.key)); proms.push(saveStaffMemo(d.year, d.month, d.day, tc.slot, v)); }
      }
    }
    if (proms.length) { recordUndo({ type: 'bulk', items }); await Promise.all(proms); addToast('붙여넣기 완료', 'success'); }
    setClipboardSource(null);
  }, [selectedCell, clipboardSource, cellFromXY, grid, staffMemos, saveStaffMemo, dayFromKey, buildUndoItem, recordUndo, addToast]);

  const replaceEditingSelection = useCallback((insertText) => {
    const input = hiddenInputRef.current;
    if (!editingCell || !input) return false;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    const nextValue = `${input.value.slice(0, start)}${insertText}${input.value.slice(end)}`;
    const nextCursor = start + insertText.length;
    input.value = nextValue;
    input.focus({ preventScroll: true });
    input.setSelectionRange(nextCursor, nextCursor);
    return true;
  }, [editingCell]);

  const handleTextContextAction = useCallback(async (action) => {
    const input = hiddenInputRef.current;
    if (!editingCell || !input) return false;
    const start = input.selectionStart ?? 0;
    const end = input.selectionEnd ?? start;
    const selectedText = input.value.slice(start, end);

    if (action === 'copy') {
      if (selectedText) await navigator.clipboard?.writeText(selectedText);
      setContextMenu(null);
      setColorMenu(null);
      input.focus({ preventScroll: true });
      return true;
    }

    if (action === 'cut') {
      if (selectedText) {
        await navigator.clipboard?.writeText(selectedText);
        replaceEditingSelection('');
      }
      setContextMenu(null);
      setColorMenu(null);
      input.focus({ preventScroll: true });
      return true;
    }

    if (action === 'paste') {
      const text = await navigator.clipboard?.readText?.();
      if (text) replaceEditingSelection(text);
      setContextMenu(null);
      setColorMenu(null);
      input.focus({ preventScroll: true });
      return true;
    }

    if (action === 'delete') {
      if (selectedText) replaceEditingSelection('');
      setContextMenu(null);
      setColorMenu(null);
      input.focus({ preventScroll: true });
      return true;
    }

    return false;
  }, [editingCell, replaceEditingSelection]);

  // ── Edit key handler ──
  const handleEditKey = useCallback((e, wi, di, slot) => {
    if (['ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      const input = e.target;
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? start;
      const nextPosition = e.key === 'ArrowLeft'
        ? (start === end ? Math.max(0, start - 1) : Math.min(start, end))
        : (start === end ? Math.min(input.value.length, end + 1) : Math.max(start, end));
      input.setSelectionRange(nextPosition, nextPosition);
      input.scrollLeft = 0;
      requestAnimationFrame(() => {
        input.scrollLeft = 0;
      });
      return;
    }
    if (['ArrowUp','ArrowDown'].includes(e.key)) {
      e.preventDefault(); e.target.blur();
      const c = cellFromXY(di, wi * 6 + slot); if (!c) return;
      let nx = c.x, ny = c.y;
      if (e.key === 'ArrowUp') ny--; if (e.key === 'ArrowDown') ny++;
      const nc = cellFromXY(nx, ny); if (nc) selectSingle(nc); return;
    }
    if (e.key === 'Enter') { if (e.nativeEvent?.isComposing) return; e.target.blur(); const c = cellFromXY(di, wi*6+slot); const nc = cellFromXY(c.x, c.y+1); if (nc) selectSingle(nc); }
    if (e.key === 'Escape') { setEditingCell(null); viewRef.current?.focus({ preventScroll: true }); }
    if (e.key === 'Tab') { e.preventDefault(); e.target.blur(); const c = cellFromXY(di, wi*6+slot); const nc = cellFromXY(c.x + (e.shiftKey ? -1 : 1), c.y); if (nc) selectSingle(nc); }
  }, [cellFromXY, selectSingle]);

  // ── Grid key handler ──
  const handleKeyDown = useCallback((e) => {
    const isUndoKey = (e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'z' || e.code === 'KeyZ');
    if (clipboardSource && (e.key === 'Escape' || e.key === 'Backspace' || isUndoKey)) {
      e.preventDefault();
      e.stopPropagation();
      setClipboardSource(null);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'z' || e.code === 'KeyZ')) { e.preventDefault(); doUndo(); return; }
    if (!selectedCell) return;
    if (editingCell) { if (e.key === 'Escape') { e.preventDefault(); setEditingCell(null); resetInputToHidden(); focusHiddenInput(); } return; }

    const meta = e.metaKey || e.ctrlKey;
    if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); beginEdit(selectedCell.key, staffMemos[selectedCell.key]?.content || '', true); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteCells(selectedKeys); return; }
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) {
      e.preventDefault();
      let nx = selectedCell.x, ny = selectedCell.y;
      if (e.key === 'ArrowUp') ny--; if (e.key === 'ArrowDown') ny++; if (e.key === 'ArrowLeft') nx--; if (e.key === 'ArrowRight') nx++;
      const nc = cellFromXY(nx, ny); if (!nc) return;
      if (e.shiftKey) { setRangeEnd(nc); setSelectedKeys(buildRange(selectedCell, nc)); } else selectSingle(nc);
      return;
    }
    if (e.key === 'Tab') { e.preventDefault(); const nc = cellFromXY(selectedCell.x + (e.shiftKey ? -1 : 1), selectedCell.y); if (nc) selectSingle(nc); return; }
    if (meta && e.code === 'KeyC') { e.preventDefault(); handleCopy(); return; }
    if (meta && e.code === 'KeyX') { e.preventDefault(); handleCut(); return; }
    if (meta && e.code === 'KeyV') return; // native paste
    if ((e.key.length === 1 || e.key === 'Process' || e.keyCode === 229) && !meta && !e.altKey) {
      // Same DOM element transitions from hidden to visible - IME composition preserved
      beginEdit(selectedCell.key, '', false);
      return;
    }
  }, [selectedCell, editingCell, selectedKeys, cellFromXY, selectSingle, buildRange, beginEdit, staffMemos, doUndo, clipboardSource, deleteCells, handleCopy, handleCut, resetInputToHidden, focusHiddenInput]);

  useEffect(() => {
    const el = hiddenInputRef.current;
    if (el) { el.addEventListener('keydown', handleKeyDown); return () => el.removeEventListener('keydown', handleKeyDown); }
  }, [handleKeyDown]);
  useEffect(() => {
    const h = (ev) => {
      if (!selectedCell) return;
      const t = ev.target;
      if (editingCell && t === hiddenInputRef.current) return;
      // Allow paste from hidden input and viewRef, block from real editing inputs
      if (t instanceof HTMLInputElement && !t.dataset.hiddenInput) return;
      if (t instanceof HTMLTextAreaElement) return;
      if (clipboardSource) {
        ev.preventDefault();
        handlePaste();
        return;
      }
      const txt = ev.clipboardData?.getData('text/plain'); if (!txt) return;
      ev.preventDefault(); handlePaste(txt);
    };
    window.addEventListener('paste', h, true); return () => window.removeEventListener('paste', h, true);
  }, [selectedCell, editingCell, clipboardSource, handlePaste]);

  // ── Mouse handlers ──
  const onCellMouseDown = useCallback((wi, di, slot, e) => {
    if (e.button === 2) return;
    e.preventDefault();
    const cell = makeCell(wi, di, slot); if (!cell) return;
    if (editingCell && editingCell !== cell.key) commitActiveEdit();
    else if (editingCell) setEditingCell(null);
    setContextMenu(null);
    if (e.shiftKey && selectedCell) {
      pendingDragRef.current = null;
      setRangeEnd(cell);
      setSelectedKeys(buildRange(selectedCell, cell));
    } else {
      selectSingle(cell);
      pendingDragRef.current = { cell, x: e.clientX, y: e.clientY };
    }
  }, [makeCell, editingCell, commitActiveEdit, selectedCell, buildRange, selectSingle]);

  const onCellMouseEnter = useCallback((wi, di, slot, e) => {
    const c = makeCell(wi, di, slot); if (!c) return;
    const pending = pendingDragRef.current;
    if (!dragRef.current && pending && e.buttons === 1) {
      const distance = Math.hypot(e.clientX - pending.x, e.clientY - pending.y);
      if (distance >= 6) dragRef.current = pending.cell;
    }
    if (dragRef.current) { setRangeEnd(c); setSelectedKeys(buildRange(dragRef.current, c)); }
  }, [makeCell, buildRange]);

  const onCellDblClick = useCallback((wi, di, slot) => {
    const key = memoKey(wi, di, slot);
    beginEdit(key, staffMemos[key]?.content || '', true, false);
  }, [memoKey, staffMemos, beginEdit]);

  const onCellCtxMenu = useCallback((wi, di, slot, e) => {
    e.preventDefault();
    const cell = makeCell(wi, di, slot); if (!cell) return;
    if (!selectedKeys.has(cell.key)) selectSingle(cell);
    const MENU_W = 160; const MENU_H = 200;
    setContextMenu({ 
      x: e.clientX + MENU_W > window.innerWidth ? e.clientX - MENU_W : e.clientX, 
      y: e.clientY + MENU_H > window.innerHeight ? Math.max(10, e.clientY - MENU_H) : e.clientY 
    });
    setColorMenu(null);
  }, [makeCell, selectedKeys, selectSingle]);

  const openColorMenu = useCallback((type, event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const POPUP_W = 240;
    const POPUP_H = 420;
    let x = rect.right + 8;
    let y = rect.top;

    if (x + POPUP_W > window.innerWidth) {
      x = Math.max(10, rect.left - POPUP_W - 8);
    }
    if (y + POPUP_H > window.innerHeight) {
      y = Math.max(10, window.innerHeight - POPUP_H - 10);
    }

    setColorMenu((prev) => (prev?.type === type ? null : { type, x, y }));
  }, []);

  // 메뉴 위치를 동적으로 재조정
  useEffect(() => {
    if (!contextMenu || !contextMenuRef.current) return;
    // requestAnimationFrame으로 렌더링 후 크기 측정
    requestAnimationFrame(() => {
      const el = contextMenuRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let newX = contextMenu.x;
      let newY = contextMenu.y;
      if (rect.bottom > vh) newY = Math.max(10, vh - rect.height - 10);
      if (rect.right > vw) newX = Math.max(10, vw - rect.width - 10);
      if (newX !== contextMenu.x || newY !== contextMenu.y) {
        setContextMenu(prev => prev ? { ...prev, x: newX, y: newY } : prev);
      }
    });
  }, [contextMenu]);

  useEffect(() => {
    if (!contextMenu) return;

    const closeIfOutside = (ev) => {
      const menu = contextMenuRef.current;
      const colorPopup = colorMenuRef.current;
      if (menu && menu.contains(ev.target)) return;
      if (colorPopup && colorPopup.contains(ev.target)) return;
      setContextMenu(null);
      setColorMenu(null);
    };

    const closeOnEscape = (ev) => {
      if (ev.key !== 'Escape') return;
      setContextMenu(null);
      setColorMenu(null);
    };

    window.addEventListener('mousedown', closeIfOutside, true);
    window.addEventListener('touchstart', closeIfOutside, true);
    window.addEventListener('keydown', closeOnEscape, true);
    return () => {
      window.removeEventListener('mousedown', closeIfOutside, true);
      window.removeEventListener('touchstart', closeIfOutside, true);
      window.removeEventListener('keydown', closeOnEscape, true);
    };
  }, [contextMenu]);

  useEffect(() => {
    const h = () => {
      dragRef.current = null;
      pendingDragRef.current = null;
    };
    window.addEventListener('mouseup', h);
    return () => window.removeEventListener('mouseup', h);
  }, []);

  const ctxAction = useCallback(async (a) => {
    if (contextMenu?.mode === 'text' && await handleTextContextAction(a)) return;
    if (a === 'copy') handleCopy(); else if (a === 'cut') handleCut(); else if (a === 'paste') handlePaste(); else if (a === 'delete') deleteCells(selectedKeys);
    setContextMenu(null); setColorMenu(null);
  }, [contextMenu, handleTextContextAction, handleCopy, handleCut, handlePaste, deleteCells, selectedKeys]);

  const applyColor = useCallback(async (type, color) => {
    const promises = [];
    const items = [];
    for (const k of selectedKeys) {
      const { year, month, day, slot } = dayFromKey(k);
      const memo = staffMemos[k];
      const currentColor = type === 'font' ? (memo?.font_color ?? null) : (memo?.bg_color ?? null);
      if (currentColor === color) continue;
      items.push(buildUndoItem(k));
      if (type === 'font') {
        promises.push(saveStaffMemo(year, month, day, slot, memo?.content || '', color, undefined));
      } else {
        promises.push(saveStaffMemo(year, month, day, slot, memo?.content || '', undefined, color));
      }
    }
    if (items.length) recordUndo({ type: 'bulk', items });
    await Promise.all(promises);
    setContextMenu(null); setColorMenu(null);
    if (promises.length) addToast(type === 'font' ? '글자색 적용' : '배경색 적용', 'success');
    focusHiddenInput();
  }, [selectedKeys, staffMemos, dayFromKey, buildUndoItem, recordUndo, saveStaffMemo, addToast, focusHiddenInput]);

  const handleEyedropper = useCallback(async (type) => {
    if (!window.EyeDropper) {
      pendingCustomColorTypeRef.current = type;
      setPendingCustomColorType(type);
      requestAnimationFrame(() => customColorInputRef.current?.click());
      addToast('스포이드 미지원 브라우저입니다. 색상 선택창을 엽니다.', 'info');
      return;
    }
    try {
      const dropper = new window.EyeDropper();
      const result = await dropper.open();
      if (result?.sRGBHex) applyColor(type, result.sRGBHex);
    } catch {
      // cancelled
    }
  }, [applyColor, addToast]);

  const addCustomColor = useCallback(async (type, value = customColorDraft) => {
    const normalized = normalizeHexColor(value);
    if (!normalized) return;
    setCustomColors((prev) => {
      const next = [normalized, ...prev.filter((color) => normalizeHexColor(color) !== normalized)].slice(0, 16);
      saveStaffCustomColors(next);
      return next;
    });
    await applyColor(type, normalized);
  }, [applyColor, customColorDraft]);

  const openCustomColorPicker = useCallback((type) => {
    pendingCustomColorTypeRef.current = type;
    setPendingCustomColorType(type);
    requestAnimationFrame(() => customColorInputRef.current?.click());
  }, []);

  return (
    <div
      className="staff-calendar animate-fade-in"
      ref={viewRef}
      style={{
        outline: 'none',
        position: 'relative',
        '--staff-calendar-memo-font-size': `${memoFontSize}px`,
        '--staff-calendar-date-row-height': `${dateRowHeight}px`,
        '--staff-calendar-date-font-size': `${dateFontSize}px`,
        '--staff-calendar-date-font-weight': dateFontWeight,
        '--staff-calendar-weekday-font-size': `${weekdayFontSize}px`,
      }}
    >
      <div className="calendar-print-title">
        {currentYear}년 {currentMonth}월 직원 근무표
      </div>
      {canManageCalendarSettings && portalTarget && createPortal(
        <div style={{ position: 'relative', width: '100%', display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <button
            type="button"
            onClick={() => setShowSlotSettings(!showSlotSettings)}
            style={{
              background: '#475569',
              border: 'none',
              cursor: 'pointer',
              color: '#fff',
              padding: '4px 12px',
              fontSize: '0.85rem',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '6px',
              whiteSpace: 'nowrap',
            }}
            title="주차별 행 수 설정"
          >
            설정
          </button>
          {showSlotSettings && (
            <div ref={slotSettingsRef} style={{
              position: 'absolute', bottom: '100%', right: 0, marginBottom: 4,
              background: 'var(--bg-primary)', border: '1px solid var(--border-color)',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)', borderRadius: 6, padding: 12,
              zIndex: 1000, width: 220, fontSize: '0.85rem', color: 'var(--text-primary)'
            }}>
              <div style={{ fontWeight: 600, marginBottom: 8, borderBottom: '1px solid var(--border-color)', paddingBottom: 4 }}>
                주차별 메모 행 수 설정
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <label htmlFor="staff-date-font-size" style={{ fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                    날짜 글자 크기
                  </label>
                  <select
                    id="staff-date-font-size"
                    value={dateFontSize}
                    onChange={(e) => setDateFontSize(Number(e.target.value) || 15)}
                    style={{
                      width: 88,
                      padding: '4px 6px',
                      border: '1px solid var(--border-color)',
                      borderRadius: 4,
                      background: 'var(--bg-secondary)',
                      color: 'var(--text-primary)',
                      fontSize: '0.82rem',
                      fontWeight: 600,
                    }}
                  >
                    {DATE_FONT_SIZE_OPTIONS.map((size) => (
                      <option key={size} value={size}>{Number.isInteger(size) ? size : size.toFixed(1)}px</option>
                    ))}
                  </select>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <label htmlFor="staff-weekday-font-size" style={{ fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                    요일 글자 크기
                  </label>
                  <select
                    id="staff-weekday-font-size"
                    value={weekdayFontSize}
                    onChange={(e) => setWeekdayFontSize(Number(e.target.value) || 16)}
                    style={{
                      width: 88,
                      padding: '4px 6px',
                      border: '1px solid var(--border-color)',
                      borderRadius: 4,
                      background: 'var(--bg-secondary)',
                      color: 'var(--text-primary)',
                      fontSize: '0.82rem',
                      fontWeight: 600,
                    }}
                  >
                    {WEEKDAY_FONT_SIZE_OPTIONS.map((size) => (
                      <option key={size} value={size}>{Number.isInteger(size) ? size : size.toFixed(1)}px</option>
                    ))}
                  </select>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <label htmlFor="staff-date-font-weight" style={{ fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                    날짜 글자 두께
                  </label>
                  <select
                    id="staff-date-font-weight"
                    value={dateFontWeight}
                    onChange={(e) => setDateFontWeight(Number(e.target.value) || 700)}
                    style={{
                      width: 88,
                      padding: '4px 6px',
                      border: '1px solid var(--border-color)',
                      borderRadius: 4,
                      background: 'var(--bg-secondary)',
                      color: 'var(--text-primary)',
                      fontSize: '0.82rem',
                      fontWeight: 600,
                    }}
                  >
                    {DATE_FONT_WEIGHT_OPTIONS.map((weight) => (
                      <option key={weight} value={weight}>{weight}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
                <label htmlFor="staff-memo-font-size" style={{ fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                  입력 글자 크기
                </label>
                <select
                  id="staff-memo-font-size"
                  value={memoFontSize}
                  onChange={(e) => setMemoFontSize(Number(e.target.value) || 13)}
                  style={{
                    width: 88,
                    padding: '4px 6px',
                    border: '1px solid var(--border-color)',
                    borderRadius: 4,
                    background: 'var(--bg-secondary)',
                    color: 'var(--text-primary)',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                  }}
                >
                  {MEMO_FONT_SIZE_OPTIONS.map((size) => (
                    <option key={size} value={size}>{Number.isInteger(size) ? size : size.toFixed(1)}px</option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                <button
                  type="button"
                  onClick={async () => {
                    const newCounts = { ...calendarSlotSettings?.week_slot_counts };
                    const promises = [];
                    grid.forEach((daysInWeek, wi) => {
                      const currentCount = getSlotCount(wi);
                      const newCount = Math.max(1, currentCount - 1);
                      if (newCount < currentCount) {
                        daysInWeek.forEach(dayInfo => {
                          if (dayInfo) {
                            for (let s = newCount; s < currentCount; s++) {
                              promises.push(saveStaffMemo(dayInfo.year, dayInfo.month, dayInfo.day, s, ''));
                            }
                          }
                        });
                      }
                      newCounts[String(wi)] = newCount;
                    });
                    await Promise.all(promises);
                    saveCalendarSlotSettings(currentYear, currentMonth, newCounts);
                  }}
                  style={{ flex: 1, padding: '4px 0', fontSize: '0.8rem', border: '1px solid #ccc', borderRadius: 4, background: 'var(--bg-secondary)', cursor: 'pointer' }}
                >
                  - 일괄 축소
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const newCounts = { ...calendarSlotSettings?.week_slot_counts };
                    const promises = [];
                    grid.forEach((daysInWeek, wi) => {
                      const currentCount = getSlotCount(wi);
                      const newCount = Math.min(20, currentCount + 1);
                      if (newCount > currentCount) {
                        daysInWeek.forEach(dayInfo => {
                          if (dayInfo) {
                            const oldLastSlot = currentCount - 1;
                            const newLastSlot = newCount - 1;
                            const key = `${dayInfo.year}-${dayInfo.month}-${dayInfo.day}-${oldLastSlot}`;
                            const content = staffMemos[key]?.content || '';
                            if (/\d/.test(content)) {
                              promises.push(saveStaffMemo(dayInfo.year, dayInfo.month, dayInfo.day, newLastSlot, content));
                              promises.push(saveStaffMemo(dayInfo.year, dayInfo.month, dayInfo.day, oldLastSlot, ''));
                            }
                          }
                        });
                      }
                      newCounts[String(wi)] = newCount;
                    });
                    await Promise.all(promises);
                    saveCalendarSlotSettings(currentYear, currentMonth, newCounts);
                  }}
                  style={{ flex: 1, padding: '4px 0', fontSize: '0.8rem', border: '1px solid #ccc', borderRadius: 4, background: 'var(--bg-secondary)', cursor: 'pointer' }}
                >
                  + 일괄 추가
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {grid.map((_, wi) => {
                  const currentCount = getSlotCount(wi);
                  return (
                    <div key={wi} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span>{wi + 1}주차</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <button
                          type="button"
                          onClick={async () => {
                            const newCount = Math.max(1, currentCount - 1);
                            if (newCount < currentCount) {
                              const daysInWeek = grid[wi] || [];
                              const promises = [];
                              for (const dayInfo of daysInWeek) {
                                if (dayInfo) {
                                  for (let s = newCount; s < currentCount; s++) {
                                    promises.push(saveStaffMemo(dayInfo.year, dayInfo.month, dayInfo.day, s, ''));
                                  }
                                }
                              }
                              await Promise.all(promises);
                            }
                            const newCounts = { ...(calendarSlotSettings?.week_slot_counts || {}), [String(wi)]: newCount };
                            saveCalendarSlotSettings(currentYear, currentMonth, newCounts);
                          }}
                          style={{ width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #ccc', borderRadius: 2, background: 'var(--bg-secondary)', cursor: 'pointer' }}
                        >-</button>
                        <span style={{ width: 24, textAlign: 'center' }}>{currentCount}</span>
                        <button
                          type="button"
                          onClick={async () => {
                            const newCount = Math.min(20, currentCount + 1);
                            if (newCount > currentCount) {
                              const daysInWeek = grid[wi] || [];
                              const promises = [];
                              for (const dayInfo of daysInWeek) {
                                if (dayInfo) {
                                  const oldLastSlot = currentCount - 1;
                                  const newLastSlot = newCount - 1;
                                  const key = `${dayInfo.year}-${dayInfo.month}-${dayInfo.day}-${oldLastSlot}`;
                                  const content = staffMemos[key]?.content || '';
                                  if (/\d/.test(content)) {
                                    promises.push(saveStaffMemo(dayInfo.year, dayInfo.month, dayInfo.day, newLastSlot, content));
                                    promises.push(saveStaffMemo(dayInfo.year, dayInfo.month, dayInfo.day, oldLastSlot, ''));
                                  }
                                }
                              }
                              await Promise.all(promises);
                            }
                            const newCounts = { ...(calendarSlotSettings?.week_slot_counts || {}), [String(wi)]: newCount };
                            saveCalendarSlotSettings(currentYear, currentMonth, newCounts);
                          }}
                          style={{ width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #ccc', borderRadius: 2, background: 'var(--bg-secondary)', cursor: 'pointer' }}
                        >+</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>,
        portalTarget
      )}
      {/* Unified input: hidden when not editing, positioned over cell when editing */}
      <input
        ref={hiddenInputRef}
        data-hidden-input="true"
        className="memo-slot-input"
        style={{ position: 'absolute', top: 0, left: 0, width: '1px', height: '1px', opacity: 0, padding: 0, border: 'none', outline: 'none', pointerEvents: 'none', zIndex: -1, boxSizing: 'border-box' }}
        onBlur={(e) => {
          if (skipNextBlurSaveRef.current) {
            skipNextBlurSaveRef.current = false;
            return;
          }
          if (editingCell && selectedCell) {
            saveCell(selectedCell.wi, selectedCell.di, selectedCell.slot, e.target.value);
          }
        }}
        onKeyDown={(e) => {
          if (editingCell) {
            handleEditKey(e, selectedCell.wi, selectedCell.di, selectedCell.slot);
          }
        }}
        onContextMenu={(e) => {
          if (!editingCell) return;
          e.preventDefault();
          e.stopPropagation();
          setColorMenu(null);
          const MENU_W = 160; const MENU_H = 200;
          setContextMenu({
            x: e.clientX + MENU_W > window.innerWidth ? e.clientX - MENU_W : e.clientX,
            y: e.clientY + MENU_H > window.innerHeight ? Math.max(10, e.clientY - MENU_H) : e.clientY,
            mode: 'text',
          });
        }}
      />
      <div className="calendar-grid" style={{ gridTemplateColumns: colWidth ? `repeat(7, ${colWidth}px)` : 'repeat(7, minmax(0, 1fr))' }}>
        {WEEKDAYS.map((day, i) => (
          <div key={`h-${i}`} className={`calendar-weekday-header${i === 0 ? ' sunday' : ''}${i === 6 ? ' saturday' : ''}`} style={{ position: 'relative' }}>
            {day}
            <div className="col-resizer" onMouseDown={startColResize} />
          </div>
        ))}
        {grid.map((week, wi) => week.map((dayInfo, di) => {
          const isToday = isSameDate(dayInfo.date, today);
          let cc = 'calendar-cell';
          if (dayInfo.isOtherMonth) cc += ' other-month';
          if (dayInfo.isSunday) cc += ' sunday';
          if (dayInfo.isSaturday) cc += ' saturday';
          if (dayInfo.isHoliday) cc += ' holiday';
          if (isToday) cc += ' today';

          return (
            <div key={`${wi}-${di}`} className={cc} style={{ height: `${rowHeight}px` }}>
              <div className="calendar-date">
                <span className="calendar-date-number">{dayInfo.day}</span>
                <div
                  className="date-row-resizer"
                  title="날짜 셀 높이 조절"
                  onMouseDown={startDateRowResize}
                />
              </div>
              <div className="calendar-memos" style={{ gridTemplateRows: `repeat(${getSlotCount(wi)}, minmax(0, 1fr))` }}>
                {Array.from({ length: getSlotCount(wi) }, (_, slot) => {
                  const key = memoKey(wi, di, slot);
                  const isSel = selectedKeys.has(key);
                  const isPri = selectedCell?.key === key;
                  const isEd = editingCell === key;
                  const shouldHideLastRowContent = !showLastRows && slot === getSlotCount(wi) - 1;
                  let clipMode = null;
                  if (clipboardSource?.keys?.has(key)) clipMode = clipboardSource.mode;

                  // 공휴일 이름: 첫 번째 슬롯에 표시
                  const holidayName = (slot === 0 && dayInfo.isHoliday) ? holidayNames.get(dayInfo.key) : null;
                  const rawMemo = staffMemos[key];
                  const memoContent = shouldHideLastRowContent ? '' : (rawMemo?.content || '');
                  const displayMemo = shouldHideLastRowContent
                    ? { ...(rawMemo || {}), content: '' }
                    : getStaffCalendarDisplayMemo(rawMemo, slot === getSlotCount(wi) - 1);
                  const isDepartmentHidden = shouldHideStaffMemoByDepartment(memoContent, hiddenDepartments);
                  const autoFontColor = getAutoFontColorForStaffMemo(memoContent);

                  return (
                    <MemoSlot key={slot} memo={displayMemo} dayInfo={dayInfo} slotIndex={slot}
                      isSelected={isSel} isPrimary={isPri} isEditing={isEd} clipboardMode={clipMode}
                      cellId={key}
                      autoFontColor={autoFontColor}
                      holidayName={holidayName}
                      isDepartmentHidden={isDepartmentHidden}
                      onMouseDown={(e) => onCellMouseDown(wi, di, slot, e)}
                      onMouseEnter={(e) => onCellMouseEnter(wi, di, slot, e)}
                      onDoubleClick={() => onCellDblClick(wi, di, slot)}
                      onContextMenu={(e) => onCellCtxMenu(wi, di, slot, e)}
                    />
                  );
                })}
              </div>
              {di < 6 && <div className="col-resizer" onMouseDown={startColResize} />}
              {wi < grid.length - 1 && <div className="row-resizer" onMouseDown={startRowResize} />}
            </div>
          );
        }))}
      </div>

      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="shockwave-context-menu staff-calendar-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x, zIndex: 1000, position: 'fixed' }}
          onMouseDown={(e) => {
            if (contextMenu.mode === 'text' && e.target.tagName !== 'INPUT') e.preventDefault();
            e.stopPropagation();
          }}
        >
          <button type="button" className="context-menu-item staff-context-command" onClick={() => ctxAction('copy')}><span>복사</span><span className="staff-context-shortcut">{shortcutModifier}+C</span></button>
          <button type="button" className="context-menu-item staff-context-command" onClick={() => ctxAction('cut')}><span>잘라내기</span><span className="staff-context-shortcut">{shortcutModifier}+X</span></button>
          <button type="button" className="context-menu-item staff-context-command" onClick={() => ctxAction('paste')}><span>붙여넣기</span><span className="staff-context-shortcut">{shortcutModifier}+V</span></button>
          <div className="context-menu-divider" />
          <button type="button" className="context-menu-item staff-context-command" onClick={() => ctxAction('delete')}><span>삭제</span><span className="staff-context-shortcut">Delete</span></button>
          <div className="context-menu-divider" />
          <button type="button" className="context-menu-item staff-color-menu-trigger" onClick={(e) => openColorMenu('font', e)}>
            <span className="staff-color-menu-icon staff-color-menu-icon--font" aria-hidden="true">A</span>
            글자색
          </button>
          <button type="button" className="context-menu-item staff-color-menu-trigger" onClick={(e) => openColorMenu('bg', e)}>
            <span className="staff-color-menu-icon staff-color-menu-icon--bg" aria-hidden="true">
              <FillColorIcon />
            </span>
            배경색
          </button>
        </div>
      )}

      {colorMenu && (
        <div
          ref={colorMenuRef}
          className="staff-sheets-color-menu"
          style={{ top: colorMenu.y, left: colorMenu.x, zIndex: 1001, position: 'fixed' }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="staff-sheets-reset"
            onClick={() => applyColor(colorMenu.type, null)}
          >
            <span className="staff-sheets-reset-icon" aria-hidden="true" />
            재설정
          </button>
          <div className="staff-sheets-color-grid" aria-label={`${colorMenu.type === 'font' ? '글자색' : '배경색'} 색상표`}>
            {SHEETS_COLOR_GRID.flat().map((color, index) => (
              <button
                key={`${color}-${index}`}
                type="button"
                className={getSwatchClassName(color)}
                onClick={() => applyColor(colorMenu.type, color)}
                style={{ backgroundColor: color }}
                title={color}
                aria-label={color}
              />
            ))}
          </div>
          <div className="staff-sheets-section-title">표준</div>
          <div className="staff-sheets-standard-row">
            {SHEETS_STANDARD_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                className={getSwatchClassName(color, 'staff-sheets-swatch--standard')}
                onClick={() => applyColor(colorMenu.type, color)}
                style={{ backgroundColor: color }}
                title={color}
                aria-label={color}
              />
            ))}
          </div>
          <div className="staff-sheets-divider" />
          <div className="staff-sheets-section-title">맞춤</div>
          <div className="staff-sheets-custom-row">
            {customColors.map((color) => (
              <button
                key={color}
                type="button"
                className={getSwatchClassName(color, 'staff-sheets-swatch--custom')}
                onClick={() => applyColor(colorMenu.type, color)}
                style={{ backgroundColor: color }}
                title={color}
                aria-label={color}
              />
            ))}
            <input
              ref={customColorInputRef}
              type="color"
              className="staff-sheets-custom-input"
              value={customColorDraft}
              onChange={(e) => {
                const nextColor = e.target.value;
                setCustomColorDraft(nextColor);
                const type = pendingCustomColorTypeRef.current || pendingCustomColorType;
                if (type) {
                  addCustomColor(type, nextColor);
                  pendingCustomColorTypeRef.current = null;
                  setPendingCustomColorType(null);
                }
              }}
              title="사용자 지정 색상 선택"
            />
            <button
              type="button"
              className="staff-sheets-custom-add"
              onClick={() => openCustomColorPicker(colorMenu.type)}
              title="맞춤 색상 추가"
            >
              +
            </button>
            <button
              type="button"
              className="staff-sheets-eyedropper"
              onClick={() => handleEyedropper(colorMenu.type)}
              title="스포이드"
            >
              ◉
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
