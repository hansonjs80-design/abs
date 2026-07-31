import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getStaffMemoEditorColors,
  getStaffMemoDisplayText,
  getStaffMemoEditorPosition,
} from './staffCalendarEditorUtils.js';

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

test('staff memo editor keeps the configured cell background and font colors', () => {
  assert.deepEqual(
    getStaffMemoEditorColors({
      backgroundColor: '#93c47d',
      fontColor: '#0000ff',
      computedColor: 'rgb(30, 41, 59)',
    }),
    {
      background: '#93c47d',
      color: '#0000ff',
    }
  );
});

test('staff memo editor falls back to the rendered text color and default background', () => {
  assert.deepEqual(
    getStaffMemoEditorColors({
      computedColor: 'rgb(229, 62, 62)',
    }),
    {
      background: 'var(--bg-input, #fff)',
      color: 'rgb(229, 62, 62)',
    }
  );
});
