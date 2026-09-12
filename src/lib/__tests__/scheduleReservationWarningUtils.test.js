import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { generateShockwaveCalendar } from '../calendarUtils.js';
import { buildScheduleReservationWarnings } from '../scheduleReservationWarningUtils.js';

const settings = {
  monthly_settlement_settings: {
    '2026-09': {
      shockwave: { prescriptions: ['충격파 A', '충격파 B'] },
      manual_therapy: { prescriptions: ['도수치료'] },
      shinjang_spray: { prescriptions: [] },
    },
  },
};

function findDateCell(dateKey) {
  const weeks = generateShockwaveCalendar(2026, 9);
  for (let weekIndex = 0; weekIndex < weeks.length; weekIndex += 1) {
    const dayIndex = weeks[weekIndex].findIndex((day) => (
      `${day.year}-${String(day.month).padStart(2, '0')}-${String(day.day).padStart(2, '0')}` === dateKey
    ));
    if (dayIndex >= 0) return { weekIndex, dayIndex };
  }
  throw new Error(`Missing date cell: ${dateKey}`);
}

function scheduleRow({ date, content, prescription, rowIndex = 0 }) {
  const { weekIndex, dayIndex } = findDateCell(date);
  return {
    year: 2026,
    month: 9,
    week_index: weekIndex,
    day_index: dayIndex,
    row_index: rowIndex,
    col_index: 0,
    content,
    prescription,
  };
}

function target({ date, content, prescription }) {
  return {
    ...scheduleRow({ date, content, prescription, rowIndex: 9 }),
    date,
  };
}

describe('schedule reservation warnings', () => {
  it('warns only on the third manual-therapy booking for the same chart number and name in one week', () => {
    const result = buildScheduleReservationWarnings({
      target: target({ date: '2026-09-09', content: '1001/김환자(3)', prescription: '도수치료' }),
      scheduleRows: [
        scheduleRow({ date: '2026-09-07', content: '1001/김환자(1)', prescription: '도수치료' }),
        scheduleRow({ date: '2026-09-08', content: '1001/김환자(2)', prescription: '도수치료' }),
        scheduleRow({ date: '2026-09-08', content: '1001/다른이름(2)', prescription: '도수치료', rowIndex: 2 }),
      ],
      settings,
      year: 2026,
      month: 9,
    });

    assert.deepEqual(result.map((item) => item.type), ['manual-week-limit']);
  });

  it('warns when a shockwave appointment is less than seven days after the previous appointment', () => {
    const result = buildScheduleReservationWarnings({
      target: target({ date: '2026-09-12', content: '1001/김환자(2)', prescription: '충격파 B' }),
      scheduleRows: [
        scheduleRow({ date: '2026-09-07', content: '1001/김환자(1)', prescription: '충격파 A' }),
      ],
      settings,
      year: 2026,
      month: 9,
    });

    assert.deepEqual(result.map((item) => item.type), ['shockwave-interval']);
  });

  it('warns from the sixteenth manual-therapy visit onward', () => {
    const result = buildScheduleReservationWarnings({
      target: target({ date: '2026-09-14', content: '1001/김환자(16)', prescription: '도수치료' }),
      settings,
      year: 2026,
      month: 9,
    });

    assert.deepEqual(result, [{
      type: 'manual-visit-limit',
      message: '도수치료 16회차째 입니다. 그래도 예약하시겠습니까?',
    }]);
  });

  it('allows shockwave booking exactly seven days later and separately warns at visit seven', () => {
    const result = buildScheduleReservationWarnings({
      target: target({ date: '2026-09-14', content: '1001/김환자(7)', prescription: '충격파 A' }),
      scheduleRows: [
        scheduleRow({ date: '2026-09-07', content: '1001/김환자(6)', prescription: '충격파 B' }),
      ],
      settings,
      year: 2026,
      month: 9,
    });

    assert.deepEqual(result.map((item) => item.type), ['shockwave-visit-limit']);
  });
});
