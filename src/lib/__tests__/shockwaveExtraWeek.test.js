import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateShockwaveCalendar } from '../calendarUtils.js';
import {
  canonicalizeShockwaveScheduleItemDate,
  createShockwaveScheduleDateMapper,
  getShockwaveScheduleItemDate,
  getVisibleShockwaveScheduleMonths,
  mapShockwaveScheduleItemToCurrentMonthView,
  mapShockwaveScheduleItemToVisibleMonth,
} from '../shockwaveScheduleDateMapping.js';

test('October and Sunday-ending months all show one complete next-month booking week', () => {
  const october = generateShockwaveCalendar(2026, 10, new Set(['2026-11-3']));
  assert.equal(october.length, 6);
  assert.deepEqual(october.at(-1).map(day => day.key),
    ['2026-11-2', '2026-11-3', '2026-11-4', '2026-11-5', '2026-11-6', '2026-11-7']);
  assert.ok(october.at(-1).every(day => !day.isCurrentMonth));
  assert.equal(october.at(-1)[1].isHoliday, true);
  for (const [month, weekCount, nextMonth] of [[1, 6, 2], [2, 5, 3]]) {
    const weeks = generateShockwaveCalendar(2027, month);
    assert.equal(weeks.length, weekCount);
    assert.deepEqual(weeks.at(-1).map(day => day.key),
      Array.from({ length: 6 }, (_, index) => `2027-${nextMonth}-${index + 1}`));
    assert.ok(weeks.at(-1).every(day => !day.isCurrentMonth));
    assert.ok(getVisibleShockwaveScheduleMonths(2027, month)
      .some(target => target.year === 2027 && target.month === nextMonth));
  }
  assert.deepEqual(getVisibleShockwaveScheduleMonths(2026, 10), [
    { year: 2026, month: 9 }, { year: 2026, month: 10 }, { year: 2026, month: 11 },
  ]);
});

test('twenty years of calendars preserve every existing booking coordinate', () => {
  for (let year = 2020; year < 2040; year++) {
    for (let month = 1; month <= 12; month++) {
      const weeks = generateShockwaveCalendar(year, month);
      const firstDow = new Date(year, month - 1, 1).getDay();
      const firstMondayDay = firstDow === 0 ? 2 : 2 - firstDow;
      const lastDay = new Date(year, month, 0);
      let lastCurrentWeek = 0;
      for (let day = 1; day <= lastDay.getDate(); day++) {
        const dow = new Date(year, month - 1, day).getDay();
        if (dow === 0) continue;
        const weekIndex = Math.floor((day - firstMondayDay) / 7);
        assert.equal(weeks[weekIndex][dow - 1].key, `${year}-${month}-${day}`);
        assert.equal(weeks[weekIndex][dow - 1].isCurrentMonth, true);
        lastCurrentWeek = weekIndex;
      }
      assert.equal(weeks.length, lastCurrentWeek + 2);
      assert.ok(weeks.at(-1).every(day => !day.isCurrentMonth));
      assert.equal(new Set(weeks.flat().map(day => day.key)).size, weeks.length * 6);
      assert.ok(weeks.every(week => week.map(day => day.dow).join() === '1,2,3,4,5,6'));
    }
  }
});

test('added week books in the actual month and round-trips merged reservations without changing stats', () => {
  for (const [year, month] of [[2026, 10], [2026, 12], [2024, 2], [2026, 8], [2027, 1], [2027, 2]]) {
    const weeks = generateShockwaveCalendar(year, month);
    const weekIndex = weeks.length - 1;
    for (let dayIndex = 0; dayIndex < 6; dayIndex++) {
      const displayed = {
        year, month, week_index: weekIndex, day_index: dayIndex,
        row_index: 2, col_index: 1, content: '가상 예약',
        merge_span: { mergedInto: `${weekIndex}-${dayIndex}-1-1`,
          meta: { relocated_from_hidden_merge_cell: `${weekIndex}-${dayIndex}-4-1` } },
      };
      const original = structuredClone(displayed);
      const canonical = canonicalizeShockwaveScheduleItemDate(displayed);
      const date = weeks[weekIndex][dayIndex];
      assert.equal(canonical.year, date.year);
      assert.equal(canonical.month, date.month);
      assert.equal(getShockwaveScheduleItemDate(canonical).key, date.key);
      assert.deepEqual(mapShockwaveScheduleItemToVisibleMonth(canonical, year, month), displayed);
      assert.equal(mapShockwaveScheduleItemToCurrentMonthView(canonical, year, month), null);
      assert.ok(mapShockwaveScheduleItemToCurrentMonthView(canonical, date.year, date.month));
      assert.deepEqual(displayed, original);
    }
  }
});

test('batch date mapper matches standalone mapping for all dates, invalid rows, and merged metadata', () => {
  for (const [year, month] of [[2026, 10], [2026, 12], [2027, 2]]) {
    const mapper = createShockwaveScheduleDateMapper(year, month);
    for (let offset = -2; offset <= 2; offset++) {
      const source = new Date(year, month - 1 + offset, 1);
      for (let w = -1; w < 8; w++) for (let d = -1; d < 7; d++) {
        const item = { year: String(source.getFullYear()), month: String(source.getMonth() + 1),
          week_index: w, day_index: d, content: '가상 예약',
          merge_span: { mergedInto: `${w}-${d}-2-0`, meta: { relocated_from_hidden_merge_cell: `${w}-${d}-3-0` } } };
        assert.deepEqual(mapper.getItemDate(item), getShockwaveScheduleItemDate(item));
        assert.deepEqual(mapper.mapToVisibleMonth(item), mapShockwaveScheduleItemToVisibleMonth(item, year, month));
      }
    }
    assert.equal(mapper.getItemDate(null), null);
    assert.equal(mapper.mapToVisibleMonth(null), null);
  }
});
