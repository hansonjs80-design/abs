import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  getStaffMemoEditorColors,
  getStaffMemoDisplayText,
  getStaffMemoEditorPosition,
  getStaffHolidayDisplayStyle,
} from './staffCalendarEditorUtils.js';

const calendarCssUrl = new URL('../styles/calendar.css', import.meta.url);

test('staff memo editor hides the rendered cell text while editing', () => {
  assert.equal(getStaffMemoDisplayText({
    content: 'PT/김세령',
    holidayName: '공휴일',
    isEditing: true,
  }), '');
});

test('staff memo display keeps the memo and holiday fallback outside editing', () => {
  assert.equal(getStaffMemoDisplayText({ content: '간호/강수아', holidayName: '공휴일' }), '간호/강수아');
  assert.equal(getStaffMemoDisplayText({ holidayName: '제헌절' }), '제헌절');
  assert.equal(getStaffMemoDisplayText({ content: '비공개', isDepartmentHidden: true }), '');
});

test('staff holiday text uses the adjacent-month gray outside the current month', () => {
  assert.deepEqual(getStaffHolidayDisplayStyle({
    holidayName: '광복절',
    isOtherMonth: true,
  }), {
    color: 'var(--cal-other-month-text)',
    fontWeight: 600,
  });
  assert.deepEqual(getStaffHolidayDisplayStyle({
    holidayName: '제헌절',
  }), {
    color: '#e53e3e',
    fontWeight: 600,
  });
});

test('staff memo editor position includes calendar scroll offsets', () => {
  assert.deepEqual(
    getStaffMemoEditorPosition(
      { left: 72, top: 184 },
      { left: 12, top: 64 },
      { scrollLeft: 208, scrollTop: 16 }
    ),
    { left: 268, top: 136 }
  );
});

test('staff memo editor slightly lightens the configured cell background and keeps its font color', () => {
  assert.deepEqual(
    getStaffMemoEditorColors({
      backgroundColor: '#93c47d',
      fontColor: '#0000ff',
      computedBackgroundColor: 'rgba(59, 130, 246, 0.22)',
      computedColor: 'rgb(30, 41, 59)',
    }),
    {
      background: 'color-mix(in srgb, #93c47d 88%, white 12%)',
      color: '#0000ff',
    }
  );
});

test('staff memo editor slightly lightens saturday and holiday date backgrounds', () => {
  assert.equal(
    getStaffMemoEditorColors({
      computedBackgroundColor: 'rgba(59, 130, 246, 0.22)',
    }).background,
    'color-mix(in srgb, rgba(59, 130, 246, 0.22) 88%, white 12%)'
  );
  assert.equal(
    getStaffMemoEditorColors({
      computedBackgroundColor: 'rgb(254, 210, 210)',
    }).background,
    'color-mix(in srgb, rgb(254, 210, 210) 88%, white 12%)'
  );
});

test('staff memo editor falls back to the rendered text color and default background', () => {
  assert.deepEqual(
    getStaffMemoEditorColors({
      computedBackgroundColor: 'rgba(0, 0, 0, 0)',
      computedColor: 'rgb(229, 62, 62)',
    }),
    {
      background: 'color-mix(in srgb, var(--bg-input, #fff) 88%, white 12%)',
      color: 'rgb(229, 62, 62)',
    }
  );
});

test('staff memo selection keeps the cell background and adds a tint overlay', async () => {
  const calendarCss = await readFile(calendarCssUrl, 'utf8');
  const selectionRule = calendarCss.match(
    /\.memo-slot:focus,\s*\.memo-slot\.selected,\s*\.memo-slot\.primary-selected\s*\{([^}]*)\}/s
  );

  assert.ok(selectionRule);
  assert.doesNotMatch(selectionRule[1], /background\s*:/);
  assert.match(
    calendarCss,
    /\.memo-slot:focus::after,\s*\.memo-slot\.selected::after,\s*\.memo-slot\.primary-selected::after\s*\{[^}]*background:\s*rgba\(66,\s*133,\s*244,\s*0\.06\);/s
  );
  assert.match(
    calendarCss,
    /\.memo-slot\s*>\s*span\s*\{[^}]*position:\s*relative;[^}]*z-index:\s*2;/s
  );
});

test('staff sunday and configured holiday cells use their red fill for every inner line', async () => {
  const calendarCss = await readFile(calendarCssUrl, 'utf8');

  assert.match(
    calendarCss,
    /\.calendar-cell\.sunday:not\(\.other-month\) \.calendar-date::after,\s*\.calendar-cell\.holiday:not\(\.other-month\) \.calendar-date::after\s*\{[^}]*background:\s*var\(--cal-sunday-bg\);/s
  );
  assert.match(
    calendarCss,
    /\.calendar-cell\.sunday:not\(\.other-month\) \.memo-slot \+ \.memo-slot::before,\s*\.calendar-cell\.holiday:not\(\.other-month\) \.memo-slot \+ \.memo-slot::before\s*\{[^}]*background:\s*var\(--cal-sunday-bg\);/s
  );
});
