import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildBlankScheduleCleanupPayload,
  sanitizeBlankScheduleCellData,
} from '../scheduleBlankCellCleanupUtils.js';

const keyOf = (item) => `${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`;
const defaultSpan = { rowSpan: 1, colSpan: 1, mergedInto: null };

describe('schedule blank cell cleanup helpers', () => {
  it('cleans visually empty cells that still have treatment metadata', () => {
    const memos = {
      '0-0-3-1': {
        content: '',
        bg_color: '#ffe9a8',
        prescription: 'F/R',
        body_part: 'Lumbar',
        merge_span: defaultSpan,
      },
    };

    const payload = buildBlankScheduleCleanupPayload({
      memos,
      currentYear: 2026,
      currentMonth: 5,
    });

    assert.equal(payload.length, 1);
    assert.equal(keyOf(payload[0]), '0-0-3-1');
    assert.equal(payload[0].content, '');
    assert.equal(payload[0].bg_color, null);
    assert.equal(payload[0].prescription, null);
    assert.equal(payload[0].body_part, null);
    assert.equal(payload[0].merge_span.meta.intentional_clear, true);
  });

  it('does not clean cells with visible content', () => {
    const payload = buildBlankScheduleCleanupPayload({
      memos: {
        '0-0-3-1': {
          content: '123/홍길동',
          bg_color: '#ffe9a8',
          prescription: 'F/R',
          body_part: 'Lumbar',
          merge_span: defaultSpan,
        },
      },
      currentYear: 2026,
      currentMonth: 5,
    });

    assert.equal(payload.length, 0);
  });

  it('does not clean a valid merged child when the master has content', () => {
    const payload = buildBlankScheduleCleanupPayload({
      memos: {
        '0-0-2-1': {
          content: '123/홍길동40',
          merge_span: { rowSpan: 2, colSpan: 1, mergedInto: null },
        },
        '0-0-3-1': {
          content: '',
          merge_span: { rowSpan: 1, colSpan: 1, mergedInto: '0-0-2-1' },
        },
      },
      currentYear: 2026,
      currentMonth: 5,
    });

    assert.equal(payload.length, 0);
  });

  it('cleans stale merged child metadata when the master is gone', () => {
    const payload = buildBlankScheduleCleanupPayload({
      memos: {
        '0-0-3-1': {
          content: '',
          merge_span: { rowSpan: 1, colSpan: 1, mergedInto: '0-0-2-1' },
        },
      },
      currentYear: 2026,
      currentMonth: 5,
    });

    assert.equal(payload.length, 1);
    assert.equal(keyOf(payload[0]), '0-0-3-1');
    assert.deepEqual(
      {
        rowSpan: payload[0].merge_span.rowSpan,
        colSpan: payload[0].merge_span.colSpan,
        mergedInto: payload[0].merge_span.mergedInto,
      },
      defaultSpan
    );
  });

  it('keeps blank cells with user memo markers', () => {
    const payload = buildBlankScheduleCleanupPayload({
      memos: {
        '0-0-3-1': {
          content: '',
          bg_color: '#ffe9a8',
          merge_span: {
            rowSpan: 1,
            colSpan: 1,
            mergedInto: null,
            meta: { memo_list: ['주의'] },
          },
        },
      },
      currentYear: 2026,
      currentMonth: 5,
    });

    assert.equal(payload.length, 0);
  });

  it('keeps blank cells with intentional green background', () => {
    const memos = {
      '0-0-3-1': {
        content: '',
        bg_color: '#93c47d',
        merge_span: defaultSpan,
      },
    };

    const payload = buildBlankScheduleCleanupPayload({
      memos,
      currentYear: 2026,
      currentMonth: 5,
    });
    const result = sanitizeBlankScheduleCellData({
      key: '0-0-3-1',
      memos,
      cellData: memos['0-0-3-1'],
    });

    assert.equal(payload.length, 0);
    assert.equal(result.wasSanitized, false);
    assert.equal(result.cellData.bg_color, '#93c47d');
  });

  it('sanitizes stale blank cell metadata before render', () => {
    const memos = {
      '0-0-3-1': {
        content: '',
        bg_color: '#ffe9a8',
        prescription: 'F/R',
        body_part: 'Lumbar',
        merge_span: defaultSpan,
      },
    };

    const result = sanitizeBlankScheduleCellData({
      key: '0-0-3-1',
      memos,
      cellData: memos['0-0-3-1'],
    });

    assert.equal(result.wasSanitized, true);
    assert.equal(result.cellData.bg_color, null);
    assert.equal(result.cellData.prescription, null);
    assert.deepEqual(result.mergeSpan, defaultSpan);
  });

  it('keeps blank cells with active merge spans', () => {
    const memos = {
      '0-0-3-1': {
        content: '',
        merge_span: { rowSpan: 2, colSpan: 1, mergedInto: null },
      },
    };

    const result = sanitizeBlankScheduleCellData({
      key: '0-0-3-1',
      memos,
      cellData: memos['0-0-3-1'],
    });

    assert.equal(result.wasSanitized, false);
  });
});
