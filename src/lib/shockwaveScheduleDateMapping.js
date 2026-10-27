import { generateShockwaveCalendar } from './calendarUtils.js';

const HIDDEN_MERGED_RELOCATION_SOURCE_META_KEY = 'relocated_from_hidden_merge_cell';

export function findShockwaveCalendarCoordinateByDate(year, month, targetYear, targetMonth, targetDay) {
  const weeks = generateShockwaveCalendar(year, month);
  for (let weekIndex = 0; weekIndex < weeks.length; weekIndex += 1) {
    const week = weeks[weekIndex];
    for (let dayIndex = 0; dayIndex < week.length; dayIndex += 1) {
      const dayInfo = week[dayIndex];
      if (
        dayInfo?.year === targetYear &&
        dayInfo?.month === targetMonth &&
        dayInfo?.day === targetDay
      ) {
        return { weekIndex, dayIndex, dayInfo };
      }
    }
  }
  return null;
}

export function getShockwaveScheduleItemDate(item) {
  if (!item) return null;
  const weeks = generateShockwaveCalendar(Number(item.year), Number(item.month));
  const dayInfo = weeks[Number(item.week_index)]?.[Number(item.day_index)];
  if (!dayInfo?.isCurrentMonth) return null;
  return dayInfo;
}

function remapCellKeyToDay(cellKey, weekIndex, dayIndex) {
  const [, , rowIndex, colIndex] = String(cellKey || '').split('-');
  if (rowIndex === undefined || colIndex === undefined) return cellKey;
  return `${weekIndex}-${dayIndex}-${rowIndex}-${colIndex}`;
}

function remapMergeSpanToDay(mergeSpan, weekIndex, dayIndex) {
  if (!mergeSpan) return mergeSpan;
  const relocatedSourceKey = mergeSpan.meta?.[HIDDEN_MERGED_RELOCATION_SOURCE_META_KEY];
  if (!mergeSpan.mergedInto && !relocatedSourceKey) return mergeSpan;

  const nextMergeSpan = { ...mergeSpan };
  const [, , rowIndex, colIndex] = String(mergeSpan.mergedInto).split('-');
  if (mergeSpan.mergedInto && rowIndex !== undefined && colIndex !== undefined) {
    nextMergeSpan.mergedInto = `${weekIndex}-${dayIndex}-${rowIndex}-${colIndex}`;
  }
  if (relocatedSourceKey) {
    nextMergeSpan.meta = {
      ...mergeSpan.meta,
      [HIDDEN_MERGED_RELOCATION_SOURCE_META_KEY]: remapCellKeyToDay(relocatedSourceKey, weekIndex, dayIndex),
    };
  }
  return nextMergeSpan;
}

export function canonicalizeShockwaveScheduleItemDate(item) {
  if (!item) return item;
  const sourceWeeks = generateShockwaveCalendar(Number(item.year), Number(item.month));
  const sourceDay = sourceWeeks[Number(item.week_index)]?.[Number(item.day_index)];
  if (!sourceDay || sourceDay.isCurrentMonth) return item;

  const targetCoord = findShockwaveCalendarCoordinateByDate(
    sourceDay.year,
    sourceDay.month,
    sourceDay.year,
    sourceDay.month,
    sourceDay.day
  );
  if (!targetCoord) return item;

  return {
    ...item,
    year: sourceDay.year,
    month: sourceDay.month,
    week_index: targetCoord.weekIndex,
    day_index: targetCoord.dayIndex,
    merge_span: remapMergeSpanToDay(item.merge_span, targetCoord.weekIndex, targetCoord.dayIndex),
  };
}

export function mapShockwaveScheduleItemToVisibleMonth(item, viewYear, viewMonth) {
  const itemDate = getShockwaveScheduleItemDate(item);
  if (!itemDate) return null;

  const visibleCoord = findShockwaveCalendarCoordinateByDate(
    viewYear,
    viewMonth,
    itemDate.year,
    itemDate.month,
    itemDate.day
  );
  if (!visibleCoord) return null;

  return {
    ...item,
    year: viewYear,
    month: viewMonth,
    week_index: visibleCoord.weekIndex,
    day_index: visibleCoord.dayIndex,
    merge_span: remapMergeSpanToDay(item.merge_span, visibleCoord.weekIndex, visibleCoord.dayIndex),
  };
}

// 한 번의 조회 결과를 처리하는 동안만 달력을 재사용한다.
// 예약 데이터나 서버 응답을 캐시하지 않아 기존 최신성/저장 보호 로직에는 영향이 없다.
export function createShockwaveScheduleDateMapper(viewYear, viewMonth) {
  const sourceCalendars = new Map();
  const coordinates = new Map();
  const viewWeeks = generateShockwaveCalendar(viewYear, viewMonth);
  sourceCalendars.set(`${viewYear}-${viewMonth}`, viewWeeks);
  viewWeeks.forEach((week, weekIndex) => week.forEach((day, dayIndex) => {
    coordinates.set(day.key, { weekIndex, dayIndex });
  }));

  const getItemDate = (item) => {
    if (!item) return null;
    const year = Number(item.year);
    const month = Number(item.month);
    const key = `${year}-${month}`;
    if (!sourceCalendars.has(key)) {
      sourceCalendars.set(key, generateShockwaveCalendar(year, month));
    }
    const day = sourceCalendars.get(key)[Number(item.week_index)]?.[Number(item.day_index)];
    return day?.isCurrentMonth ? day : null;
  };

  return {
    getItemDate,
    mapToVisibleMonth(item) {
      const day = getItemDate(item);
      const coordinate = day && coordinates.get(day.key);
      if (!coordinate) return null;
      const { weekIndex, dayIndex } = coordinate;
      return {
        ...item, year: viewYear, month: viewMonth,
        week_index: weekIndex, day_index: dayIndex,
        merge_span: remapMergeSpanToDay(item.merge_span, weekIndex, dayIndex),
      };
    },
  };
}

export function isShockwaveCalendarCellInCurrentMonth(year, month, weekIndex, dayIndex) {
  const weeks = generateShockwaveCalendar(Number(year), Number(month));
  const dayInfo = weeks[Number(weekIndex)]?.[Number(dayIndex)];
  return Boolean(
    dayInfo?.isCurrentMonth &&
    Number(dayInfo.year) === Number(year) &&
    Number(dayInfo.month) === Number(month)
  );
}

export function isShockwaveCalendarCellVisible(year, month, weekIndex, dayIndex) {
  const weeks = generateShockwaveCalendar(Number(year), Number(month));
  return Boolean(weeks[Number(weekIndex)]?.[Number(dayIndex)]);
}

export function mapShockwaveScheduleItemToCurrentMonthView(item, viewYear, viewMonth) {
  const visibleItem = mapShockwaveScheduleItemToVisibleMonth(item, viewYear, viewMonth);
  if (!visibleItem) return null;
  if (
    !isShockwaveCalendarCellInCurrentMonth(
      viewYear,
      viewMonth,
      visibleItem.week_index,
      visibleItem.day_index
    )
  ) {
    return null;
  }
  return visibleItem;
}

export function getVisibleShockwaveScheduleMonths(year, month) {
  const seen = new Set();
  const months = [];
  generateShockwaveCalendar(year, month).forEach((week) => {
    week.forEach((dayInfo) => {
      const key = `${dayInfo.year}-${dayInfo.month}`;
      if (seen.has(key)) return;
      seen.add(key);
      months.push({ year: dayInfo.year, month: dayInfo.month });
    });
  });
  return months;
}
