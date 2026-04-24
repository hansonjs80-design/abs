import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { flushSync } from 'react-dom';
import { useSchedule } from '../../contexts/ScheduleContext';
import { generateCalendarGrid, getTodayKST, isSameDate } from '../../lib/calendarUtils';
import { WEEKDAYS } from '../../lib/constants';
import {
  getEffectiveStaffScheduleBlockRules,
  normalizeStaffScheduleRuleText,
} from '../../lib/staffScheduleBlockRules';
import { useToast } from '../common/Toast';
import MemoSlot from './MemoSlot';

const COL_W_KEY = 'staff-calendar-col-width';
const ROW_H_KEY = 'staff-calendar-row-height';

export default function StaffCalendar() {
  const { currentYear, currentMonth, navigateMonth, staffMemos, loadStaffMemos, saveStaffMemo, holidays, holidayNames, loadHolidays, shockwaveSettings, loadShockwaveSettings } = useSchedule();
  const { addToast } = useToast();

  const [colWidth, setColWidth] = useState(() => { const v = Number(localStorage.getItem(COL_W_KEY)); return v > 0 ? v : 0; });
  const [rowHeight, setRowHeight] = useState(() => { const v = Number(localStorage.getItem(ROW_H_KEY)); return v >= 60 ? v : 120; });
  const [undoStack, setUndoStack] = useState([]);
  const [selectedCell, setSelectedCell] = useState(null);
  const [rangeEnd, setRangeEnd] = useState(null);
  const [selectedKeys, setSelectedKeys] = useState(() => new Set());
  const [editingCell, setEditingCell] = useState(null);
  const [editSessionId, setEditSessionId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [clipboardSource, setClipboardSource] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [colorMenu, setColorMenu] = useState(null); // { type: 'font' | 'bg' }
  const viewRef = useRef(null);
  const contextMenuRef = useRef(null);
  const dragRef = useRef(null);
  const pendingDragRef = useRef(null);
  const hiddenInputRef = useRef(null);
  const editInputRef = useRef(null);
  const skipNextBlurSaveRef = useRef(false);

  const today = getTodayKST();
  const { grid } = useMemo(() => generateCalendarGrid(currentYear, currentMonth, holidays), [currentYear, currentMonth, holidays]);
  const staffBlockRules = useMemo(
    () => getEffectiveStaffScheduleBlockRules(shockwaveSettings, currentYear, currentMonth).rules,
    [shockwaveSettings, currentYear, currentMonth]
  );
  const normalizeRuleText = useCallback((value) => normalizeStaffScheduleRuleText(value), []);
  const getAutoFontColorForStaffMemo = useCallback((content) => {
    const normalizedContent = normalizeRuleText(content);
    if (!normalizedContent) return null;
    const matchedRules = (staffBlockRules || [])
      .filter((item) => {
        if (item?.enabled === false || !item?.keyword || !item?.font_color) return false;
        return normalizedContent.includes(normalizeRuleText(item.keyword));
      })
      .sort((a, b) => normalizeRuleText(b.keyword).length - normalizeRuleText(a.keyword).length);
    const rule = matchedRules[0];
    return rule?.font_color || null;
  }, [staffBlockRules, normalizeRuleText]);

  // ── Key helpers: memoKey = "year-month-day-slot" matching staffMemos format ──
  const memoKey = useCallback((wi, di, slot) => {
    const d = grid[wi]?.[di];
    return d ? `${d.year}-${d.month}-${d.day}-${slot}` : null;
  }, [grid]);

  const makeCell = useCallback((wi, di, slot) => {
    const key = memoKey(wi, di, slot);
    return key ? { x: di, y: wi * 6 + slot, wi, di, slot, key } : null;
  }, [memoKey]);

  const cellFromXY = useCallback((x, y) => {
    const wi = Math.floor(y / 6), slot = y % 6, di = x;
    if (di < 0 || di >= 7 || wi < 0 || wi >= grid.length) return null;
    return makeCell(wi, di, slot);
  }, [grid, makeCell]);

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

  const recordUndo = useCallback((a) => setUndoStack(p => [a, ...p].slice(0, 50)), []);

  const doUndo = useCallback(async () => {
    const a = undoStack[0]; if (!a) return;
    setUndoStack(p => p.slice(1));
    if (a.type === 'edit') await saveStaffMemo(a.year, a.month, a.day, a.slot, a.oldVal);
    else if (a.type === 'bulk') await Promise.all(a.items.map(m => saveStaffMemo(m.year, m.month, m.day, m.slot, m.content)));
  }, [undoStack, saveStaffMemo]);

  // ── Resize ──
  const startColResize = (e) => {
    e.preventDefault(); e.stopPropagation();
    const sx = e.clientX, cw = colWidth || e.target.parentElement.offsetWidth;
    const move = (ev) => setColWidth(Math.max(50, cw + ev.clientX - sx));
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  };
  const startRowResize = (e) => {
    e.preventDefault(); e.stopPropagation();
    const sy = e.clientY, ch = rowHeight;
    const move = (ev) => setRowHeight(Math.max(60, ch + ev.clientY - sy));
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  };

  useEffect(() => {
    loadStaffMemos(currentYear, currentMonth, { includeAdjacentMonths: true });
    loadHolidays(currentYear, currentMonth);
    loadShockwaveSettings();
  }, [currentYear, currentMonth, loadStaffMemos, loadHolidays, loadShockwaveSettings]);
  useEffect(() => { if (colWidth > 0) localStorage.setItem(COL_W_KEY, colWidth); else localStorage.removeItem(COL_W_KEY); localStorage.setItem(ROW_H_KEY, rowHeight); }, [colWidth, rowHeight]);

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

  const beginEdit = useCallback((key, val, preserve) => {
    flushSync(() => {
      setEditingCell(key);
      setEditValue(val);
      if (preserve) setEditSessionId(Date.now());
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
        el.style.fontSize = '0.97rem';
        el.style.fontWeight = '600';
        el.style.textAlign = 'right';
        el.style.boxSizing = 'border-box';
        el.style.background = 'var(--bg-input, #fff)';
        el.style.color = 'var(--text-primary, #000)';
        el.style.outline = 'none';
        if (preserve) {
          el.value = val;
          el.select();
        }
        el.focus({ preventScroll: true });
      }
    });
  }, []);

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
        items.push({ year, month, day, slot, content: staffMemos[k].content });
        proms.push(saveStaffMemo(year, month, day, slot, ''));
      }
    }
    if (proms.length) { recordUndo({ type: 'bulk', items }); await Promise.all(proms); }
  }, [staffMemos, dayFromKey, saveStaffMemo, recordUndo]);

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
    cells.forEach(c => data.set(`${c.x - minX}-${c.y - minY}`, staffMemos[c.key]?.content || ''));

    setClipboardSource({ keys: new Set(selectedKeys), minX, maxX, minY, maxY, mode: 'copy', data });
    const rows = [];
    for (let y = minY; y <= maxY; y++) { const r = []; for (let x = minX; x <= maxX; x++) r.push(data.get(`${x - minX}-${y - minY}`) || ''); rows.push(r.join('\t')); }
    navigator.clipboard?.writeText(rows.join('\n')).catch(() => {});
    addToast('복사됨', 'info');
  }, [selectedKeys, staffMemos, grid, addToast]);

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
          const old = staffMemos[tc.key]?.content || '';
          if (old !== v) { items.push({ year: d.year, month: d.month, day: d.day, slot: tc.slot, content: old }); proms.push(saveStaffMemo(d.year, d.month, d.day, tc.slot, v)); }
        }
      }
      if (clipboardSource.mode === 'cut') {
        for (const k of clipboardSource.keys) { const { year, month, day, slot } = dayFromKey(k); const old = staffMemos[k]?.content || ''; if (old) { items.push({ year, month, day, slot, content: old }); proms.push(saveStaffMemo(year, month, day, slot, '')); } }
        setClipboardSource(null);
      }
    } else if (text) {
      const rows = text.split(/\r?\n/).map(r => r.split('\t'));
      for (let dy = 0; dy < rows.length; dy++) for (let dx = 0; dx < rows[dy].length; dx++) {
        const v = rows[dy][dx].trim(); const tc = cellFromXY(sx + dx, sy + dy); if (!tc) continue;
        const d = grid[tc.wi]?.[tc.di]; if (!d) continue;
        const old = staffMemos[tc.key]?.content || '';
        if (old !== v) { items.push({ year: d.year, month: d.month, day: d.day, slot: tc.slot, content: old }); proms.push(saveStaffMemo(d.year, d.month, d.day, tc.slot, v)); }
      }
    }
    if (proms.length) { recordUndo({ type: 'bulk', items }); await Promise.all(proms); addToast('붙여넣기 완료', 'success'); }
    setClipboardSource(null);
  }, [selectedCell, clipboardSource, cellFromXY, grid, staffMemos, saveStaffMemo, dayFromKey, recordUndo, addToast]);

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
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) {
      e.preventDefault(); e.target.blur();
      const c = cellFromXY(di, wi * 6 + slot); if (!c) return;
      let nx = c.x, ny = c.y;
      if (e.key === 'ArrowUp') ny--; if (e.key === 'ArrowDown') ny++; if (e.key === 'ArrowLeft') nx--; if (e.key === 'ArrowRight') nx++;
      const nc = cellFromXY(nx, ny); if (nc) selectSingle(nc); return;
    }
    if (e.key === 'Enter') { if (e.nativeEvent?.isComposing) return; e.target.blur(); const c = cellFromXY(di, wi*6+slot); const nc = cellFromXY(c.x, c.y+1); if (nc) selectSingle(nc); }
    if (e.key === 'Escape') { setEditingCell(null); viewRef.current?.focus({ preventScroll: true }); }
    if (e.key === 'Tab') { e.preventDefault(); e.target.blur(); const c = cellFromXY(di, wi*6+slot); const nc = cellFromXY(c.x + (e.shiftKey ? -1 : 1), c.y); if (nc) selectSingle(nc); }
  }, [cellFromXY, selectSingle]);

  // ── Grid key handler ──
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape' && clipboardSource) { setClipboardSource(null); return; }
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
  }, [selectedCell, editingCell, selectedKeys, cellFromXY, selectSingle, buildRange, beginEdit, staffMemos, doUndo, clipboardSource, deleteCells, handleCopy, handleCut]);

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
      const txt = ev.clipboardData?.getData('text/plain'); if (!txt) return;
      ev.preventDefault(); handlePaste(txt);
    };
    window.addEventListener('paste', h, true); return () => window.removeEventListener('paste', h, true);
  }, [selectedCell, editingCell, handlePaste]);

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
    beginEdit(key, staffMemos[key]?.content || '', true);
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

  // 색상 팔레트가 열릴 때 메뉴 위치를 동적으로 재조정
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
  }, [colorMenu]);

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

  const PRESET_COLORS = [
    '#000000','#e53e3e','#dd6b20','#d69e2e','#38a169','#3182ce','#805ad5','#d53f8c',
    '#ffffff','#feb2b2','#fbd38d','#fefcbf','#c6f6d5','#bee3f8','#d6bcfa','#fed7e2',
  ];

  const applyColor = useCallback(async (type, color) => {
    const promises = [];
    for (const k of selectedKeys) {
      const { year, month, day, slot } = dayFromKey(k);
      const memo = staffMemos[k];
      if (type === 'font') {
        promises.push(saveStaffMemo(year, month, day, slot, memo?.content || '', color, undefined));
      } else {
        promises.push(saveStaffMemo(year, month, day, slot, memo?.content || '', undefined, color));
      }
    }
    await Promise.all(promises);
    setContextMenu(null); setColorMenu(null);
    addToast(type === 'font' ? '글자색 적용' : '배경색 적용', 'success');
  }, [selectedKeys, staffMemos, dayFromKey, saveStaffMemo, addToast]);

  const handleEyedropper = useCallback(async (type) => {
    if (!window.EyeDropper) { addToast('이 브라우저는 스포이드를 지원하지 않습니다.', 'info'); return; }
    try {
      const dropper = new window.EyeDropper();
      const result = await dropper.open();
      if (result?.sRGBHex) applyColor(type, result.sRGBHex);
    } catch (e) { /* cancelled */ }
  }, [applyColor, addToast]);

  return (
    <div className="staff-calendar animate-fade-in" ref={viewRef} style={{ outline: 'none', position: 'relative' }}>
      <div className="staff-calendar-toolbar">
        <button
          type="button"
          className="staff-month-nav-btn"
          onClick={() => navigateMonth(-1)}
          aria-label="이전 달"
        >
          ‹
        </button>
        <h2 className="staff-calendar-title">
          {currentYear}년 {String(currentMonth).padStart(2, '0')}월 직원 근무표
        </h2>
        <button
          type="button"
          className="staff-month-nav-btn"
          onClick={() => navigateMonth(1)}
          aria-label="다음 달"
        >
          ›
        </button>
      </div>
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
            {i < 6 && <div className="col-resizer" onMouseDown={startColResize} />}
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
              </div>
              <div className="calendar-memos">
                {[0,1,2,3,4,5].map(slot => {
                  const key = memoKey(wi, di, slot);
                  const isSel = selectedKeys.has(key);
                  const isPri = selectedCell?.key === key;
                  const isEd = editingCell === key;
                  let clipMode = null;
                  if (clipboardSource?.keys?.has(key)) clipMode = clipboardSource.mode;

                  // 공휴일 이름: 첫 번째 슬롯에 표시
                  const holidayName = (slot === 0 && dayInfo.isHoliday) ? holidayNames.get(dayInfo.key) : null;
                  const memoContent = staffMemos[key]?.content || '';
                  const autoFontColor = getAutoFontColorForStaffMemo(memoContent);

                  return (
                    <MemoSlot key={slot} memo={staffMemos[key]} dayInfo={dayInfo} slotIndex={slot}
                      isSelected={isSel} isPrimary={isPri} isEditing={isEd} clipboardMode={clipMode}
                      cellId={key}
                      autoFontColor={autoFontColor}
                      holidayName={holidayName}
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
          <button type="button" className="context-menu-item" onClick={() => ctxAction('copy')}>복사 (Cmd+C)</button>
          <button type="button" className="context-menu-item" onClick={() => ctxAction('cut')}>잘라내기 (Cmd+X)</button>
          <button type="button" className="context-menu-item" onClick={() => ctxAction('paste')}>붙여넣기 (Cmd+V)</button>
          <div className="context-menu-divider" />
          <button type="button" className="context-menu-item" onClick={() => ctxAction('delete')}>삭제 (Delete)</button>
          <div className="context-menu-divider" />
          <button type="button" className="context-menu-item" onClick={() => setColorMenu(colorMenu?.type === 'font' ? null : { type: 'font' })} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 14, height: 14, borderRadius: 2, background: '#3182ce', border: '1px solid #ccc', flexShrink: 0 }} />
            글자색
          </button>
          <button type="button" className="context-menu-item" onClick={() => setColorMenu(colorMenu?.type === 'bg' ? null : { type: 'bg' })} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 14, height: 14, borderRadius: 2, background: '#c6f6d5', border: '1px solid #ccc', flexShrink: 0 }} />
            배경색
          </button>

          {colorMenu && (
            <div style={{ borderTop: '1px solid var(--border-color)', padding: '8px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 2 }}>
                {colorMenu.type === 'font' ? '글자색 선택' : '배경색 선택'}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 3 }}>
                {PRESET_COLORS.map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => applyColor(colorMenu.type, c)}
                    style={{ width: 22, height: 22, borderRadius: 3, background: c, border: '1px solid #999', cursor: 'pointer', padding: 0 }}
                    title={c}
                  />
                ))}
              </div>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <input
                  type="color"
                  style={{ width: 28, height: 28, padding: 0, border: '1px solid #ccc', borderRadius: 3, cursor: 'pointer' }}
                  onChange={(e) => applyColor(colorMenu.type, e.target.value)}
                  title="사용자 지정 색상"
                />
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>사용자 지정</span>
                <button
                  type="button"
                  onClick={() => handleEyedropper(colorMenu.type)}
                  style={{ marginLeft: 'auto', padding: '2px 6px', fontSize: 12, borderRadius: 3, border: '1px solid #ccc', background: 'var(--bg-secondary)', cursor: 'pointer' }}
                  title="스포이드"
                >
                  💧
                </button>
              </div>
              <button
                type="button"
                className="context-menu-item"
                onClick={() => applyColor(colorMenu.type, null)}
                style={{ fontSize: 12, padding: '3px 6px' }}
              >
                색상 초기화
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
