import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { generateShockwaveCalendar } from '../calendarUtils.js';
import { buildInsuranceRecords, formatInsuranceUsage, getInsuranceUsage, getShinjangSprayInsuranceCategory, isInsuranceSelfPay, overlayInsuranceScheduleRows } from '../insuranceUsageUtils.js';
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
  const partRow = (index, body_part, prescription = 'F2.5') => row('2026-09-01', prescription, index, { body_part });
  const visitWarnings = (rows, target) => buildScheduleReservationWarnings({ target, scheduleRows: rows, settings, year: target.year, month: target.month })
    .filter((warning) => warning.type.endsWith('visit-limit'));
  it('combines lateral and medial epicondylitis into one elbow allowance', () => {
    const rows = Array.from({ length: 6 }, (_, i) => partRow(i, i < 3 ? 'Rt. 외측 상과염(M771)' : 'Lt. 내측상과염(M770)'));
    assert.equal(formatInsuranceUsage(usage(rows, rows[5])), '6회(팔꿈치 6/6)');
    const seventh = partRow(6, '외측상과염(M771)');
    assert.equal(visitWarnings(rows, seventh).length, 1);
    assert.equal(visitWarnings(rows, partRow(6, '석회성건염(M6521)')).length, 0);
    const mixed = [...rows.slice(0, 3), ...Array.from({ length: 3 }, (_, i) => partRow(i + 3, '경추근막통증(M79180)'))];
    assert.equal(formatInsuranceUsage(usage(mixed, mixed[5])), '6회(팔꿈치 3/6, 척추 3/6)');
    assert.equal(visitWarnings(mixed, seventh).length, 0);
  });
  it('combines spinal subdiagnoses and counts duplicate subdiagnoses within a visit once per region', () => {
    const rows = Array.from({ length: 6 }, (_, i) => partRow(i, i < 3 ? '경추근막통증(M79180)' : '요추/척추부 근막통(M79180)'));
    assert.equal(formatInsuranceUsage(usage(rows, rows[5])), '6회(척추 6/6)');
    assert.equal(visitWarnings(rows, partRow(6, '경추근막통증(M79180)')).length, 1);
    assert.equal(formatInsuranceUsage(usage([], partRow(0, '외측상과염(M771), 내측상과염(M770)'))), '1회(팔꿈치 1/6)');
  });
  it('returns both treatment histories at a shinjang cell without incrementing either count', () => {
    const rows = [partRow(0, '어깨'), partRow(1, '허리', '30분')];
    const records = buildInsuranceRecords({ scheduleRows: rows, settings });
    const target = partRow(2, '허리', '신장분사1');
    const shock = getInsuranceUsage(records, target, settings, 'shockwave');
    const manual = getInsuranceUsage(records, target, settings, 'manual');
    assert.equal(shock.count, 1);
    assert.equal(manual.count, 1);
    assert.equal(shock.periodEnd, '2027-09-01');
    assert.equal(manual.periodEnd, '2027-01-01');
    assert.equal(shock.hasHistory && manual.hasHistory, true);
  });
  it('allows a new body part after six visits without restarting the anniversary', () => {
    const rows = Array.from({ length: 6 }, (_, i) => partRow(i, '목'));
    const target = partRow(6, '어깨');
    const result = usage(rows, target);
    assert.equal(result.count, 7);
    assert.equal(result.limit, 12);
    assert.equal(result.periodEnd, '2027-09-01');
    assert.equal(result.overLimit, false);
    assert.equal(visitWarnings(rows, target).length, 0);
    assert.equal(formatInsuranceUsage(result), '7회(목 6/6, 어깨 1/6)');
  });
  it('warns on the seventh visit to the same body part, including after a different part', () => {
    const rows = Array.from({ length: 6 }, (_, i) => partRow(i, '목'));
    const seventh = partRow(6, '목');
    assert.equal(formatInsuranceUsage(usage(rows, seventh)), '7회(목 7/6)');
    assert.equal(visitWarnings(rows, seventh).length, 1);
    rows.push(partRow(6, '어깨'));
    const target = partRow(7, '목');
    assert.equal(usage(rows, target).exceededParts[0].count, 7);
    assert.equal(visitWarnings(rows, target).length, 1);
    assert.equal(usage(rows, target).periodEnd, '2027-09-01');
  });
  it('allows twelve visits across parts and warns at thirteen even when every part is below six', () => {
    const rows = Array.from({ length: 12 }, (_, i) => partRow(i, ['목', '어깨', '허리'][i % 3]));
    assert.equal(visitWarnings(rows, rows[11]).length, 0);
    const target = partRow(12, '어깨');
    assert.equal(visitWarnings(rows, target).length, 1);
    assert.equal(formatInsuranceUsage(usage(rows, target)), '13/12회(목 4/6, 어깨 5/6, 허리 4/6)');
    assert.equal(usage(rows, target).periodEnd, '2027-09-01');
  });
  it('counts manual therapy across all parts against fifteen and resets on January first', () => {
    const rows = Array.from({ length: 15 }, (_, i) => partRow(i, i % 2 ? '목' : '어깨', '30분'));
    assert.equal(visitWarnings(rows, rows[14]).length, 0);
    const target = partRow(15, '허리', '30분');
    assert.equal(visitWarnings(rows, target).length, 1);
    assert.equal(formatInsuranceUsage(usage(rows, target)), '16회');
    assert.equal(formatInsuranceUsage(usage(rows, target), true), '16회(16/15)');
    assert.equal(usage(rows, target).periodEnd, '2027-01-01');
    assert.equal(usage(rows, row('2027-01-01', '30분')).count, 1);
  });
  it('excludes self-pay from body counts, carries shinjang counts and resets all parts together', () => {
    const rows = [partRow(0, '목'), partRow(1, '어깨', 'F2.5(본인)'), partRow(2, '목')];
    assert.equal(formatInsuranceUsage(usage(rows, partRow(3, '어깨', '신장분사2.5'))), '2회(목 2/6)');
    const renewed = usage(rows, row('2027-09-01', 'F2.5', 0, { body_part: '어깨' }));
    assert.equal(formatInsuranceUsage(renewed), '1회(어깨 1/6)');
    assert.equal(renewed.periodEnd, '2028-09-01');
  });
  it('counts a multi-part appointment once overall and once per listed part, deduplicating labels', () => {
    const target = partRow(0, '목, 어깨\n목');
    const result = usage([], target);
    assert.equal(result.count, 1);
    assert.equal(formatInsuranceUsage(result), '1회(목 1/6, 어깨 1/6)');
  });
  it('shows usage and renewal for a previous-month cell without double-counting its canonical record', () => {
    const actual = row('2026-09-28', 'F3.0', 0, { body_part: '목' });
    const weeks = generateShockwaveCalendar(2026, 10);
    const week_index = weeks.findIndex((week) => week.some((day) => day.month === 9 && day.day === 28));
    const day_index = weeks[week_index].findIndex((day) => day.month === 9 && day.day === 28);
    const adjacent = { ...actual, month: 10, week_index, day_index };
    const rows = [row('2026-08-11'), actual, adjacent];
    assert.equal(usage(rows, adjacent).count, 2);
    assert.equal(usage(rows, adjacent).periodEnd, '2027-08-11');
    assert.equal(usage(rows, { ...adjacent, prescription: 'F2.5(본인)' }).count, 1);
  });
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
  it('links shinjang C with shockwave, carrying counts, body limits and renewal date without incrementing', () => {
    assert.equal(getShinjangSprayInsuranceCategory('신장분사C'), 'shockwave');
    assert.equal(getShinjangSprayInsuranceCategory('신장분사c'), 'shockwave');
    assert.equal(getShinjangSprayInsuranceCategory('신장분사 C'), 'shockwave');
    assert.equal(getShinjangSprayInsuranceCategory('신장분사 2.5'), 'shockwave');
    assert.equal(getShinjangSprayInsuranceCategory('신장분사 1'), 'manual');

    const rows = [
      partRow(0, '척추', '충격파 1.5'),
      partRow(1, '척추', '충격파 1.5'),
    ];
    const shinjangC = usage(rows, partRow(2, '척추', '신장분사C'));
    assert.equal(shinjangC.category, 'shockwave');
    assert.equal(shinjangC.isShinjang, true);
    assert.equal(shinjangC.hasHistory, true);
    assert.equal(shinjangC.count, 2);
    assert.equal(formatInsuranceUsage(shinjangC), '2회(척추 2/6)');
    assert.equal(shinjangC.periodEnd, '2027-09-01');

    const shinjangLowerC = usage(rows, partRow(2, '척추', '신장분사c'));
    assert.equal(shinjangLowerC.category, 'shockwave');
    assert.equal(shinjangLowerC.isShinjang, true);
    assert.equal(shinjangLowerC.hasHistory, true);
    assert.equal(shinjangLowerC.count, 2);
    assert.equal(formatInsuranceUsage(shinjangLowerC), '2회(척추 2/6)');
    assert.equal(shinjangLowerC.periodEnd, '2027-09-01');

    const kneeHistory = [
      { id: 'h1', date: '2026-08-06', chart_number: '15307', patient_name: '김시호', prescription: 'F1.5', body_part: 'Rt. 슬개건염(M765)', type: 'shockwave' },
      { id: 'h2', date: '2026-08-27', chart_number: '15307', patient_name: '김시호', prescription: 'F1.5', body_part: 'Rt. 슬개건염(M765)', type: 'shockwave' },
      { id: 'h3', date: '2026-09-04', chart_number: '15307', patient_name: '김시호', prescription: 'F1.5', body_part: 'Rt. 슬개건염(M765)', type: 'shockwave' },
      { id: 'h4', date: '2026-09-11', chart_number: '15307', patient_name: '김시호', prescription: 'F1.5', body_part: 'Rt. 슬개건염(M765)', type: 'shockwave' },
    ];
    const targetKnee = {
      id: 'draft-2-4-16-1',
      date: '2026-09-18',
      chart_number: '15307',
      patient_name: '김시호',
      prescription: '신장분사C',
      body_part: 'Rt. 슬개건염(M765)',
      history_group: 'shinjang',
      schedule_cell_key: '2-4-16-1',
    };
    const kneeUsage = usage([], targetKnee, kneeHistory);
    assert.equal(kneeUsage.category, 'shockwave');
    assert.equal(kneeUsage.count, 4);
    assert.equal(formatInsuranceUsage(kneeUsage), '4회(무릎 4/6)');
    assert.equal(kneeUsage.periodEnd, '2027-08-06');
    assert.equal(kneeUsage.isShinjang, true);
    assert.equal(kneeUsage.hasHistory, true);
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
