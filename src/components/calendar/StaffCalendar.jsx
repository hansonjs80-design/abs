import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { flushSync } from 'react-dom';
import { useSchedule } from '../../contexts/ScheduleContext';
import { generateCalendarGrid, getTodayKST, isSameDate } from '../../lib/calendarUtils';
import { WEEKDAYS } from '../../lib/constants';
import { useToast } from '../common/Toast';
import MemoSlot from './MemoSlot';

const COL_W_KEY = 'staff-calendar-col-width';
const ROW_H_KEY = 'staff-calendar-row-height';

export default function StaffCalendar() {
  const { currentYear, currentMonth, staffMemos, loadStaffMemos, saveStaffMemo, holidays, loadHolidays } = useSchedule();
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
  const viewRef = useRef(null);
  const contextMenuRef = useRef(null);
  const dragRef = useRef(null);

  const today = getTodayKST();
  const { grid } = useMemo(() => generateCalendarGrid(currentYear, currentMonth, holidays), [currentYear, currentMonth, holidays]);

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

  useEffect(() => { loadStaffMemos(currentYear, currentMonth); loadHolidays(currentYear, currentMonth); }, [currentYear, currentMonth, loadStaffMemos, loadHolidays]);
  useEffect(() => { if (colWidth > 0) localStorage.setItem(COL_W_KEY, colWidth); else localStorage.removeItem(COL_W_KEY); localStorage.setItem(ROW_H_KEY, rowHeight); }, [colWidth, rowHeight]);

  // ── Actions ──
  const selectSingle = useCallback((cell) => {
    if (!cell) return;
    const d = grid[cell.wi]?.[cell.di];
    if (d?.isOtherMonth) return;
    setSelectedCell(cell); setRangeEnd(cell); setSelectedKeys(new Set([cell.key]));
    if (editingCell && editingCell !== cell.key) setEditingCell(null);
  }, [editingCell, grid]);

  const beginEdit = useCallback((key, val, preserve) => {
    flushSync(() => { setEditingCell(key); setEditValue(val); if (preserve) setEditSessionId(Date.now()); });
  }, []);

  const saveCell = useCallback(async (wi, di, slot, val) => {
    setEditingCell(null);
    const key = memoKey(wi, di, slot);
    const old = (staffMemos[key]?.content || '').trim();
    const nv = (val || '').trim();
    if (old !== nv) {
      const d = grid[wi][di];
      recordUndo({ type: 'edit', year: d.year, month: d.month, day: d.day, slot, oldVal: old });
      if (!await saveStaffMemo(d.year, d.month, d.day, slot, nv)) addToast('저장 실패', 'error');
    }
    viewRef.current?.focus();
  }, [staffMemos, memoKey, grid, saveStaffMemo, addToast, recordUndo]);

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
          const d = grid[tc.wi]?.[tc.di]; if (!d || d.isOtherMonth) continue;
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
        const d = grid[tc.wi]?.[tc.di]; if (!d || d.isOtherMonth) continue;
        const old = staffMemos[tc.key]?.content || '';
        if (old !== v) { items.push({ year: d.year, month: d.month, day: d.day, slot: tc.slot, content: old }); proms.push(saveStaffMemo(d.year, d.month, d.day, tc.slot, v)); }
      }
    }
    if (proms.length) { recordUndo({ type: 'bulk', items }); await Promise.all(proms); addToast('붙여넣기 완료', 'success'); }
  }, [selectedCell, clipboardSource, cellFromXY, grid, staffMemos, saveStaffMemo, dayFromKey, recordUndo, addToast]);

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
    if (e.key === 'Escape') { setEditingCell(null); viewRef.current?.focus(); }
    if (e.key === 'Tab') { e.preventDefault(); e.target.blur(); const c = cellFromXY(di, wi*6+slot); const nc = cellFromXY(c.x + (e.shiftKey ? -1 : 1), c.y); if (nc) selectSingle(nc); }
  }, [cellFromXY, selectSingle]);

  // ── Grid key handler ──
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape' && clipboardSource) { setClipboardSource(null); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); doUndo(); return; }
    if (!selectedCell) return;
    if (editingCell) { if (e.key === 'Escape') { e.preventDefault(); setEditingCell(null); viewRef.current?.focus(); } return; }

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
    if ((e.key.length === 1 || e.key === 'Process' || e.keyCode === 229) && !meta && !e.altKey) { beginEdit(selectedCell.key, '', false); return; }
  }, [selectedCell, editingCell, selectedKeys, cellFromXY, selectSingle, buildRange, beginEdit, staffMemos, doUndo, clipboardSource, deleteCells, handleCopy, handleCut]);

  useEffect(() => { const el = viewRef.current; if (el) { el.addEventListener('keydown', handleKeyDown); return () => el.removeEventListener('keydown', handleKeyDown); } }, [handleKeyDown]);
  useEffect(() => {
    const h = (ev) => { if (!selectedCell) return; const t = ev.target; if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return; const txt = ev.clipboardData?.getData('text/plain'); if (!txt) return; ev.preventDefault(); handlePaste(txt); };
    window.addEventListener('paste', h, true); return () => window.removeEventListener('paste', h, true);
  }, [selectedCell, handlePaste]);

  // ── Mouse handlers ──
  const onCellMouseDown = useCallback((wi, di, slot, e) => {
    if (e.button === 2) return;
    const cell = makeCell(wi, di, slot); if (!cell) return;
    if (grid[wi]?.[di]?.isOtherMonth) return;
    viewRef.current?.focus(); if (editingCell) setEditingCell(null); setContextMenu(null);
    if (e.shiftKey && selectedCell) { setRangeEnd(cell); setSelectedKeys(buildRange(selectedCell, cell)); }
    else { selectSingle(cell); dragRef.current = cell; }
  }, [makeCell, grid, editingCell, selectedCell, buildRange, selectSingle]);

  const onCellMouseEnter = useCallback((wi, di, slot) => {
    if (dragRef.current) { const c = makeCell(wi, di, slot); if (c) { setRangeEnd(c); setSelectedKeys(buildRange(dragRef.current, c)); } }
  }, [makeCell, buildRange]);

  const onCellDblClick = useCallback((wi, di, slot) => {
    const key = memoKey(wi, di, slot);
    beginEdit(key, staffMemos[key]?.content || '', true);
  }, [memoKey, staffMemos, beginEdit]);

  const onCellCtxMenu = useCallback((wi, di, slot, e) => {
    e.preventDefault();
    const cell = makeCell(wi, di, slot); if (!cell) return;
    if (!selectedKeys.has(cell.key)) selectSingle(cell);
    setContextMenu({ x: Math.min(e.clientX, window.innerWidth - 170), y: Math.min(e.clientY, window.innerHeight - 180) });
  }, [makeCell, selectedKeys, selectSingle]);

  useEffect(() => { const h = () => { dragRef.current = null; }; window.addEventListener('mouseup', h); return () => window.removeEventListener('mouseup', h); }, []);

  const ctxAction = useCallback((a) => {
    if (a === 'copy') handleCopy(); else if (a === 'cut') handleCut(); else if (a === 'paste') handlePaste(); else if (a === 'delete') deleteCells(selectedKeys);
    setContextMenu(null);
  }, [handleCopy, handleCut, handlePaste, deleteCells, selectedKeys]);

  return (
    <div className="staff-calendar animate-fade-in" ref={viewRef} tabIndex={0} style={{ outline: 'none' }}>
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
                {dayInfo.isHoliday && <span className="calendar-date-badge">휴일</span>}
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

                  return (
                    <MemoSlot key={slot} memo={staffMemos[key]} dayInfo={dayInfo} slotIndex={slot}
                      isSelected={isSel} isPrimary={isPri} isEditing={isEd} editValue={editValue} editSessionId={editSessionId} clipboardMode={clipMode}
                      onMouseDown={(e) => onCellMouseDown(wi, di, slot, e)}
                      onMouseEnter={() => onCellMouseEnter(wi, di, slot)}
                      onDoubleClick={() => onCellDblClick(wi, di, slot)}
                      onContextMenu={(e) => onCellCtxMenu(wi, di, slot, e)}
                      onInput={(e) => { if (!isEd) beginEdit(key, e.target.value, false); }}
                      onBlur={(e) => { if (isEd) saveCell(wi, di, slot, e.target.value); }}
                      onKeyDown={(e) => { if (isEd) handleEditKey(e, wi, di, slot); }}
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
        <div ref={contextMenuRef} className="shockwave-context-menu" style={{ top: contextMenu.y, left: contextMenu.x, zIndex: 1000, position: 'fixed' }} onMouseDown={e => e.stopPropagation()}>
          <button type="button" className="context-menu-item" onClick={() => ctxAction('copy')}>복사 (Cmd+C)</button>
          <button type="button" className="context-menu-item" onClick={() => ctxAction('cut')}>잘라내기 (Cmd+X)</button>
          <button type="button" className="context-menu-item" onClick={() => ctxAction('paste')}>붙여넣기 (Cmd+V)</button>
          <div className="context-menu-divider" />
          <button type="button" className="context-menu-item" onClick={() => ctxAction('delete')}>삭제 (Delete)</button>
        </div>
      )}
    </div>
  );
}
