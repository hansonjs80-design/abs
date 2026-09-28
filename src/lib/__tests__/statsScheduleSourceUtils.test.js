import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { generateShockwaveCalendar } from '../calendarUtils.js';
import { TREATMENT_COMPLETE_BG } from '../schedulerUtils.js';
import {
  buildScheduleMemoSignature,
  buildScheduleMemoMapForStats,
  getRecentScheduleMonthTargets,
  loadStatsMonthlyTherapists,
  replaceCurrentStatsMonthLogs,
  resolveScheduleMemosForStatsMonth,
} from '../statsScheduleSourceUtils.js';
import { setMonthlySettlementSettings } from '../settlementSettings.js';
import { supabase } from '../supabaseClient.js';

function mockMonthlyQueries(context, responses) {
  const calls = [];
  context.mock.method(supabase, 'from', (table) => {
    assert.equal(table, 'shockwave_monthly_therapists');
    const filters = [];
    const response = responses[calls.length];
    assert.ok(response, 'Unexpected query');
    calls.push(filters);
    const query = {
      select: () => query,
      order: () => query,
      limit: () => query,
      eq: (key, value) => { filters.push([key, value]); return query; },
      gte: () => query,
      then: (resolve, reject) => Promise.resolve(response).then(resolve, reject),
    };
    return query;
  });
  return calls;
}

