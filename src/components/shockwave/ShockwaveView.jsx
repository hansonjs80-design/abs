import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSchedule } from '../../contexts/ScheduleContext';
import { generateShockwaveCalendar, getTodayKST, isSameDate, formatDisplayDate } from '../../lib/calendarUtils';
import { supabase } from '../../lib/supabaseClient';
import { has4060Pattern } from '../../lib/memoParser';
import { useToast } from '../common/Toast';

const ROWS_PER_DAY = 31;

export default function ShockwaveView({ therapists, memos, onLoadMemos, onSaveMemo, holidays }) {
  const { currentYear, currentMonth } = useSchedule();
  const { addToast } = useToast();
  const [editingCell, setEditingCell] = useState(null);
  const [editValue, setEditValue] = useState('');

  const colCount = Math.max(1, therapists.length); // 치료사가 0명이어도 최소 1열 유지

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
                  <div className="sw-therapist-header" style={{ gridTemplateColumns: `repeat(${colCount}, 1fr)` }}>
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
                    {Array.from({ length: ROWS_PER_DAY }, (_, rowIdx) => (
                      <div key={rowIdx} className="sw-schedule-row" style={{ gridTemplateColumns: `repeat(${colCount}, 1fr)` }}>
                        {Array.from({ length: colCount }, (_, colIdx) => {
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
                      </div>
                    ))}
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
