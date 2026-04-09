import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useSchedule } from '../../contexts/ScheduleContext';
import { generateShockwaveCalendar, getTodayKST, isSameDate, formatDisplayDate } from '../../lib/calendarUtils';
import { supabase } from '../../lib/supabaseClient';
import { has4060Pattern } from '../../lib/memoParser';
import { useToast } from '../common/Toast';

export default function ShockwaveView({ therapists, settings, memos, onLoadMemos, onSaveMemo, holidays }) {
  const { currentYear, currentMonth } = useSchedule();
  const { addToast } = useToast();
  const viewRef = useRef(null);

  // ── 셀 조작 상태 (구글 시트 방식) ──
  const [selectedCell, setSelectedCell] = useState(null);     // { w, d, r, c }
  const [rangeEnd, setRangeEnd] = useState(null);             // { w, d, r, c } (Shift 선택 끝점)
  const [editingCell, setEditingCell] = useState(null);       // "w-d-r-c" 키 문자열
  const [editValue, setEditValue] = useState('');
  const [activeDayKey, setActiveDayKey] = useState(null);     // "w-d" (시간열 표시 대상)
  const clipboardRef = useRef({ content: '', mode: null });   // mode: 'copy' | 'cut', cutKey

  const colCount = Math.max(1, therapists.length);

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
        if (!lunchAdded) {
          result.push({ ...slot, idx, disabled: true, isLunch: true, label: `점심 (${lunchStart}~${lunchEnd})`, isMergedLunch: true });
          lunchAdded = true;
        }
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

  // ── 선택 범위 계산 ──
  const getSelectedRange = useCallback(() => {
    if (!selectedCell) return new Set();
    if (!rangeEnd || (rangeEnd.w === selectedCell.w && rangeEnd.d === selectedCell.d && rangeEnd.r === selectedCell.r && rangeEnd.c === selectedCell.c)) {
      return new Set([cellKey(selectedCell.w, selectedCell.d, selectedCell.r, selectedCell.c)]);
    }
    // 같은 요일 안에서만 범위 선택 가능
    if (selectedCell.w !== rangeEnd.w || selectedCell.d !== rangeEnd.d) {
      return new Set([cellKey(selectedCell.w, selectedCell.d, selectedCell.r, selectedCell.c)]);
    }
    const rMin = Math.min(selectedCell.r, rangeEnd.r);
    const rMax = Math.max(selectedCell.r, rangeEnd.r);
    const cMin = Math.min(selectedCell.c, rangeEnd.c);
    const cMax = Math.max(selectedCell.c, rangeEnd.c);
    const keys = new Set();
    for (let r = rMin; r <= rMax; r++) {
      for (let c = cMin; c <= cMax; c++) {
        keys.add(cellKey(selectedCell.w, selectedCell.d, r, c));
      }
    }
    return keys;
  }, [selectedCell, rangeEnd]);

  const selectedKeys = getSelectedRange();

  // ── 셀 클릭 = 선택 (편집 아님) ──
  const handleCellClick = useCallback((w, d, r, c, e) => {
    if (e?.shiftKey && selectedCell) {
      // Shift 클릭 → 범위 선택
      setRangeEnd({ w, d, r, c });
    } else {
      setSelectedCell({ w, d, r, c });
      setRangeEnd(null);
    }
    setEditingCell(null);
    setActiveDayKey(dayKey(w, d));
  }, [selectedCell]);

  // ── 더블 클릭 = 편집 모드 진입 ──
  const handleCellDoubleClick = useCallback((w, d, r, c, content) => {
    const key = cellKey(w, d, r, c);
    setEditingCell(key);
    setEditValue(content || '');
    setSelectedCell({ w, d, r, c });
    setRangeEnd(null);
    setActiveDayKey(dayKey(w, d));
  }, []);

  // ── 편집 저장 ──
  const handleCellSave = useCallback(async (w, d, r, c) => {
    setEditingCell(null);
    const key = cellKey(w, d, r, c);
    const oldContent = memos[key]?.content || '';
    const newContent = editValue.trim();
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
        setRangeEnd({ w, d, r: nr, c: nc });
      } else {
        setSelectedCell({ w, d, r: nr, c: nc });
        setRangeEnd(null);
      }
      return;
    }

    // Tab → 우측 이동
    if (e.key === 'Tab') {
      e.preventDefault();
      const nc = e.shiftKey ? Math.max(0, c - 1) : Math.min(colCount - 1, c + 1);
      setSelectedCell({ w, d, r, c: nc });
      setRangeEnd(null);
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
  }, [selectedCell, editingCell, memos, selectedKeys, colCount, baseTimeSlots.length, currentYear, currentMonth, onSaveMemo, deleteCells, addToast]);

  // 키보드 이벤트 등록
  useEffect(() => {
    const el = viewRef.current;
    if (el) {
      el.addEventListener('keydown', handleKeyDown);
      return () => el.removeEventListener('keydown', handleKeyDown);
    }
  }, [handleKeyDown]);

  // 편집 완료 후 아래로 이동
  const handleEditKeyDown = useCallback((e, w, d, r, c) => {
    if (e.key === 'Enter') {
      e.target.blur();
      // Enter 후 아래 셀로 이동
      const nr = Math.min(baseTimeSlots.length - 1, r + 1);
      setSelectedCell({ w, d, r: nr, c });
      setRangeEnd(null);
    }
    if (e.key === 'Escape') {
      setEditingCell(null);
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      e.target.blur();
      const nc = e.shiftKey ? Math.max(0, c - 1) : Math.min(colCount - 1, c + 1);
      setSelectedCell({ w, d, r, c: nc });
      setRangeEnd(null);
    }
  }, [baseTimeSlots.length, colCount]);

  return (
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
              const gridCols = showTimeCol
                ? `46px repeat(${colCount}, 1fr)`
                : `repeat(${colCount}, 1fr)`;

              let headerClass = 'sw-day-header';
              if (dayInfo.isHoliday) headerClass += ' holiday';
              else if (!dayInfo.isCurrentMonth) headerClass += ' other-month';
              else if (isToday) headerClass += ' today';
              else if (dayInfo.dow === 6) headerClass += ' saturday';

              return (
                <div key={dayIdx} className={`shockwave-day${isToday ? ' is-today' : ''}`}>
                  {/* 날짜 헤더 */}
                  <div className={headerClass}>
                    {formatDisplayDate(dayInfo.year, dayInfo.month, dayInfo.day)}
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
                  <div className="sw-schedule-body">
                    {getTimeSlotsForDay(dayInfo.dow).map((slotInfo) => {
                      const rowIdx = slotInfo.idx;
                      return (
                        <div
                          key={rowIdx}
                          className={`sw-schedule-row${slotInfo.isLunch ? ' sw-lunch-row' : ''}${slotInfo.disabled ? ' sw-disabled-row' : ''}`}
                          style={{ gridTemplateColumns: gridCols }}
                        >
                          {/* 시간 라벨 (조건부) */}
                          {showTimeCol && (
                            <div className={`sw-time-label${slotInfo.isLunch ? ' lunch' : ''}${slotInfo.disabled ? ' disabled' : ''}`} style={slotInfo.isMergedLunch ? { fontSize: '9px', whiteSpace: 'nowrap' } : undefined}>
                              {slotInfo.label}
                            </div>
                          )}

                          {slotInfo.isMergedLunch ? (
                            /* 점심시간 압축 행 - 1개의 셀로 병합 */
                            <div className="sw-cell disabled" style={{ gridColumn: `span ${colCount}`, justifyContent: 'center', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-tertiary)', opacity: 0.6, fontSize: '10px' }}>
                              점심시간
                            </div>
                          ) : slotInfo.disabled ? (
                            /* 운영 시간 외 - 빈 칸으로 차단 */
                            Array.from({ length: colCount }, (_, colIdx) => (
                              <div key={colIdx} className="sw-cell disabled" />
                            ))
                          ) : (
                            Array.from({ length: colCount }, (_, colIdx) => {
                              const key = cellKey(weekIdx, dayIdx, rowIdx, colIdx);
                              const cellData = memos[key];
                              const content = cellData?.content || '';
                              const isEditing = editingCell === key;
                              const isSelected = selectedKeys.has(key);
                              const isPrimary = selectedCell && selectedCell.w === weekIdx && selectedCell.d === dayIdx && selectedCell.r === rowIdx && selectedCell.c === colIdx;

                              let cls = 'sw-cell';
                              if (!dayInfo.isCurrentMonth) cls += ' other-month-bg';
                              else if (dayInfo.isHoliday) cls += ' holiday-bg';
                              if (cellData?.bg_color === '#ffe599') cls += ' preserve';
                              if (colCount >= 3 && has4060Pattern(content)) cls += ' color-4060';
                              if (isSelected) cls += ' selected';
                              if (isPrimary) cls += ' primary-selected';
                              if (slotInfo.isLunch) cls += ' lunch-cell';

                              if (isEditing) {
                                return (
                                  <div key={colIdx} className="sw-cell editing">
                                    <input
                                      className="sw-cell-input"
                                      value={editValue}
                                      onChange={e => setEditValue(e.target.value)}
                                      onBlur={() => handleCellSave(weekIdx, dayIdx, rowIdx, colIdx)}
                                      onKeyDown={e => handleEditKeyDown(e, weekIdx, dayIdx, rowIdx, colIdx)}
                                      autoFocus
                                    />
                                  </div>
                                );
                              }

                              return (
                                <div
                                  key={colIdx}
                                  className={cls}
                                  onClick={(e) => handleCellClick(weekIdx, dayIdx, rowIdx, colIdx, e)}
                                  onDoubleClick={() => handleCellDoubleClick(weekIdx, dayIdx, rowIdx, colIdx, content)}
                                  title={content}
                                >
                                  {content}
                                </div>
                              );
                            })
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
