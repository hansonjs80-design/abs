import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_SCHEDULE_STICKY_TOP_OFFSET,
  SCHEDULE_STICKY_HEADER_GAP,
  getScheduleWheelWeekDirection,
  getScheduleStickyTopOffset,
  getVisibleScheduleWeekIndex,
} from '../scheduleNavigationUtils.js';

test('schedule scroll offset follows the rendered sticky header bottom', () => {
  const documentObject = {
    querySelector(selector) {
      assert.equal(selector, '.top-tabs-shell');
      return {
        getBoundingClientRect: () => ({ bottom: 47.25 }),
      };
    },
  };

  assert.equal(
    getScheduleStickyTopOffset(documentObject),
    Math.ceil(47.25 + SCHEDULE_STICKY_HEADER_GAP),
  );
});

test('schedule scroll offset falls back safely when the header is unavailable', () => {
  assert.equal(
    getScheduleStickyTopOffset({ querySelector: () => null }),
    DEFAULT_SCHEDULE_STICKY_TOP_OFFSET,
  );
});

test('schedule wheel shortcut maps upward and downward gestures to adjacent weeks', () => {
  assert.equal(getScheduleWheelWeekDirection({ ctrlKey: true, deltaY: -120 }), -1);
  assert.equal(getScheduleWheelWeekDirection({ ctrlKey: true, deltaY: 120 }), 1);
  assert.equal(getScheduleWheelWeekDirection({ metaKey: true, deltaY: -1 }), -1);
});

test('schedule wheel shortcut ignores unmodified or conflicting wheel gestures', () => {
  assert.equal(getScheduleWheelWeekDirection({ deltaY: 120 }), 0);
  assert.equal(getScheduleWheelWeekDirection({ ctrlKey: true, shiftKey: true, deltaY: 120 }), 0);
  assert.equal(getScheduleWheelWeekDirection({ ctrlKey: true, altKey: true, deltaY: -120 }), 0);
  assert.equal(getScheduleWheelWeekDirection({ ctrlKey: true, deltaY: 0 }), 0);
});

test('visible schedule week follows the sticky-header scroll anchor', () => {
  const weekTops = [100, 500, 900, 1300];

  assert.equal(getVisibleScheduleWeekIndex(weekTops, 50), 0);
  assert.equal(getVisibleScheduleWeekIndex(weekTops, 100), 0);
  assert.equal(getVisibleScheduleWeekIndex(weekTops, 899), 1);
  assert.equal(getVisibleScheduleWeekIndex(weekTops, 1301), 3);
});

test('visible schedule week recognizes a last week clipped by the page bottom', () => {
  const weekTops = [100, 1200, 2300, 3400, 4500];
  const clippedLastWeekAnchor = 4300;

  assert.equal(
    getVisibleScheduleWeekIndex(weekTops, clippedLastWeekAnchor, {
      scrollY: 4240,
      viewportHeight: 1240,
      scrollHeight: 5480,
    }),
    4,
  );
  assert.equal(
    getVisibleScheduleWeekIndex(weekTops, clippedLastWeekAnchor, {
      scrollY: 4230,
      viewportHeight: 1240,
      scrollHeight: 5480,
    }),
    3,
  );
});

test('visible schedule week ignores missing refs and rejects unusable input', () => {
  assert.equal(getVisibleScheduleWeekIndex([Number.NaN, 500, 900], 200), 1);
  assert.equal(getVisibleScheduleWeekIndex([], 200), -1);
  assert.equal(getVisibleScheduleWeekIndex([100, 500], Number.NaN), -1);
});
