import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MOBILE_SCHEDULE_CELL_MIN_FONT_SIZE,
  getMobileScheduleCellFitFontSize,
} from '../scheduleCellTextFitUtils.js';

test('mobile schedule cell keeps the configured font size when content already fits', () => {
  assert.equal(getMobileScheduleCellFitFontSize({
    baseFontSize: 16,
    contentWidth: 100,
    contentHeight: 20,
    availableWidth: 120,
    availableHeight: 28,
  }), 16);
});

test('mobile schedule cell reduces text to fit the available horizontal space', () => {
  assert.equal(getMobileScheduleCellFitFontSize({
    baseFontSize: 16,
    contentWidth: 180,
    contentHeight: 20,
    availableWidth: 90,
    availableHeight: 28,
    safetyFactor: 1,
  }), 8);
});

test('mobile schedule cell reduces multiline text to fit the available height', () => {
  assert.equal(getMobileScheduleCellFitFontSize({
    baseFontSize: 18,
    contentWidth: 100,
    contentHeight: 72,
    availableWidth: 120,
    availableHeight: 48,
    safetyFactor: 1,
  }), 12);
});

test('mobile schedule cell never shrinks below the readable minimum', () => {
  assert.equal(getMobileScheduleCellFitFontSize({
    baseFontSize: 20,
    contentWidth: 500,
    contentHeight: 100,
    availableWidth: 50,
    availableHeight: 20,
  }), MOBILE_SCHEDULE_CELL_MIN_FONT_SIZE);
});