describe('statistics monthly therapist loading', () => {
  it('inherits the latest preceding monthly roster before considering legacy active names', async (context) => {
    const calls = mockMonthlyQueries(context, [
      { data: [], error: null },
      { data: [
        { year: 2026, month: 2, slot_index: 1, therapist_name: '윤지원', start_day: 1, end_day: 25 },
        { year: 2026, month: 4, slot_index: 1, therapist_name: '신수민', start_day: 1, end_day: 30 },
        { year: 2026, month: 4, slot_index: 2, therapist_name: '김세령', start_day: 1, end_day: 30 },
        { year: 2026, month: 10, slot_index: 1, therapist_name: '다음달', start_day: 1, end_day: 31 },
      ], error: null },
    ]);
    const rows = await loadStatsMonthlyTherapists({
      year: 2026, month: 9, type: 'shockwave',
      baseTherapists: [{ name: '윤지원', slot_index: 1 }, { name: '박진희', slot_index: 2 }],
    });
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], [['year', 2026], ['month', 9], ['type', 'shockwave']]);
    assert.deepEqual(rows.map((row) => [row.therapist_name, row.year, row.month, row.start_day, row.end_day]),
      [['신수민', 2026, 9, 1, 30], ['김세령', 2026, 9, 1, 30]]);
  });

  it('shares preceding-roster queries across recent months only within one refresh', async (context) => {
    const calls = mockMonthlyQueries(context, [
      { data: [], error: null },
      { data: [{ year: 2026, month: 4, slot_index: 0, therapist_name: '현재', start_day: 1, end_day: 30 }], error: null },
      { data: [], error: null },
    ]);
    const rosterQueryCache = new Map();
    const september = await loadStatsMonthlyTherapists({ year: 2026, month: 9, rosterQueryCache });
    const august = await loadStatsMonthlyTherapists({ year: 2026, month: 8, rosterQueryCache });
    assert.equal(calls.length, 3);
    assert.equal(september[0].end_day, 30);
    assert.equal(august[0].end_day, 31);
    assert.equal(august[0].therapist_name, september[0].therapist_name);
  });

  it('keeps explicit month settings and mid-month replacement periods', async (context) => {
    const configs = [
      { slot_index: 0, therapist_name: '전임', start_day: 1, end_day: 10 },
      { slot_index: 0, therapist_name: '후임', start_day: 11, end_day: 30 },
    ];
    const calls = mockMonthlyQueries(context, [{ data: configs, error: null }]);
    assert.deepEqual(await loadStatsMonthlyTherapists({ year: 2026, month: 9 }), configs);
    assert.equal(calls.length, 1);
  });

  it('uses the resolved schedule month for missing shinjang settings', async (context) => {
    mockMonthlyQueries(context, [{ data: [], error: null }, { data: [], error: null }]);
    const rows = await loadStatsMonthlyTherapists({
      year: 2026, month: 9, type: 'shinjang_spray',
      baseTherapists: [{ name: '윤지원', slot_index: 1 }],
      fallbackMonthlyTherapists: [
        { slot_index: 1, therapist_name: '신수민', start_day: 1, end_day: 30 },
      ],
    });
    assert.deepEqual(rows, [{ year: 2026, month: 9, type: 'shinjang_spray',
      slot_index: 1, therapist_name: '신수민', start_day: 1, end_day: 30 }]);
  });

  it('does not display a legacy roster when the preceding-month query fails', async (context) => {
    mockMonthlyQueries(context, [{ data: [], error: null }, { data: null, error: new Error('offline') }]);
    await assert.rejects(loadStatsMonthlyTherapists({
      year: 2026, month: 9, baseTherapists: [{ name: '윤지원', slot_index: 1 }],
    }), /offline/);
  });
});

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

  it('uses the exact visible schedule snapshot without reloading stale server rows', async () => {
    let fallbackCalls = 0;
    const visibleMemos = {};

    const result = await resolveScheduleMemosForStatsMonth({
      year: 2026,
      month: 9,
      visibleMemos,
      fallbackLoader: async () => {
        fallbackCalls += 1;
        return {
          '0-3-45-0': {
            content: '11483/김상희40(2)',
            bg_color: TREATMENT_COMPLETE_BG,
            prescription: '40분',
          },
        };
      },
    });

    assert.equal(result, visibleMemos);
    assert.equal(fallbackCalls, 0);
  });

  it('replaces current-month database rows with schedule-verified rows in recent summaries', () => {
    assert.deepEqual(
      replaceCurrentStatsMonthLogs({
        year: 2026,
        month: 9,
        logs: [
          { id: 'aug', date: '2026-08-31' },
          { id: 'ghost', date: '2026-09-10' },
        ],
        currentMonthLogs: [
          { id: 'verified', date: '2026-09-04' },
        ],
      }),
      [
        { id: 'aug', date: '2026-08-31' },
        { id: 'verified', date: '2026-09-04' },
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

  it('keeps the schedule memo signature stable when only cache object identity changes', () => {
    const memo = {
      content: '11840/조흥륜(2)',
      bg_color: TREATMENT_COMPLETE_BG,
      prescription: 'F2.5',
      body_part: 'Lt. Knee',
      updated_at: '2026-07-30T00:00:00.000Z',
      merge_span: { rowSpan: 1, colSpan: 1, mergedInto: null },
    };
    const before = buildScheduleMemoSignature({ '0-0-1-0': memo });
    const after = buildScheduleMemoSignature({
      '0-0-1-0': {
        ...memo,
        merge_span: { ...memo.merge_span },
      },
    });

    assert.equal(after, before);
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

  it('does not include adjacent-month schedules in the selected month stats source', () => {
    const memoMap = buildScheduleMemoMapForStats([
      {
        year: 2026,
        month: 6,
        week_index: 4,
        day_index: 0,
        row_index: 0,
        col_index: 1,
        content: '5345/이진영(2)',
        bg_color: TREATMENT_COMPLETE_BG,
        prescription: 'F/R',
        merge_span: { rowSpan: 1, colSpan: 1, mergedInto: null },
        updated_at: '2026-06-29T00:00:00.000Z',
      },
      {
        year: 2026,
        month: 7,
        week_index: 0,
        day_index: 2,
        row_index: 0,
        col_index: 1,
        content: '6245/박병수(1)',
        bg_color: TREATMENT_COMPLETE_BG,
        prescription: 'F2.5',
        merge_span: { rowSpan: 1, colSpan: 1, mergedInto: null },
        updated_at: '2026-07-01T00:00:00.000Z',
      },
      {
        year: 2026,
        month: 8,
        week_index: 0,
        day_index: 5,
        row_index: 0,
        col_index: 1,
        content: '11383/임태용(1)',
        bg_color: TREATMENT_COMPLETE_BG,
        prescription: 'F/R',
        merge_span: { rowSpan: 1, colSpan: 1, mergedInto: null },
        updated_at: '2026-08-01T00:00:00.000Z',
      },
    ], {
      year: 2026,
      month: 7,
      settings: { start_time: '09:00', end_time: '18:00', interval_minutes: 10, time_label_interval_minutes: 10 },
    });

    assert.deepEqual(
      Object.values(memoMap).map((cell) => cell.content),
      ['6245/박병수(1)']
    );
  });

  it('excludes inactive legacy manual dose tags from the selected month stats source', () => {
    const year = 2026;
    const month = 7;
    const { weekIndex, dayIndex } = findCurrentMonthCoord(year, month);
    const baseSettings = {
      start_time: '09:00',
      end_time: '18:00',
      interval_minutes: 10,
      time_label_interval_minutes: 10,
      manual_therapy_prescriptions: ['40분', '60분'],
      manual_therapy_dose_tags: {
        '40분': '40',
        '60분': '60',
      },
      manual_therapy_duration_minutes: {
        '40분': 40,
        '60분': 60,
      },
    };
    const settings = {
      ...baseSettings,
      monthly_settlement_settings: setMonthlySettlementSettings(baseSettings, year, month, 'manual_therapy', {
        prescriptions: ['30분'],
        hidden_prescriptions: ['40분', '60분'],
        dose_tags: { '30분': '30' },
        duration_minutes: { '30분': 30 },
      }),
    };

    const memoMap = buildScheduleMemoMapForStats([
      {
        year,
        month,
        week_index: weekIndex,
        day_index: dayIndex,
        row_index: 28,
        col_index: 0,
        content: '6281/이지운60',
        bg_color: TREATMENT_COMPLETE_BG,
        prescription: '60분',
        merge_span: { rowSpan: 1, colSpan: 1, mergedInto: null },
        updated_at: '2026-07-21T00:00:00.000Z',
      },
    ], {
      year,
      month,
      settings,
    });

    assert.equal(Object.values(memoMap).some((cell) => cell?.content === '6281/이지운60'), false);
  });

  it('does not count stale covered duplicate cells as extra stats rows', () => {
    const year = 2026;
    const month = 6;
    const { weekIndex, dayIndex } = findCurrentMonthCoord(year, month);
    const content = '11383/임태용(16)';

    const memoMap = buildScheduleMemoMapForStats([
      {
        year,
        month,
        week_index: weekIndex,
        day_index: dayIndex,
        row_index: 25,
        col_index: 0,
        content,
        bg_color: TREATMENT_COMPLETE_BG,
        prescription: 'F/R',
        body_part: 'Rt Ankle',
        merge_span: { rowSpan: 2, colSpan: 1, mergedInto: null },
        updated_at: '2026-06-01T00:00:00.000Z',
      },
      {
        year,
        month,
        week_index: weekIndex,
        day_index: dayIndex,
        row_index: 26,
        col_index: 0,
        content,
        bg_color: TREATMENT_COMPLETE_BG,
        prescription: 'F/R',
        body_part: 'Rt Ankle',
        merge_span: { rowSpan: 1, colSpan: 1, mergedInto: null },
        updated_at: '2026-06-01T00:00:01.000Z',
      },
      {
        year,
        month,
        week_index: weekIndex,
        day_index: dayIndex,
        row_index: 28,
        col_index: 0,
        content,
        bg_color: TREATMENT_COMPLETE_BG,
        prescription: 'F/R',
        body_part: 'Rt Ankle',
        merge_span: { rowSpan: 1, colSpan: 1, mergedInto: null },
        updated_at: '2026-06-01T00:00:02.000Z',
      },
    ], {
      year,
      month,
      settings: { start_time: '09:00', end_time: '19:30', interval_minutes: 10, time_label_interval_minutes: 10 },
    });

    const entries = Object.entries(memoMap).filter(([, cell]) => cell?.content === content);
    assert.deepEqual(entries.map(([key]) => key), [
      `${weekIndex}-${dayIndex}-25-0`,
      `${weekIndex}-${dayIndex}-28-0`,
    ]);
  });

  it('keeps same-patient covered cells when treatment details differ', () => {
    const year = 2026;
    const month = 6;
    const { weekIndex, dayIndex } = findCurrentMonthCoord(year, month);
    const content = '11383/임태용(16)';

    const memoMap = buildScheduleMemoMapForStats([
      {
        year,
        month,
        week_index: weekIndex,
        day_index: dayIndex,
        row_index: 25,
        col_index: 0,
        content,
        bg_color: TREATMENT_COMPLETE_BG,
        prescription: 'F/R',
        body_part: 'Rt Ankle',
        merge_span: { rowSpan: 2, colSpan: 1, mergedInto: null },
        updated_at: '2026-06-01T00:00:00.000Z',
      },
      {
        year,
        month,
        week_index: weekIndex,
        day_index: dayIndex,
        row_index: 26,
        col_index: 0,
        content,
        bg_color: TREATMENT_COMPLETE_BG,
        prescription: 'F/RDC',
        body_part: 'Rt Hip',
        merge_span: { rowSpan: 1, colSpan: 1, mergedInto: null },
        updated_at: '2026-06-01T00:00:01.000Z',
      },
    ], {
      year,
      month,
      settings: { start_time: '09:00', end_time: '19:30', interval_minutes: 10, time_label_interval_minutes: 10 },
    });

    const entries = Object.values(memoMap).filter((cell) => cell?.content === content);
    assert.equal(entries.length, 2);
    assert.ok(entries.some((cell) => cell.prescription === 'F/RDC' && cell.body_part === 'Rt Hip'));
  });

  it('uses visible schedule content over a stale covered star visit marker', () => {
    const year = 2026;
    const month = 6;
    const weeks = generateShockwaveCalendar(year, month);
    let weekIndex = -1;
    let dayIndex = -1;
    weeks.forEach((week, wIndex) => {
      week.forEach((dayInfo, dIndex) => {
        if (dayInfo.year === 2026 && dayInfo.month === 6 && dayInfo.day === 8) {
          weekIndex = wIndex;
          dayIndex = dIndex;
        }
      });
    });
    assert.notEqual(weekIndex, -1);
    const masterContent = '14122/전지환(1)';
    const staleContent = '14122/전지환*';

    const memoMap = buildScheduleMemoMapForStats([
      {
        year,
        month,
        week_index: weekIndex,
        day_index: dayIndex,
        row_index: 20,
        col_index: 1,
        content: masterContent,
        bg_color: TREATMENT_COMPLETE_BG,
        prescription: 'F2.5',
        body_part: 'Lt Elbow',
        merge_span: { rowSpan: 2, colSpan: 1, mergedInto: null },
        updated_at: '2026-06-08T00:00:01.000Z',
      },
      {
        year,
        month,
        week_index: weekIndex,
        day_index: dayIndex,
        row_index: 21,
        col_index: 1,
        content: staleContent,
        bg_color: TREATMENT_COMPLETE_BG,
        prescription: 'F2.5',
        body_part: 'Lt Elbow',
        merge_span: { rowSpan: 1, colSpan: 1, mergedInto: null },
        updated_at: '2026-06-08T00:00:00.000Z',
      },
      {
        year,
        month,
        week_index: weekIndex,
        day_index: dayIndex,
        row_index: 25,
        col_index: 1,
        content: masterContent,
        bg_color: TREATMENT_COMPLETE_BG,
        prescription: 'F2.5',
        body_part: 'Lt Elbow',
        merge_span: { rowSpan: 1, colSpan: 1, mergedInto: null },
        updated_at: '2026-06-08T00:00:02.000Z',
      },
    ], {
      year,
      month,
      settings: { start_time: '09:00', end_time: '19:30', interval_minutes: 10, time_label_interval_minutes: 10 },
    });

    const visibleEntries = Object.values(memoMap).filter((cell) => cell?.content === masterContent);
    const staleEntries = Object.values(memoMap).filter((cell) => cell?.content === staleContent);
    assert.equal(visibleEntries.length, 2);
    assert.equal(staleEntries.length, 0);
  });
});
