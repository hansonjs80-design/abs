import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { generateShockwaveCalendar } from '../calendarUtils.js';
import { buildInsuranceRecords, getInsuranceUsage, isInsuranceSelfPay, overlayInsuranceScheduleRows } from '../insuranceUsageUtils.js';
import { readAllInsuranceRows } from '../insuranceUsageRepository.js';
import { buildScheduleReservationWarnings } from '../scheduleReservationWarningUtils.js';

const settings = {
  prescriptions: ['F2.5', 'F2.5(본인)', 'F3.0'],
  manual_therapy_prescriptions: ['30분', '30분(본인)'],
};
function row(date, prescription = 'F2.5', index = 0, extra = {}) {
  const [year, month, day] = date.split('-').map(Number);
  const weeks = generateShockwaveCalendar(year, month);
  const week_index = weeks.findIndex((week) => week.some((item) => item.isCurrentMonth && item.day === day));
  const day_index = weeks[week_index].findIndex((item) => item.isCurrentMonth && item.day === day);
  return { year, month, week_index, day_index, row_index: index, col_index: 0, date, content: '1001/가상환자(99)', prescription, ...extra };
}
function usage(rows, target, historyLogs = []) {
  return getInsuranceUsage(buildInsuranceRecords({ scheduleRows: rows, historyLogs, settings }), target, settings);
}

