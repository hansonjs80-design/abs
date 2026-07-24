import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_SCHEDULE_STICKY_TOP_OFFSET,
  SCHEDULE_STICKY_HEADER_GAP,
  getScheduleStickyTopOffset,
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
