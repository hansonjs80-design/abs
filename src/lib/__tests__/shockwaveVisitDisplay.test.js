import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildShockwaveVisitDisplay } from '../shockwaveVisitDisplay.js';
const settings = { monthly_settlement_settings: { '2026-01': {
  shockwave: { prescriptions: ['F2.5'] },
  shinjang_spray: { prescriptions: ['신장분사 2.5', '신장분사 1'], prescription_incentive_percentages: { '신장분사 2.5': 7, '신장분사 1': 15 } },
} } };
const row = (id, visit, shinjang = false, extra = {}) => ({ id, chart_number: '1', patient_name: '가상', date: `2026-09-${String(id).padStart(2, '0')}`, body_part: 'Rt. 경추근막통증(M79180)', visit_count: visit, prescription: shinjang ? '신장분사 2.5' : 'F2.5', ...extra });
test('example 1: recorded 1, 2, 3 sequence displays 3 with one Shinjang visit, without adding again', () => {
  const history = [row(1, '*'), row(2, '2', true), row(3, '3')];
  const result = buildShockwaveVisitDisplay([history[0], history[2]], history, settings);
  assert.equal(result.byRow[3], '3회(신장1회)');
  assert.equal(result.latestByRow[3], '3회(신장1회)');
  assert.equal(history[2].visit_count, '3');
});
test('example 2: continuous 1 to 5 series includes two Shinjang visits after the latest shockwave row', () => {
  const history = [row(1, '*'), row(2, '2'), row(3, '3', true), row(4, '4'), row(5, '5', true)];
  const result = buildShockwaveVisitDisplay([history[3]], history, settings);
  assert.equal(result.latestByRow[4], '5회(신장2회)');
  assert.equal(result.byRow[4], '4회(신장1회)');
});
test('does not join different body parts, gaps, resets, other patients, or 15 percent treatments', () => {
  for (const extra of [{ body_part: 'Lt. Knee' }, { visit_count: '8' }, { chart_number: '2' }, { prescription: '신장분사 1' }]) {
    const history = [row(1, '*'), row(2, '2', true, extra), row(3, '3')];
    assert.deepEqual(buildShockwaveVisitDisplay([history[2]], history, settings).latestByRow, {});
  }
  const history = [row(1, '*'), row(2, '2', true), row(3, '*'), row(4, '2')];
  assert.deepEqual(buildShockwaveVisitDisplay([history[3]], history, settings).latestByRow, {});
});
test('schedule rows override linked saved history, including cancellations', () => {
  const target = row(3, '3', false, { scheduler_cell_key: 'end' });
  const history = [row(1, '*'), row(2, '2', true, { scheduler_cell_key: 'middle' }),
    row(2, '2', true, { scheduler_cell_key: 'middle', _schedule: true, _excluded: true }), target];
  assert.deepEqual(buildShockwaveVisitDisplay([target], history, settings).latestByRow, {});
});

test('a reassigned schedule cell never borrows another patient treatment sequence', () => {
  const target = row(3, '3', false, { scheduler_cell_key: 'end' });
  const history = [row(1, '*', false, { chart_number: '2' }), row(2, '2', true, { chart_number: '2' }),
    row(3, '3', false, { chart_number: '2', scheduler_cell_key: 'end', _schedule: true })];
  assert.deepEqual(buildShockwaveVisitDisplay([target], history, settings).latestByRow, {});
});

test('historical shockwave prescriptions still connect when absent from current configured list', () => {
  const historicalSettings = { monthly_settlement_settings: { '2026-01': {
    shockwave: { prescriptions: [] },
    shinjang_spray: settings.monthly_settlement_settings['2026-01'].shinjang_spray,
  } } };
  const history = [row(1, '*'), row(2, '2', true), row(3, '3')];
  assert.equal(buildShockwaveVisitDisplay([history[0]], history, historicalSettings).latestByRow[1], '3회(신장1회)');
});


test('schedule-backed statistics IDs receive the connected series through their cell keys', () => {
  const history = [row(1, '*'), row(2, '2', true), row(3, '3')].map((entry) => ({ ...entry, scheduler_cell_key: `cell:${entry.id}`, _schedule: true }));
  const targets = [history[0], history[2]].map((entry) => ({ ...entry, id: `schedule-source:${entry.id}`, _schedule: false }));
  const result = buildShockwaveVisitDisplay(targets, history, settings);
  assert.equal(result.latestByRow['schedule-source:1'], '3회(신장1회)');
  assert.equal(result.latestByRow['schedule-source:3'], '3회(신장1회)');
});
