import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  getPatientHistoryScheduleCompletion,
  getPatientHistoryScheduleStatusSignature,
} from '../patientHistoryScheduleStatusUtils.js';

test('history completion follows the scheduler status rather than the appointment date', () => {
  assert.equal(getPatientHistoryScheduleCompletion({ bg_color: ' #FFE599 ', date: '2099-01-01' }), true);
  for (const bg_color of [null, '', '#ffffff', '#f4cccc']) {
    assert.equal(getPatientHistoryScheduleCompletion({ bg_color, date: '2000-01-01' }), false);
  }
  assert.equal(getPatientHistoryScheduleCompletion(null), null);
  assert.equal(getPatientHistoryScheduleCompletion(undefined), null);
});

test('completion changes invalidate cached history including pending completion and cancellation', () => {
  const memos = { a: { bg_color: '#ffe599' }, b: { bg_color: null } };
  const original = getPatientHistoryScheduleStatusSignature(memos);
  assert.notEqual(getPatientHistoryScheduleStatusSignature(memos, { a: null }), original);
  assert.notEqual(getPatientHistoryScheduleStatusSignature(memos, { b: '#ffe599' }), original);
  assert.equal(getPatientHistoryScheduleStatusSignature({ b: memos.b, a: memos.a }), original);
});

test('history fetch carries completion through linked logs, schedules, overrides and live drafts', async () => {
  const source = await readFile(new URL('../../components/shockwave/usePatientHistoryActions.js', import.meta.url), 'utf8');
  assert.match(source, /SCHEDULER_LINKED_HISTORY_SCHEDULE_SELECT = \[[\s\S]*?'bg_color'/);
  for (const value of [
    'getPatientHistoryScheduleCompletion(linkedSchedule)',
    'getPatientHistoryScheduleCompletion(s)',
    'scheduleLog.schedule_completed',
    'override.schedule_completed',
  ]) assert.ok(source.includes(`schedule_completed: ${value}`));
  assert.match(source, /schedule_completed: getPatientHistoryScheduleCompletion\(\{\s*bg_color: getEffectiveCellBgColor\(memos, pendingCellBgColors, key\)/);
});

test('only known incomplete schedules receive the blue date marker', async () => {
  const source = await readFile(new URL('../../components/shockwave/PatientHistoryModal.jsx', import.meta.url), 'utf8');
  assert.match(source, /log\.schedule_completed === false \? ' patient-history-date-cell--incomplete' : ''/);
});