describe('clinic annual insurance usage', () => {
  it('resets on the anniversary, not January 1 or a rolling 365-day window', () => {
    const rows = [row('2026-09-01'), row('2027-01-01'), row('2027-08-31')];
    assert.equal(usage(rows, rows[2]).count, 3);
    assert.equal(usage(rows, row('2027-09-01')).count, 1);
    assert.equal(usage(rows, row('2028-09-01')).count, 1);
    assert.equal(usage(rows, row('2027-09-01')).periodStart, '2027-09-01');
  });
  it('clamps leap-day anniversaries and keeps the original anchor', () => {
    const rows = [row('2028-02-29'), row('2029-02-27')];
    assert.equal(usage(rows, rows[1]).count, 2);
    assert.equal(usage(rows, row('2029-02-28')).count, 1);
    assert.equal(usage(rows, row('2036-02-28')).periodStart, '2035-02-28');
    assert.equal(usage(rows, row('2036-02-29')).periodStart, '2036-02-29');
  });
  it('excludes self-pay, cancelled and merged children, and matches both patient identifiers', () => {
    const rows = [row('2026-09-01'), row('2026-09-02', 'F2.5(본인)'),
      row('2026-09-03', 'F2.5', 0, { bg_color: '#f4cccc' }),
      row('2026-09-04', 'F2.5', 0, { merge_span: { mergedInto: '0-0-0-0' } }),
      row('2026-09-05', 'F2.5', 0, { content: '1002/가상환자(99)' }),
      row('2026-09-05', 'F2.5', 1, { content: '1001/다른환자(99)' })];
    assert.equal(usage(rows, row('2026-09-07')).count, 2);
    assert.equal(usage(rows, rows[1]).count, 1);
    assert.equal(isInsuranceSelfPay('30분（ 본인 ）'), true);
  });
  it('does not start a period from self-pay or shinjang treatments', () => {
    const rows = [row('2026-07-01', 'F2.5(본인)'), row('2026-08-01', '신장분사2.5'), row('2026-09-01')];
    assert.equal(usage(rows, rows[1]).count, 0);
    assert.equal(usage(rows, row('2027-08-31')).count, 2);
  });
  it('keeps categories separate and carries counts for integer/decimal shinjang without incrementing', () => {
    const rows = [row('2026-09-01', '30분'), row('2026-09-02', '30분'), row('2026-09-03')];
    assert.equal(usage(rows, row('2026-09-04', '신장분사1')).count, 2);
    assert.equal(usage(rows, row('2026-09-04', '신장분사2')).category, 'manual');
    assert.equal(usage(rows, row('2026-09-04', '신장분사2.5')).count, 1);
    assert.equal(usage(rows, row('2026-09-04', '신장분사3.0')).category, 'shockwave');
    assert.equal(usage(rows, row('2027-09-03', '신장분사3.0')).count, 0);
  });
  it('respects same-day chronological order and does not include future appointments', () => {
    const rows = [row('2026-09-01', '30분', 1), row('2026-09-01', '신장분사1', 2), row('2026-09-01', '30분', 3), row('2026-09-02', '30분')];
    assert.equal(usage(rows, rows[1]).count, 1);
    assert.equal(usage(rows, rows[2]).count, 2);
  });
  it('marks shinjang history only when its linked category has an earlier eligible treatment', () => {
    const rows = [row('2026-09-01', '30분'), row('2026-09-03', 'F2.5')];
    const manual = usage(rows, row('2026-09-02', '신장분사 1'));
    assert.equal(manual.category, 'manual');
    assert.equal(manual.hasHistory, true);
    assert.equal(manual.periodEnd, '2027-01-01');
    const shock = usage(rows, row('2026-09-02', '신장분사 2.5'));
    assert.equal(shock.isShinjang, true);
    assert.equal(shock.hasHistory, false);
    const later = usage(rows, row('2026-09-04', '신장분사 2.5'));
    assert.equal(later.hasHistory, true);
    assert.equal(later.count, 1);
    assert.equal(later.periodEnd, '2027-09-03');
    assert.equal(usage([row('2026-09-02', 'F2.5', 3)], row('2026-09-02', '신장분사2.5', 1)).hasHistory, false);
  });
  it('preserves counts for a cut and increments for a copy, without changing the original rows', () => {
    const original = row('2026-09-01');
    const destination = row('2026-09-08');
    assert.equal(usage([original], destination).count, 2);
    const moved = overlayInsuranceScheduleRows([original], [{ ...original, content: '' }, destination]);
    assert.equal(usage(moved, destination).count, 1);
    assert.equal(original.content, '1001/가상환자(99)');
    assert.equal(usage([original], original).count, 1);
  });
  it('uses schedule authority for linked logs and includes standalone history exactly once', () => {
    const rows = [row('2026-09-01')];
    const baseLog = { patient_name: '가상환자', chart_number: '1001', date: '2026-09-01', prescription: 'F2.5', type: 'shockwave' };
    const logs = [{ ...baseLog, id: 'duplicate' }, { ...baseLog, id: 'linked', source: 'scheduler', scheduler_cell_key: '2026:09:0:1:0:0' }, { ...baseLog, id: 'older', date: '2026-08-01' }];
    assert.equal(usage(rows, row('2026-09-02'), logs).count, 3);
    assert.equal(usage(rows, logs[0], logs).count, 2);
  });
  it('uses the same counts for the dialog, and resets visit warnings annually', () => {
    const rows = ['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29', '2026-10-06'].map((date) => row(date));
    const warnings = (target) => buildScheduleReservationWarnings({ target, scheduleRows: rows, settings, year: target.year, month: target.month });
    assert.equal(warnings(row('2027-08-31')).find((w) => w.type === 'shockwave-visit-limit').insuranceUsage.count, 7);
    assert.equal(warnings(row('2027-09-01')).length, 0);
    assert.equal(warnings(row('2027-08-31', 'F2.5(본인)')).length, 0);
  });
  it('starts both categories on July 1, 2026 inclusive and excludes all earlier visits', () => {
    for (const prescription of ['F2.5', '30분']) {
      const rows = [row('2025-09-01', prescription), row('2026-06-30', prescription), row('2026-07-01', prescription)];
      assert.equal(usage(rows, rows[1]).count, 0);
      assert.equal(usage(rows, rows[2]).count, 1);
      assert.equal(usage(rows, row('2026-07-02', prescription)).count, 2);
    }
  });
  it('renews manual therapy on January 1 and carries the new-year count to integer shinjang', () => {
    const rows = [row('2026-07-01', '30분'), row('2026-12-31', '30분')];
    assert.equal(usage(rows, rows[1]).count, 2);
    assert.equal(usage(rows, rows[1]).periodEnd, '2027-01-01');
    assert.equal(usage(rows, row('2027-01-01', '신장분사1')).count, 0);
    assert.equal(usage(rows, row('2027-01-01', '30분')).count, 1);
    assert.equal(usage(rows, row('2027-01-01', '30분')).periodEnd, '2028-01-01');
  });
});

describe('complete insurance history reads', () => {
  it('reads every page, including exact page boundaries', async () => {
    const ranges = [];
    const rows = await readAllInsuranceRows(() => ({ range: async (start, end) => {
      ranges.push([start, end]); return { data: start < 4 ? [start, start + 1] : [], error: null };
    } }), 2);
    assert.deepEqual(rows, [0, 1, 2, 3]);
    assert.deepEqual(ranges, [[0, 1], [2, 3], [4, 5]]);
  });
  it('throws on a later failed page instead of returning a partial count', async () => {
    await assert.rejects(readAllInsuranceRows(() => ({ range: async (start) => start ? { error: new Error('read failed') } : { data: [1, 2] } }), 2), /read failed/);
  });
});
