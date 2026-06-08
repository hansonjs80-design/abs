import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildHolidayBackgroundPayload,
  buildTreatmentStatusPayload,
  getEffectiveCellBgColor,
  isTreatmentCancelBg,
  TREATMENT_COMPLETE_BG,
  TREATMENT_CANCEL_BG,
} from '../scheduleStatusUtils.js';

const cellKey = (w, d, r, c) => `${w}-${d}-${r}-${c}`;
const normalizeKeysToMergeMasters = (keys) => keys;

describe('schedule treatment status payloads', () => {
  it('uses pending background colors when deciding rapid complete toggles', () => {
    const memos = {
      '0-0-0-0': {
        content: '1234/홍길동',
        bg_color: null,
        merge_span: { rowSpan: 1, colSpan: 1, mergedInto: null },
      },
    };
    const selectedKeys = new Set(['0-0-0-0']);

    const first = buildTreatmentStatusPayload({
      mode: 'toggle',
      selectedKeys,
      memos,
      currentYear: 2026,
      currentMonth: 5,
      normalizeKeysToMergeMasters,
      cellKey,
      pendingCellBgColors: {},
    });
    assert.equal(first.payload[0].bg_color, TREATMENT_COMPLETE_BG);

    const second = buildTreatmentStatusPayload({
      mode: 'toggle',
      selectedKeys,
      memos,
      currentYear: 2026,
      currentMonth: 5,
      normalizeKeysToMergeMasters,
      cellKey,
      pendingCellBgColors: { '0-0-0-0': TREATMENT_COMPLETE_BG },
    });
    assert.equal(second.payload[0].bg_color, null);
    assert.equal(second.oldMemos[0].bg_color, TREATMENT_COMPLETE_BG);
  });

  it('treats pending null as the visible background state', () => {
    assert.equal(
      getEffectiveCellBgColor(
        { '0-0-0-0': { bg_color: TREATMENT_COMPLETE_BG } },
        { '0-0-0-0': null },
        '0-0-0-0'
      ),
      null
    );
  });

  it('recognizes saved cancellation background regardless of casing or whitespace', () => {
    assert.equal(isTreatmentCancelBg(' #F4CCCC '), true);
    assert.equal(isTreatmentCancelBg(TREATMENT_CANCEL_BG), true);
    assert.equal(isTreatmentCancelBg(TREATMENT_COMPLETE_BG), false);
  });

  it('clears cancellation when the visible background is already cancelled', () => {
    const memos = {
      '0-0-0-0': {
        content: '1234/홍길동',
        bg_color: ' #F4CCCC ',
        merge_span: { rowSpan: 1, colSpan: 1, mergedInto: null },
      },
    };

    const batch = buildTreatmentStatusPayload({
      mode: 'cancel-toggle',
      selectedKeys: new Set(['0-0-0-0']),
      memos,
      currentYear: 2026,
      currentMonth: 5,
      normalizeKeysToMergeMasters,
      cellKey,
      pendingCellBgColors: {},
    });

    assert.equal(batch.payload[0].bg_color, null);
    assert.equal(batch.oldMemos[0].bg_color, ' #F4CCCC ');
  });

  it('builds holiday background payload across a merged selection', () => {
    const memos = {
      '0-0-1-1': {
        content: '1234/홍길동',
        bg_color: null,
        merge_span: { rowSpan: 1, colSpan: 2, mergedInto: null },
      },
      '0-0-1-2': {
        content: '',
        bg_color: null,
        merge_span: { rowSpan: 1, colSpan: 1, mergedInto: '0-0-1-1' },
      },
    };

    const batch = buildHolidayBackgroundPayload({
      selectedKeys: new Set(['0-0-1-1']),
      memos,
      currentYear: 2026,
      currentMonth: 5,
      normalizeKeysToMergeMasters,
      cellKey,
      holidayBgColor: '#d9ead3',
    });

    assert.equal(batch.payload.length, 2);
    assert.deepEqual(batch.payload.map((item) => item.bg_color), ['#d9ead3', '#d9ead3']);
    assert.deepEqual(batch.oldMemos.map((item) => item.bg_color), [null, null]);
  });

  it('clears holiday background when any selected master already has it', () => {
    const memos = {
      '0-0-0-0': {
        content: '1234/홍길동',
        bg_color: '#d9ead3',
        merge_span: { rowSpan: 1, colSpan: 1, mergedInto: null },
      },
    };

    const batch = buildHolidayBackgroundPayload({
      selectedKeys: new Set(['0-0-0-0']),
      memos,
      currentYear: 2026,
      currentMonth: 5,
      normalizeKeysToMergeMasters,
      cellKey,
      holidayBgColor: '#d9ead3',
    });

    assert.equal(batch.payload.length, 1);
    assert.equal(batch.payload[0].bg_color, null);
    assert.equal(batch.oldMemos[0].bg_color, '#d9ead3');
  });

  it('uses pending background colors when toggling holiday background', () => {
    const memos = {
      '0-0-0-0': {
        content: '1234/홍길동',
        bg_color: null,
        merge_span: { rowSpan: 1, colSpan: 1, mergedInto: null },
      },
    };

    const batch = buildHolidayBackgroundPayload({
      selectedKeys: new Set(['0-0-0-0']),
      memos,
      currentYear: 2026,
      currentMonth: 5,
      normalizeKeysToMergeMasters,
      cellKey,
      holidayBgColor: '#93c47d',
      pendingCellBgColors: { '0-0-0-0': '#93c47d' },
    });

    assert.equal(batch.payload.length, 1);
    assert.equal(batch.payload[0].bg_color, null);
    assert.equal(batch.oldMemos[0].bg_color, '#93c47d');
  });
});
