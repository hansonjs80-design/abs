import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getScheduleDefaultMergeRowSpan,
  getScheduleDisplaySlotMinutes,
} from '../schedulerUtils.js';

test('getScheduleDefaultMergeRowSpan preserves the 10 minute two-slot baseline', () => {
  assert.equal(getScheduleDisplaySlotMinutes({
    interval_minutes: 10,
    time_label_interval_minutes: 20,
  }), 10);
  assert.equal(getScheduleDefaultMergeRowSpan({
    interval_minutes: 10,
    time_label_interval_minutes: 20,
  }), 2);
});

test('getScheduleDefaultMergeRowSpan keeps 15 minute cells unmerged by default', () => {
  assert.equal(getScheduleDisplaySlotMinutes({
    interval_minutes: 15,
    time_label_interval_minutes: 30,
  }), 15);
  assert.equal(getScheduleDefaultMergeRowSpan({
    interval_minutes: 15,
    time_label_interval_minutes: 30,
  }), 1);
});
