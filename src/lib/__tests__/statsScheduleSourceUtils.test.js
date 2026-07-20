import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { generateShockwaveCalendar } from '../calendarUtils.js';
import { TREATMENT_COMPLETE_BG } from '../schedulerUtils.js';
import {
  buildScheduleMemoSignature,
  buildScheduleMemoMapForStats,
  getRecentScheduleMonthTargets,
} from '../statsScheduleSourceUtils.js';

function findCurrentMonthCoord(year, month) {
  const weeks = generateShockwaveCalendar(year, month);
  for (let weekIndex = 0; weekIndex < weeks.length; weekIndex += 1) {
    for (let dayIndex = 0; dayIndex < weeks[weekIndex].length; dayIndex += 1) {
      if (weeks[weekIndex][dayIndex]?.isCurrentMonth) {
        return { weekIndex, dayIndex };
      }
    }
  }
  throw new Error(`No current month coordinate for ${year}-${month}`);
}

describe('stats schedule source utilities', () => {
  it('returns recent month targets oldest to newest', () => {
    assert.deepEqual(
      getRecentScheduleMonthTargets({ currentYear: 2026, currentMonth: 7, recentPeriodMonths: 6 }),
      [
        { year: 2026, month: 2 },
        { year: 2026, month: 3 },
        { year: 2026, month: 4 },
        { year: 2026, month: 5 },
        { year: 2026, month: 6 },
        { year: 2026, month: 7 },
      ]
    );
  });

  it('changes the schedule memo signature when visible content changes', () => {
    const before = buildScheduleMemoSignature({
      '0-0-1-0': {
        content: '11840/조흥륜(2)',
        bg_color: TREATMENT_COMPLETE_BG,
        prescription: 'F2.5',
      },
    });
    const after = buildScheduleMemoSignature({
      '0-0-1-0': {
        content: '11840/조흥륜(3)',
        bg_color: TREATMENT_COMPLETE_BG,
        prescription: 'F2.5',
      },
    });

    assert.notEqual(after, before);
  });

  it('builds stats memos from visible schedule rows and relocates hidden merged content', () => {
    const year = 2026;
    const month = 6;
    const { weekIndex, dayIndex } = findCurrentMonthCoord(year, month);
    const masterKey = `${weekIndex}-${dayIndex}-0-0`;
    const hiddenChildKey = `${weekIndex}-${dayIndex}-1-0`;
    const hiddenContent = '11840/조흥륜(2)';

    const memoMap = buildScheduleMemoMapForStats([
      {
        year,
        month,
        week_index: weekIndex,
        day_index: dayIndex,
        row_index: 0,
        col_index: 0,
        content: '',
        bg_color: null,
        merge_span: { rowSpan: 2, colSpan: 1, mergedInto: null },
        updated_at: '2026-06-01T00:00:00.000Z',
      },
      {
        year,
        month,
        week_index: weekIndex,
        day_index: dayIndex,
        row_index: 1,
        col_index: 0,
        content: hiddenContent,
        bg_color: TREATMENT_COMPLETE_BG,
        prescription: 'F2.5',
        merge_span: { rowSpan: 1, colSpan: 1, mergedInto: masterKey },
        updated_at: '2026-06-01T00:00:01.000Z',
      },
    ], {
      year,
      month,
      settings: { start_time: '09:00', end_time: '18:00', interval_minutes: 10, time_label_interval_minutes: 10 },
    });

    const relocated = Object.entries(memoMap).find(
      ([key, cell]) => key !== hiddenChildKey && cell?.content === hiddenContent
    );

    assert.ok(relocated);
    assert.notEqual(relocated[0], masterKey);
    assert.equal(memoMap[hiddenChildKey]?.content || '', '');
  });
});
