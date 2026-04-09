import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSchedule } from '../../contexts/ScheduleContext';
import { generateShockwaveCalendar, getTodayKST, isSameDate, formatDisplayDate } from '../../lib/calendarUtils';
import { supabase } from '../../lib/supabaseClient';
import { has4060Pattern } from '../../lib/memoParser';
import { useToast } from '../common/Toast';

export default function ShockwaveView({ therapists, settings, memos, onLoadMemos, onSaveMemo, holidays }) {
  const { currentYear, currentMonth } = useSchedule();
  const { addToast } = useToast();
  const [editingCell, setEditingCell] = useState(null);
  const [editValue, setEditValue] = useState('');

  const colCount = Math.max(1, therapists.length); // 치료사가 0명이어도 최소 1열 유지

  // 기본 시간표 (전체 범위) - 격자 기준으로 사용
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

  // 요일별 시간 슬롯 생성 (오버라이드 + 점심시간 반영)
  const getTimeSlotsForDay = useCallback((dow) => {
    const dayOv = settings?.day_overrides?.[dow] || {};
    const dayStart = dayOv.start_time || (settings?.start_time?.substring(0, 5)) || '09:00';
    const dayEnd = dayOv.end_time || (settings?.end_time?.substring(0, 5)) || '18:00';
    const lunchStart = dayOv.lunch_start || null;
    const lunchEnd = dayOv.lunch_end || null;

    return baseTimeSlots.map((slot, idx) => {
      const t = slot.time;
      const isBeforeStart = t < dayStart;
      const isAfterEnd = t >= dayEnd;
      const isLunch = lunchStart && lunchEnd && t >= lunchStart && t < lunchEnd;
      return { ...slot, idx, disabled: isBeforeStart || isAfterEnd, isLunch };
    });
  }, [baseTimeSlots, settings]);

  const ROWS_PER_DAY = baseTimeSlots.length;
  
  const today = getTodayKST();

  // 스케줄 데이터 초기 로드 (년월 바뀔때)
  useEffect(() => {
    onLoadMemos(currentYear, currentMonth);
  }, [currentYear, currentMonth, onLoadMemos]);

  const weeks = useMemo(() => {
    return generateShockwaveCalendar(currentYear, currentMonth, holidays);
  }, [currentYear, currentMonth, holidays]);

  const handleCellClick = useCallback((weekIdx, dayIdx, rowIdx, colIdx, currentContent) => {
    setEditingCell(`${weekIdx}-${dayIdx}-${rowIdx}-${colIdx}`);
    setEditValue(currentContent || '');
  }, []);

  const handleCellSave = useCallback(async (weekIdx, dayIdx, rowIdx, colIdx) => {
    setEditingCell(null);
    const key = `${weekIdx}-${dayIdx}-${rowIdx}-${colIdx}`;
    const oldContent = memos[key]?.content || '';
    const newContent = editValue.trim();

    if (newContent === oldContent) return;

    const success = await onSaveMemo(currentYear, currentMonth, weekIdx, dayIdx, rowIdx, colIdx, newContent);
    if (!success) addToast('저장 실패', 'error');
  }, [editValue, currentYear, currentMonth, memos, onSaveMemo, addToast]);

  return (
    <div className="shockwave-view animate-fade-in">
      {weeks.map((weekDays, weekIdx) => (
        <div key={weekIdx} className="shockwave-week">
          <div className="shockwave-week-label">
            📅 {weekIdx + 1}주차
          </div>
          <div className="shockwave-days">
            {weekDays.map((dayInfo, dayIdx) => {
              const isToday = isSameDate(dayInfo.date, today);

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
                  <div className="sw-therapist-header" style={{ gridTemplateColumns: `46px repeat(${colCount}, 1fr)` }}>
                    {/* 시간 표시 빈 칸 */}
                    <div className="sw-time-label" style={{ borderBottom: 'none' }}>
                      시간
                    </div>
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
                      <div key={rowIdx} className={`sw-schedule-row${slotInfo.isLunch ? ' sw-lunch-row' : ''}${slotInfo.disabled ? ' sw-disabled-row' : ''}`} style={{ gridTemplateColumns: `46px repeat(${colCount}, 1fr)` }}>
                        {/* 시간 라벨 */}
                        <div className={`sw-time-label${slotInfo.isLunch ? ' lunch' : ''}${slotInfo.disabled ? ' disabled' : ''}`}>
                          {slotInfo.label}
                        </div>
                        {slotInfo.disabled ? (
                          /* 운영 시간 외 - 빈 칸으로 차단 */
                          Array.from({ length: colCount }, (_, colIdx) => (
                            <div key={colIdx} className="sw-cell disabled" />
                          ))
                        ) : (
                        Array.from({ length: colCount }, (_, colIdx) => {
                          const cellKey = `${weekIdx}-${dayIdx}-${rowIdx}-${colIdx}`;
                          const cellData = memos[cellKey];
                          const content = cellData?.content || '';
                          const isEditing = editingCell === cellKey;

                          let cellClass = 'sw-cell';
                          if (!dayInfo.isCurrentMonth) cellClass += ' other-month-bg';
                          else if (dayInfo.isHoliday) cellClass += ' holiday-bg';

                          if (cellData?.bg_color === '#ffe599') cellClass += ' preserve';
                          if (colCount >= 3 && has4060Pattern(content)) cellClass += ' color-4060';

                          if (isEditing) {
                            return (
                              <div key={colIdx} className="sw-cell editing">
                                <input
                                  className="sw-cell-input"
                                  value={editValue}
                                  onChange={e => setEditValue(e.target.value)}
                                  onBlur={() => handleCellSave(weekIdx, dayIdx, rowIdx, colIdx)}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') e.target.blur();
                                    if (e.key === 'Escape') setEditingCell(null);
                                  }}
                                  autoFocus
                                />
                              </div>
                            );
                          }

                          return (
                            <div
                              key={colIdx}
                              className={cellClass}
                              onClick={() => handleCellClick(weekIdx, dayIdx, rowIdx, colIdx, content)}
                              title={content}
                            >
                              {content}
                            </div>
                          );
                        })}
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
