import assert from 'node:assert/strict';
import test from 'node:test';

import { applyDayOverrideTemplate } from '../schedulerOperatingHours.js';

test('applyDayOverrideTemplate applies one template only to selected weekdays', () => {
  const current = {
    1: { start_time: '09:00', end_time: '20:00', lunch_start: '13:00', lunch_end: '14:00' },
    2: { start_time: '09:00', end_time: '19:00', custom_note: 'keep me' },
    6: { start_time: '09:00', end_time: '14:00', no_lunch: true },
  };

  const updated = applyDayOverrideTemplate(current, [1, 2], {
    start_time: '09:30',
    end_time: '18:30',
    lunch_start: '12:30',
    lunch_end: '13:30',
    no_lunch: false,
  });

  assert.deepEqual(updated[1], {
    start_time: '09:30',
    end_time: '18:30',
    lunch_start: '12:30',
    lunch_end: '13:30',
  });
  assert.deepEqual(updated[2], {
    start_time: '09:30',
    end_time: '18:30',
    lunch_start: '12:30',
    lunch_end: '13:30',
    custom_note: 'keep me',
  });
  assert.deepEqual(updated[6], current[6]);
  assert.deepEqual(current[1], {
    start_time: '09:00',
    end_time: '20:00',
    lunch_start: '13:00',
    lunch_end: '14:00',
  });
});

test('applyDayOverrideTemplate clears lunch times only for selected no-lunch days', () => {
  const current = {
    3: { start_time: '14:00', end_time: '19:00', lunch_start: '12:30', lunch_end: '13:30' },
    4: { start_time: '09:00', end_time: '19:00', lunch_start: '13:00', lunch_end: '14:00' },
  };

  const updated = applyDayOverrideTemplate(current, [3], {
    start_time: '14:00',
    end_time: '19:00',
    no_lunch: true,
  });

  assert.deepEqual(updated[3], {
    start_time: '14:00',
    end_time: '19:00',
    no_lunch: true,
  });
  assert.deepEqual(updated[4], current[4]);
});
