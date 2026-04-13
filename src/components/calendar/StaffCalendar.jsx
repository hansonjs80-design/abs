import { useState, useMemo, useEffect } from 'react';
import { useSchedule } from '../../contexts/ScheduleContext';
import { generateCalendarGrid, getTodayKST, isSameDate } from '../../lib/calendarUtils';
import { WEEKDAYS } from '../../lib/constants';
import MemoSlot from './MemoSlot';

export default function StaffCalendar() {
  const {
    currentYear, currentMonth,
    staffMemos, loadStaffMemos, saveStaffMemo,
    holidays, loadHolidays
  } = useSchedule();

  const [colWidth, setColWidth] = useState(0); // 0 = 1fr
  const [rowHeight, setRowHeight] = useState(120);

  const startColResize = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const currentWidth = colWidth || (e.target.parentElement.offsetWidth);

    const onMouseMove = (moveEvent) => {
      const deltaX = moveEvent.clientX - startX;
      setColWidth(Math.max(50, currentWidth + deltaX));
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  const startRowResize = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const currentHeight = rowHeight || 120;

    const onMouseMove = (moveEvent) => {
      const deltaY = moveEvent.clientY - startY;
      setRowHeight(Math.max(60, currentHeight + deltaY));
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  useEffect(() => {
    loadStaffMemos(currentYear, currentMonth);
    loadHolidays(currentYear, currentMonth);
  }, [currentYear, currentMonth, loadStaffMemos, loadHolidays]);

  const today = getTodayKST();

  const calendarData = useMemo(() => {
    return generateCalendarGrid(currentYear, currentMonth, holidays);
  }, [currentYear, currentMonth, holidays]);

  const { grid } = calendarData;

  return (
    <div className="staff-calendar animate-fade-in">
      <div 
        className="calendar-grid"
        style={{ gridTemplateColumns: colWidth ? `repeat(7, ${colWidth}px)` : 'repeat(7, minmax(0, 1fr))' }}
      >
        {/* 요일 헤더 */}
        {WEEKDAYS.map((day, i) => (
          <div
            key={`h-${i}`}
            className={`calendar-weekday-header${i === 0 ? ' sunday' : ''}${i === 6 ? ' saturday' : ''}`}
            style={{ position: 'relative' }}
          >
            {day}
            {i < 6 && <div className="col-resizer" onMouseDown={startColResize} />}
          </div>
        ))}

        {/* 달력 셀 */}
        {grid.map((week, wi) =>
          week.map((dayInfo, di) => {
            const isToday = isSameDate(dayInfo.date, today);
            let cellClass = 'calendar-cell';
            if (dayInfo.isOtherMonth) cellClass += ' other-month';
            if (dayInfo.isSunday) cellClass += ' sunday';
            if (dayInfo.isSaturday) cellClass += ' saturday';
            if (dayInfo.isHoliday) cellClass += ' holiday';
            if (isToday) cellClass += ' today';

            return (
              <div 
                key={`${wi}-${di}`} 
                className={cellClass}
                style={{ height: `${rowHeight}px` }}
              >
                <div className="calendar-date">
                  {dayInfo.isHoliday && <span className="calendar-date-badge">휴일</span>}
                  <span className="calendar-date-number">{dayInfo.day}</span>
                </div>
                <div className="calendar-memos">
                  {[0, 1, 2, 3, 4, 5].map(slot => {
                    const memoKey = `${dayInfo.year}-${dayInfo.month}-${dayInfo.day}-${slot}`;
                    return (
                      <MemoSlot
                        key={slot}
                        memo={staffMemos[memoKey]}
                        dayInfo={dayInfo}
                        slotIndex={slot}
                        onSave={saveStaffMemo}
                        coord={`${wi}-${di}-${slot}`}
                        maxWeeks={grid.length}
                      />
                    );
                  })}
                </div>
                {di < 6 && <div className="col-resizer" onMouseDown={startColResize} />}
                {wi < grid.length - 1 && <div className="row-resizer" onMouseDown={startRowResize} />}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
