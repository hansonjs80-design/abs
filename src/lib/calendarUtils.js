/* =============================================
 * 달력 유틸리티 (기존 Apps Script 로직 변환)
 * ============================================*/

/**
 * 해당 월의 달력 주 수 계산
 */
export function getCalendarWeeks(year, month) {
  const firstDay = new Date(year, month - 1, 1).getDay();
  const lastDate = new Date(year, month, 0).getDate();
  return Math.ceil((firstDay + lastDate) / 7);
}

/**
 * 해당 월의 마지막 날짜
 */
export function getLastDateOfMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

/**
 * 달력 그리드 데이터 생성 (7열 × N주)
 * 기존 autoFillCalendar 로직의 핵심 변환
 */
export function generateCalendarGrid(year, month, holidays = new Set()) {
  const weekCount = getCalendarWeeks(year, month);
  const firstDay = new Date(year, month - 1, 1).getDay();
  const lastDate = getLastDateOfMonth(year, month);
  const prevMonthLastDate = getLastDateOfMonth(year, month - 1);

  const grid = [];
  let cursor = 1 - firstDay;

  for (let w = 0; w < weekCount; w++) {
    const week = [];
    for (let d = 0; d < 7; d++, cursor++) {
      let cellDate, cellYear, cellMonth, cellDay;
      let isOtherMonth = false;
      let isCurrentMonth = false;

      if (cursor < 1) {
        cellDay = prevMonthLastDate + cursor;
        cellYear = month === 1 ? year - 1 : year;
        cellMonth = month === 1 ? 12 : month - 1;
        isOtherMonth = true;
      } else if (cursor > lastDate) {
        cellDay = cursor - lastDate;
        cellYear = month === 12 ? year + 1 : year;
        cellMonth = month === 12 ? 1 : month + 1;
        isOtherMonth = true;
      } else {
        cellDay = cursor;
        cellYear = year;
        cellMonth = month;
        isCurrentMonth = true;
      }

      cellDate = new Date(cellYear, cellMonth - 1, cellDay);
      const dow = cellDate.getDay();
      const holidayKey = `${cellYear}-${cellMonth}-${cellDay}`;
      const isHoliday = holidays.has(holidayKey);
      const isSunday = dow === 0;
      const isSaturday = dow === 6;

      week.push({
        date: cellDate,
        year: cellYear,
        month: cellMonth,
        day: cellDay,
        dow,
        isOtherMonth,
        isCurrentMonth,
        isHoliday: isCurrentMonth && isHoliday,
        isSunday,
        isSaturday,
        isSundayOrHoliday: isCurrentMonth && (isSunday || isHoliday),
        key: holidayKey,
      });
    }
    grid.push(week);
  }

  return { grid, weekCount };
}

/**
 * 충격파 시트 달력 데이터 생성 (월~토만, 일요일 제외)
 * 기존 fillShockwave2DatesWithHolidays 로직 변환
 */
export function generateShockwaveCalendar(year, month, holidays = new Set()) {
  const firstOfMonth = new Date(year, month - 1, 1);
  const dow = firstOfMonth.getDay();

  // 해당 월 첫 주의 월요일 찾기
  let startDate = new Date(firstOfMonth);
  if (dow === 0) {
    startDate.setDate(startDate.getDate() + 1); // 일요일이면 월요일로
  } else {
    startDate.setDate(startDate.getDate() - (dow - 1)); // 이전 월요일로
  }

  const weeks = [];
  const tempDate = new Date(startDate);
  let safety = 0;

  while (weeks.length < 6) {
    const weekDays = [];
    while (weekDays.length < 6) {
      if (tempDate.getDay() !== 0) { // 일요일 제외
        const y = tempDate.getFullYear();
        const m = tempDate.getMonth() + 1;
        const d = tempDate.getDate();
        const key = `${y}-${m}-${d}`;

        weekDays.push({
          date: new Date(tempDate),
          year: y,
          month: m,
          day: d,
          dow: tempDate.getDay(),
          isCurrentMonth: m === month,
          isHoliday: m === month && holidays.has(key),
          key,
        });
      }
      tempDate.setDate(tempDate.getDate() + 1);
      if (++safety > 366) break;
    }
    weeks.push(weekDays);
  }

  return weeks;
}

/**
 * 오늘 날짜 (KST)
 */
export function getTodayKST() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day = Number(parts.find((part) => part.type === 'day')?.value);
  return new Date(year, month - 1, day);
}

/**
 * 날짜가 같은지 비교
 */
export function isSameDate(d1, d2) {
  if (!d1 || !d2) return false;
  return d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate();
}

/**
 * 날짜를 YYYY-MM-DD 키로 포맷
 */
export function formatDateKey(year, month, day) {
  return `${year}-${month}-${day}`;
}

/**
 * 날짜를 표시용 포맷
 */
export function formatDisplayDate(year, month, day) {
  return `${String(year).padStart(4, '0')}. ${String(month).padStart(2, '0')}. ${String(day).padStart(2, '0')}`;
}
