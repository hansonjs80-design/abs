import { useMemo, useEffect } from 'react';
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
      <div className="calendar-grid">
        {/* 요일 헤더 */}
        {WEEKDAYS.map((day, i) => (
          <div
            key={`h-${i}`}
            className={`calendar-weekday-header${i === 0 ? ' sunday' : ''}${i === 6 ? ' saturday' : ''}`}
          >
            {day}
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
              <div key={`${wi}-${di}`} className={cellClass}>
                <div className="calendar-date">
                  <span className="calendar-date-number">{dayInfo.day}</span>
                  {dayInfo.isHoliday && <span className="calendar-date-badge">휴일</span>}
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
                      />
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
