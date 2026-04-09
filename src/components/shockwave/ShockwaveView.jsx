import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useSchedule } from '../../contexts/ScheduleContext';
import { generateShockwaveCalendar, getTodayKST, isSameDate, formatDisplayDate } from '../../lib/calendarUtils';
import { supabase } from '../../lib/supabaseClient';
import { has4060Pattern } from '../../lib/memoParser';
import { useToast } from '../common/Toast';

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
const HORIZONTAL_BORDER_COLOR = '#b7b7b7';

export default function ShockwaveView({ therapists, settings, memos, onLoadMemos, onSaveMemo, holidays, staffMemos = {} }) {
  const { currentYear, currentMonth } = useSchedule();
  const { addToast } = useToast();
  const viewRef = useRef(null);
  const dragSelectionRef = useRef(null);

  // ── 셀 조작 상태 (구글 시트 방식) ──
  const [selectedCell, setSelectedCell] = useState(null);     // { w, d, r, c }
  const [rangeEnd, setRangeEnd] = useState(null);             // { w, d, r, c } (Shift 선택 끝점)
  const [selectedKeys, setSelectedKeys] = useState(() => new Set());
  const [editingCell, setEditingCell] = useState(null);       // "w-d-r-c" 키 문자열
  const [editValue, setEditValue] = useState('');
  const [activeDayKey, setActiveDayKey] = useState(null);     // "w-d" (시간열 표시 대상)
  const clipboardRef = useRef({ content: '', mode: null });   // mode: 'copy' | 'cut', cutKey
  const [contextMenu, setContextMenu] = useState(null);

  const colCount = Math.max(1, therapists.length);
  const staffMemoByDate = useMemo(() => {
    const map = {};
    Object.values(staffMemos || {}).forEach(item => {
      if (!item) return;
      const key = `${item.year}-${item.month}-${item.day}`;
      if (!map[key]) map[key] = [];
      map[key].push(item.content || '');
    });
    return map;
  }, [staffMemos]);

  const isTherapistOff = useCallback((dateKey, name) => {
    if (!name) return false;
    const entries = staffMemoByDate[dateKey];
    if (!entries || entries.length === 0) return false;
    const normalizedName = name.toLowerCase();
    return entries.some(content => {
      const normalized = (content || '').toLowerCase();
      return normalized.includes(normalizedName) && normalized.includes('pt');
    });
  }, [staffMemoByDate]);

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

  const getTimeSlotsForDay = useCallback((dow) => {
    const dayOv = settings?.day_overrides?.[dow] || {};
    const dayStart = dayOv.start_time || (settings?.start_time?.substring(0, 5)) || '09:00';
    const dayEnd = dayOv.end_time || (settings?.end_time?.substring(0, 5)) || '18:00';
    const noLunch = dayOv.no_lunch === true;
    const lunchStart = noLunch ? null : (dayOv.lunch_start || null);
    const lunchEnd = noLunch ? null : (dayOv.lunch_end || null);

    const result = [];
    let lunchAdded = false;

    baseTimeSlots.forEach((slot, idx) => {
      const t = slot.time;
      const isBeforeStart = t < dayStart;
      const isAfterEnd = t >= dayEnd;
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

  useEffect(() => {
    onLoadMemos(currentYear, currentMonth);
  }, [currentYear, currentMonth, onLoadMemos]);

  const weeks = useMemo(() => {
    return generateShockwaveCalendar(currentYear, currentMonth, holidays);
  }, [currentYear, currentMonth, holidays]);

  // ── 셀 키 헬퍼 ──
  const cellKey = (w, d, r, c) => `${w}-${d}-${r}-${c}`;
  const dayKey = (w, d) => `${w}-${d}`;

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
    setActiveDayKey(dayKey(w, d));
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
    setActiveDayKey(dayKey(w, d));
  }, [selectSingleCell]);

  // ── 편집 저장 ──
  const handleCellSave = useCallback(async (w, d, r, c, nextValue = editValue) => {
    setEditingCell(null);
    const key = cellKey(w, d, r, c);
    const oldContent = memos[key]?.content || '';
    const newContent = nextValue.trim();
    if (newContent === oldContent) return;
    const success = await onSaveMemo(currentYear, currentMonth, w, d, r, c, newContent);
    if (!success) addToast('저장 실패', 'error');
  }, [editValue, currentYear, currentMonth, memos, onSaveMemo, addToast]);

  // ── 셀 삭제 ──
  const deleteCells = useCallback(async (keys) => {
    for (const key of keys) {
      const [w, d, r, c] = key.split('-').map(Number);
      if (memos[key]?.content) {
        await onSaveMemo(currentYear, currentMonth, w, d, r, c, '');
      }
    }
  }, [currentYear, currentMonth, memos, onSaveMemo]);

  const tryMergeSelection = useCallback(() => {
    if (!selectedCell) return;
    const keysArray = Array.from(selectedKeys);
    if (keysArray.length <= 1) return;
    const { w, d } = selectedCell;

    let minRow = 9999, minCol = 9999, maxRow = -1, maxCol = -1;
    keysArray.forEach(k => {
      const [kw, kd, r, c] = k.split('-').map(Number);
      if (kw !== w || kd !== d) return;
      if (r < minRow) minRow = r;
      if (c < minCol) minCol = c;
      if (r > maxRow) maxRow = r;
      if (c > maxCol) maxCol = c;
    });

    if (minRow === 9999) return;
    const masterKey = cellKey(w, d, minRow, minCol);
    const isAlreadyMerged = memos[masterKey]?.merge_span?.mergedInto === null
      && (memos[masterKey]?.merge_span?.colSpan > 1 || memos[masterKey]?.merge_span?.rowSpan > 1);

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
  }, [selectedCell, selectedKeys, currentYear, currentMonth, memos, saveShockwaveMemosBulk, addToast]);

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
      let nr = r, nc = c;
      if (e.key === 'ArrowUp') nr = Math.max(0, r - 1);
      if (e.key === 'ArrowDown') nr = Math.min(baseTimeSlots.length - 1, r + 1);
      if (e.key === 'ArrowLeft') nc = Math.max(0, c - 1);
      if (e.key === 'ArrowRight') nc = Math.min(colCount - 1, c + 1);

      if (e.shiftKey) {
        const nextCell = { w, d, r: nr, c: nc };
        setRangeEnd(nextCell);
        setSelectedKeys(buildRangeKeys(selectedCell, nextCell));
      } else {
        selectSingleCell({ w, d, r: nr, c: nc });
      }
      return;
    }

    // Cmd+E → 병합 / 병합 해제
    if (isMeta && e.key.toLowerCase() === 'e') {
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
    if (isMeta && e.key === 'c') {
      e.preventDefault();
      const key = cellKey(w, d, r, c);
      const content = memos[key]?.content || '';
      clipboardRef.current = { content, mode: 'copy', key };
      try { navigator.clipboard.writeText(content); } catch(_) {}
      addToast('복사됨', 'info');
      return;
    }

    // Cmd+X → 잘라내기
    if (isMeta && e.key === 'x') {
      e.preventDefault();
      const key = cellKey(w, d, r, c);
      const content = memos[key]?.content || '';
      clipboardRef.current = { content, mode: 'cut', key };
      try { navigator.clipboard.writeText(content); } catch(_) {}
      addToast('잘라내기됨', 'info');
      return;
    }

    // Cmd+V → 붙여넣기
    if (isMeta && e.key === 'v') {
      e.preventDefault();
      const pasteContent = clipboardRef.current.content;
      if (pasteContent !== undefined && pasteContent !== null) {
        onSaveMemo(currentYear, currentMonth, w, d, r, c, pasteContent);
        // 잘라내기 모드면 원본 삭제
        if (clipboardRef.current.mode === 'cut' && clipboardRef.current.key) {
          const [ow, od, or2, oc] = clipboardRef.current.key.split('-').map(Number);
          onSaveMemo(currentYear, currentMonth, ow, od, or2, oc, '');
          clipboardRef.current = { content: pasteContent, mode: 'copy', key: null };
        }
        addToast('붙여넣기 완료', 'success');
      }
      return;
    }

    // 일반 문자 입력 → 편집 모드 진입 (기존 내용 대체)
    if (e.key.length === 1 && !isMeta && !e.altKey) {
      e.preventDefault();
      const key = cellKey(w, d, r, c);
      setEditingCell(key);
      setEditValue(e.key);
      return;
    }
  }, [selectedCell, editingCell, memos, selectedKeys, colCount, baseTimeSlots.length, currentYear, currentMonth, onSaveMemo, deleteCells, addToast, buildRangeKeys, selectSingleCell]);

  // 키보드 이벤트 등록
  const dismissContextMenu = useCallback(() => setContextMenu(null), []);

  useEffect(() => {
    const el = viewRef.current;
    if (el) {
      el.addEventListener('keydown', handleKeyDown);
      return () => el.removeEventListener('keydown', handleKeyDown);
    }
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
      if (!selectedKeys || selectedKeys.size <= 1) {
        setContextMenu(null);
        return;
      }
      event.preventDefault();
      setContextMenu({ x: event.clientX, y: event.clientY });
    };
    el.addEventListener('contextmenu', handleContext);
    return () => el.removeEventListener('contextmenu', handleContext);
  }, [selectedKeys]);

  useEffect(() => {
    if (contextMenu && selectedKeys.size <= 1) {
      setContextMenu(null);
    }
  }, [contextMenu, selectedKeys.size]);

  // 편집 완료 후 아래로 이동
  const handleEditKeyDown = useCallback((e, w, d, r, c) => {
    if (e.key === 'Enter') {
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

  return (
    <>
      <div className="shockwave-view animate-fade-in" ref={viewRef} tabIndex={0} style={{ outline: 'none' }}>
      {weeks.map((weekDays, weekIdx) => (
        <div key={weekIdx} className="shockwave-week">
          <div className="shockwave-week-label">
            📅 {weekIdx + 1}주차
          </div>
          <div className="shockwave-days">
            {weekDays.map((dayInfo, dayIdx) => {
              const isToday = isSameDate(dayInfo.date, today);
              const thisDayKey = dayKey(weekIdx, dayIdx);
              // 첫 번째 요일 또는 활성화된 요일에만 시간 열 표시
              const showTimeCol = dayIdx === 0 || activeDayKey === thisDayKey;
              const therapistCols = `repeat(${colCount}, 1.3fr)`;
              const gridCols = showTimeCol
                ? `46px ${therapistCols}`
                : therapistCols;

              let headerClass = 'sw-day-header';
              if (dayInfo.isHoliday) headerClass += ' holiday';
              else if (!dayInfo.isCurrentMonth) headerClass += ' other-month';
              else if (isToday) headerClass += ' today';
              else if (dayInfo.dow === 6) headerClass += ' saturday';

              return (
                <div key={dayIdx} className={`shockwave-day${isToday ? ' is-today' : ''}`}>
                  {/* 날짜 헤더 */}
                  <div className={headerClass}>
                    {formatDisplayDate(dayInfo.year, dayInfo.month, dayInfo.day)} ({DAY_NAMES[dayInfo.dow]})
                  </div>

                  {/* 치료사 이름 헤더 */}
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

                  {/* 스케줄 바디 */}
                  <div className="sw-schedule-body" style={{ display: 'grid', gridTemplateColumns: gridCols, gridAutoRows: 'minmax(22px, auto)', borderBottom: `1px solid ${HORIZONTAL_BORDER_COLOR}` }}>
                    {getTimeSlotsForDay(dayInfo.dow).flatMap((slotInfo, slotRenderIndex) => {
                      const rowIdx = slotInfo.idx;
                      const gridRowStart = slotRenderIndex + 1;
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
                              borderBottom: `1px solid ${HORIZONTAL_BORDER_COLOR}`,
                            }}
                          >
                            {slotInfo.label}
                          </div>
                        );
                      }

                      // 2. Cells
                      if (slotInfo.disabled) {
                        for (let colIdx = 0; colIdx < colCount; colIdx++) {
                          const isLunchCell = slotInfo.isLunch;
                          const gridColumnStart = colIdx + 2;
                          elements.push(
                            <div
                              key={`dis-${rowIdx}-${colIdx}`}
                              className={`sw-cell disabled${isLunchCell ? ' lunch-cell' : ''}`}
                              style={{
                                gridColumn: `${gridColumnStart}`,
                                gridRow: `${gridRowStart}`,
                                borderBottom: `1px solid ${HORIZONTAL_BORDER_COLOR}`,
                              }}
                            >
                              {isLunchCell && showTimeCol && colIdx === 0 ? '' : ''}
                            </div>
                          );
                        }
                      } else {
                        for (let colIdx = 0; colIdx < colCount; colIdx++) {
                          const key = cellKey(weekIdx, dayIdx, rowIdx, colIdx);
                          const cellData = memos[key];
                          const content = cellData?.content || '';
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
                            visualRowSpan = getTimeSlotsForDay(dayInfo.dow).filter(s => s.idx >= rowIdx && s.idx <= endRowIdx).length;
                          }

                          let cls = 'sw-cell';
                          if (!dayInfo.isCurrentMonth) cls += ' other-month-bg';
                          else if (dayInfo.isHoliday) cls += ' holiday-bg';
                          if (cellData?.bg_color === '#ffe599') cls += ' preserve';
                          if (colCount >= 3 && has4060Pattern(content)) cls += ' color-4060';
                          if (isSelected) cls += ' selected';
                          if (isPrimary) cls += ' primary-selected';
                          if (slotInfo.isLunch) cls += ' lunch-cell';
                          const dateKey = `${dayInfo.year}-${dayInfo.month}-${dayInfo.day}`;
                          const therapistName = therapists[colIdx]?.name || '';
                          if (!isSelected && isTherapistOff(dateKey, therapistName)) cls += ' staff-off';

                          let inlineStyle = {
                            gridColumn: `${gridColumnStart}${mergeSpan.colSpan > 1 ? ` / span ${mergeSpan.colSpan}` : ''}`,
                            gridRow: `${gridRowStart}${visualRowSpan > 1 ? ` / span ${visualRowSpan}` : ''}`,
                            borderBottom: `1px solid ${HORIZONTAL_BORDER_COLOR}`,
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
                                  className="sw-cell-input"
                                  value={editValue}
                                  onChange={e => setEditValue(e.target.value)}
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
                                onMouseEnter={() => handleCellMouseEnter(weekIdx, dayIdx, rowIdx, colIdx)}
                                onDoubleClick={() => handleCellDoubleClick(weekIdx, dayIdx, rowIdx, colIdx, content)}
                                title={content}
                              >
                                {content}
                              </div>
                            );
                          }
                        }
                      }
                      return elements;
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      </div>
      {contextMenu && (
        <div
          className="shockwave-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={handleContextMerge}
        >
          병합(Cmd+E)
        </div>
      )}
    </>
  );
}
