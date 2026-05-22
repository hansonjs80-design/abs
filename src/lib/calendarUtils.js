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
          isHoliday: holidays.has(key),
          key,
        });
      }
      tempDate.setDate(tempDate.getDate() + 1);
      if (++safety > 366) break;
    }
    weeks.push(weekDays);
  }

  // 필터링: 마지막 주차에 이번 달 날짜가 하나도 없으면 해당 주차 제거
  while (weeks.length > 0) {
    const lastWeek = weeks[weeks.length - 1];
    const hasCurrentMonthDay = lastWeek.some(day => day.isCurrentMonth);
    if (!hasCurrentMonthDay) {
      weeks.pop();
    } else {
      break;
    }
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

/**
 * 특정 날짜가 인접한 이전 달/다음 달 달력의 어떤 셀(weekIndex, dayIndex)에 위치하는지 반환합니다.
 */
export function getOverlappingCalendarCoordinates(year, month, weekIndex, dayIndex) {
  const weeks = generateShockwaveCalendar(year, month);
  const dayInfo = weeks[weekIndex]?.[dayIndex];
  if (!dayInfo) return [];

  const targetDateStr = `${dayInfo.year}-${dayInfo.month}-${dayInfo.day}`;
  const overlappingCoords = [];

  // 이전 달 달력 확인
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevWeeks = generateShockwaveCalendar(prevYear, prevMonth);
  prevWeeks.forEach((week, w) => {
    week.forEach((day, d) => {
      if (`${day.year}-${day.month}-${day.day}` === targetDateStr) {
        overlappingCoords.push({ year: prevYear, month: prevMonth, weekIndex: w, dayIndex: d });
      }
    });
  });

  // 다음 달 달력 확인
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextWeeks = generateShockwaveCalendar(nextYear, nextMonth);
  nextWeeks.forEach((week, w) => {
    week.forEach((day, d) => {
      if (`${day.year}-${day.month}-${day.day}` === targetDateStr) {
        overlappingCoords.push({ year: nextYear, month: nextMonth, weekIndex: w, dayIndex: d });
      }
    });
  });

  return overlappingCoords;
}

/**
 * 저장할 스케줄 데이터를 인접한 달력에도 동일하게 복제하여 반영합니다. (ex: 4/30일 데이터를 5월 달력 화면에도 동일하게 저장)
 */
export function buildCrossMonthMirroredPayloads(originalPayloads) {
  const mirroredPayloads = [];
  
  originalPayloads.forEach((payload) => {
    const { id: _id, year, month, week_index, day_index, row_index, col_index, merge_span, ...rest } = payload;
    
    // 원본 데이터 유지 (undefined 속성 제거)
    const cleanOriginal = {
      year, month, week_index, day_index, row_index, col_index, ...rest
    };
    if (merge_span !== undefined) cleanOriginal.merge_span = merge_span;
    mirroredPayloads.push(cleanOriginal);
    
    // 교차 달력 좌표 찾기
    const overlaps = getOverlappingCalendarCoordinates(year, month, week_index, day_index);
    
    overlaps.forEach((overlap) => {
      // 병합 데이터(merge_span)가 있다면 새로운 좌표계(week, day)에 맞게 mergedInto 값 수정
      let newMergeSpan = merge_span;
      if (merge_span && merge_span.mergedInto) {
        const [, , mRow, mCol] = merge_span.mergedInto.split('-');
        newMergeSpan = {
          ...merge_span,
          mergedInto: `${overlap.weekIndex}-${overlap.dayIndex}-${mRow}-${mCol}`
        };
      }
      
      const mirroredPayload = {
        year: overlap.year,
        month: overlap.month,
        week_index: overlap.weekIndex,
        day_index: overlap.dayIndex,
        row_index,
        col_index,
        ...rest
      };
      if (newMergeSpan !== undefined) mirroredPayload.merge_span = newMergeSpan;
      
      mirroredPayloads.push(mirroredPayload);
    });
  });
  
  return mirroredPayloads;
}
