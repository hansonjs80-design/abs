import assert from 'node:assert/strict';
import { test } from 'node:test';
import { supabase } from '../supabaseClient.js';
import { generateShockwaveCalendar } from '../calendarUtils.js';
import { TREATMENT_COMPLETE_BG } from '../schedulerUtils.js';
import { syncMonthShockwaveScheduleToStats } from '../shockwaveSyncUtils.js';
import { syncMonthManualTherapyScheduleToStats } from '../manualTherapyUtils.js';

test('calculates completed monthly schedule rows without any database writes or post-write fetch', async (context) => {
  let queries = 0;
  context.mock.method(supabase, 'from', () => {
    queries += 1;
    const query = { then: (resolve, reject) => Promise.resolve({ data: [], error: null }).then(resolve, reject) };
    for (const key of ['select', 'eq', 'in', 'lt', 'gte', 'lte', 'range', 'order']) query[key] = () => query;
    for (const key of ['insert', 'update', 'upsert', 'delete']) query[key] = () => { throw new Error(`Unexpected write: ${key}`); };
    return query;
  });
  const weeks = generateShockwaveCalendar(2026, 9);
  const week = weeks.findIndex(days => days.some(day => day.isCurrentMonth && day.day === 1));
  const day = weeks[week].findIndex(day => day.isCurrentMonth && day.day === 1);
  const memos = {
    [`${week}-${day}-0-0`]: { content: '123/테스트(1)', prescription: 'F2.5', bg_color: TREATMENT_COMPLETE_BG },
    [`${week}-${day}-1-0`]: { content: '456/예시40(1)', prescription: '40분', bg_color: TREATMENT_COMPLETE_BG },
    [`${week}-${day}-2-0`]: { content: '789/미완료(1)', prescription: 'F2.5', bg_color: '#ffffff' },
  };
  const params = {
    year: 2026, month: 9, memos, therapists: [{ name: '기본', slot_index: 0 }],
    monthlyTherapists: [{ slot_index: 0, therapist_name: '이번달', start_day: 1, end_day: 30 }],
    settings: { prescriptions: ['F2.5'], manual_therapy_prescriptions: ['40분'] },
    collectOnly: true,
  };
  const shockwave = await syncMonthShockwaveScheduleToStats(params);
  const manual = await syncMonthManualTherapyScheduleToStats(params);
  for (const result of [shockwave, manual]) {
    assert.equal(result.rebuiltRows.length, 1);
    assert.equal(result.rebuiltRows[0].therapist_name, '이번달');
    assert.equal(result.totalUpdates, 0);
  }
  assert.equal(shockwave.rebuiltRows[0].prescription, 'F2.5');
  assert.equal(manual.rebuiltRows[0].prescription, '40분');
  // Two history reads + one existing-month read for shockwave; four + one for manual.
  assert.equal(queries, 8);
});
