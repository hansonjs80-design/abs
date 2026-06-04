import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildMoveScheduleSelectionPayload } from '../scheduleMoveUtils.js';

const defaultArgs = {
  currentYear: 2026,
  currentMonth: 5,
  rowCount: 10,
};

const keyOf = (item) => `${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`;

function applyPayload(memos, payload) {
  const next = { ...memos };
  payload.forEach((item) => {
    const key = keyOf(item);
    next[key] = {
      ...(next[key] || {}),
      content: item.content,
      bg_color: item.bg_color,
      merge_span: item.merge_span,
      prescription: item.prescription,
      body_part: item.body_part,
    };
  });
  return next;
}

describe('schedule move payload helpers', () => {
  it('moves a single selected cell down one row', () => {
    const memos = {
      '0-0-2-1': {
        content: '123/홍길동(2)',
        bg_color: '#fee',
        merge_span: { rowSpan: 1, colSpan: 1, mergedInto: null },
        prescription: 'F/R',
        body_part: 'Lumbar',
      },
    };

    const result = buildMoveScheduleSelectionPayload({
      ...defaultArgs,
      selectedKeys: new Set(['0-0-2-1']),
      memos,
      rowDelta: 1,
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.movedKeys, ['0-0-3-1']);
    assert.equal(result.payload.find((item) => keyOf(item) === '0-0-2-1').content, '');
    const moved = result.payload.find((item) => keyOf(item) === '0-0-3-1');
    assert.equal(moved.content, '123/홍길동(2)');
    assert.equal(moved.prescription, 'F/R');
    assert.equal(moved.body_part, 'Lumbar');
  });

  it('blocks moves when the destination contains another reservation', () => {
    const result = buildMoveScheduleSelectionPayload({
      ...defaultArgs,
      selectedKeys: new Set(['0-0-2-1']),
      memos: {
        '0-0-2-1': { content: 'A' },
        '0-0-3-1': { content: 'B' },
      },
      rowDelta: 1,
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'occupied');
    assert.equal(result.payload.length, 0);
  });

  it('allows moves into a cell that was intentionally cleared by a prior operation', () => {
    const result = buildMoveScheduleSelectionPayload({
      ...defaultArgs,
      selectedKeys: new Set(['0-0-2-1']),
      memos: {
        '0-0-2-1': { content: 'A' },
        '0-0-3-1': {
          content: '',
          bg_color: null,
          prescription: null,
          body_part: null,
          merge_span: {
            rowSpan: 1,
            colSpan: 1,
            mergedInto: null,
            meta: { intentional_clear: true },
          },
        },
      },
      pendingDisplayValues: { '0-0-3-1': '' },
      pendingMergeSpans: {
        '0-0-3-1': {
          rowSpan: 1,
          colSpan: 1,
          mergedInto: null,
          meta: { intentional_clear: true },
        },
      },
      rowDelta: 1,
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.movedKeys, ['0-0-3-1']);
  });

  it('allows moves into a visually empty cell with a stale mergedInto reference', () => {
    const result = buildMoveScheduleSelectionPayload({
      ...defaultArgs,
      selectedKeys: new Set(['0-0-2-1']),
      memos: {
        '0-0-2-1': { content: '123/홍길동(2)' },
        '0-0-3-1': {
          content: '',
          merge_span: { rowSpan: 1, colSpan: 1, mergedInto: '0-0-1-1' },
        },
      },
      rowDelta: 1,
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.movedKeys, ['0-0-3-1']);
  });

  it('allows moves into a visually empty cell with stale treatment metadata', () => {
    const result = buildMoveScheduleSelectionPayload({
      ...defaultArgs,
      selectedKeys: new Set(['0-0-2-1']),
      memos: {
        '0-0-2-1': { content: '123/홍길동(2)' },
        '0-0-3-1': {
          content: '',
          bg_color: '#ffe9a8',
          prescription: 'F/R',
          body_part: 'Lumbar',
          merge_span: { rowSpan: 1, colSpan: 1, mergedInto: null },
        },
      },
      rowDelta: 1,
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.movedKeys, ['0-0-3-1']);
  });

  it('allows moves into a visually empty stale merged master', () => {
    const result = buildMoveScheduleSelectionPayload({
      ...defaultArgs,
      selectedKeys: new Set(['0-0-2-1']),
      memos: {
        '0-0-2-1': { content: '123/홍길동(2)' },
        '0-0-3-1': {
          content: '',
          merge_span: { rowSpan: 2, colSpan: 1, mergedInto: null },
        },
        '0-0-4-1': {
          content: '',
          merge_span: { rowSpan: 1, colSpan: 1, mergedInto: '0-0-3-1' },
        },
      },
      rowDelta: 1,
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.movedKeys, ['0-0-3-1']);
  });

  it('still blocks moves into a valid child cell from another merge', () => {
    const result = buildMoveScheduleSelectionPayload({
      ...defaultArgs,
      selectedKeys: new Set(['0-0-2-1']),
      memos: {
        '0-0-1-1': { content: '999/다른예약', merge_span: { rowSpan: 3, colSpan: 1, mergedInto: null } },
        '0-0-2-1': { content: '123/홍길동(2)' },
        '0-0-3-1': {
          content: '',
          merge_span: { rowSpan: 1, colSpan: 1, mergedInto: '0-0-1-1' },
        },
      },
      rowDelta: 1,
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'occupied');
  });

  it('treats an intentional clear marker as the visible empty state even if stale fields remain', () => {
    const result = buildMoveScheduleSelectionPayload({
      ...defaultArgs,
      selectedKeys: new Set(['0-0-2-1']),
      memos: {
        '0-0-2-1': { content: 'A' },
        '0-0-3-1': {
          content: 'stale',
          bg_color: '#ffe9a8',
          prescription: 'F/R',
          body_part: 'Lumbar',
          merge_span: { rowSpan: 1, colSpan: 1, mergedInto: null },
        },
      },
      pendingDisplayValues: { '0-0-3-1': '' },
      pendingMergeSpans: {
        '0-0-3-1': {
          rowSpan: 1,
          colSpan: 1,
          mergedInto: null,
          meta: { intentional_clear: true },
        },
      },
      rowDelta: 1,
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.movedKeys, ['0-0-3-1']);
  });

  it('moves a merged cell as one block and preserves its merge footprint', () => {
    const memos = {
      '0-0-2-1': {
        content: '123/홍길동',
        merge_span: { rowSpan: 2, colSpan: 1, mergedInto: null },
      },
      '0-0-3-1': {
        content: '',
        merge_span: { rowSpan: 1, colSpan: 1, mergedInto: '0-0-2-1' },
      },
    };

    const result = buildMoveScheduleSelectionPayload({
      ...defaultArgs,
      selectedKeys: new Set(['0-0-2-1']),
      memos,
      rowDelta: 1,
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.movedKeys, ['0-0-3-1']);
    assert.equal(result.payload.find((item) => keyOf(item) === '0-0-2-1').content, '');
    assert.deepEqual(
      result.payload.find((item) => keyOf(item) === '0-0-3-1').merge_span,
      { rowSpan: 2, colSpan: 1, mergedInto: null }
    );
    assert.deepEqual(
      result.payload.find((item) => keyOf(item) === '0-0-4-1').merge_span,
      { rowSpan: 1, colSpan: 1, mergedInto: '0-0-3-1' }
    );
  });

  it('moves a three-row merged cell down while allowing overlap with its own cells', () => {
    const memos = {
      '0-0-2-1': {
        content: '123/홍길동',
        merge_span: { rowSpan: 3, colSpan: 1, mergedInto: null },
      },
      '0-0-3-1': {
        content: '',
        merge_span: { rowSpan: 1, colSpan: 1, mergedInto: '0-0-2-1' },
      },
      '0-0-4-1': {
        content: '',
        merge_span: { rowSpan: 1, colSpan: 1, mergedInto: '0-0-2-1' },
      },
    };

    const result = buildMoveScheduleSelectionPayload({
      ...defaultArgs,
      selectedKeys: new Set(['0-0-2-1']),
      memos,
      rowDelta: 1,
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.movedKeys, ['0-0-3-1']);
    assert.deepEqual(
      result.payload.find((item) => keyOf(item) === '0-0-3-1').merge_span,
      { rowSpan: 3, colSpan: 1, mergedInto: null }
    );
    assert.deepEqual(
      result.payload.find((item) => keyOf(item) === '0-0-5-1').merge_span,
      { rowSpan: 1, colSpan: 1, mergedInto: '0-0-3-1' }
    );
  });

  it('normalizes a selected merged child to its master before moving', () => {
    const memos = {
      '0-0-2-1': {
        content: '123/홍길동',
        merge_span: { rowSpan: 2, colSpan: 1, mergedInto: null },
      },
      '0-0-3-1': {
        content: '',
        merge_span: { rowSpan: 1, colSpan: 1, mergedInto: '0-0-2-1' },
      },
    };

    const result = buildMoveScheduleSelectionPayload({
      ...defaultArgs,
      selectedKeys: new Set(['0-0-3-1']),
      memos,
      rowDelta: -1,
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.movedKeys, ['0-0-1-1']);
  });

  it('preserves treatment fields and merge state after repeated three-row moves', () => {
    let memos = {
      '0-0-2-1': {
        content: '123/홍길동(7)',
        bg_color: '#fff1a8',
        merge_span: {
          rowSpan: 3,
          colSpan: 1,
          mergedInto: null,
          meta: { memo_list: ['주의'] },
        },
        prescription: 'F/R',
        body_part: 'Lumbar',
      },
      '0-0-3-1': {
        content: '',
        merge_span: { rowSpan: 1, colSpan: 1, mergedInto: '0-0-2-1' },
      },
      '0-0-4-1': {
        content: '',
        merge_span: { rowSpan: 1, colSpan: 1, mergedInto: '0-0-2-1' },
      },
    };

    let selectedKeys = new Set(['0-0-2-1']);
    [1, 1, -1].forEach((rowDelta) => {
      const result = buildMoveScheduleSelectionPayload({
        ...defaultArgs,
        selectedKeys,
        memos,
        rowDelta,
      });
      assert.equal(result.ok, true);
      memos = applyPayload(memos, result.payload);
      selectedKeys = new Set(result.movedKeys);
    });

    const master = memos['0-0-3-1'];
    assert.equal(master.content, '123/홍길동(7)');
    assert.equal(master.bg_color, '#fff1a8');
    assert.equal(master.prescription, 'F/R');
    assert.equal(master.body_part, 'Lumbar');
    assert.deepEqual(master.merge_span, {
      rowSpan: 3,
      colSpan: 1,
      mergedInto: null,
      meta: { memo_list: ['주의'] },
    });
    assert.deepEqual(memos['0-0-4-1'].merge_span, { rowSpan: 1, colSpan: 1, mergedInto: '0-0-3-1' });
    assert.deepEqual(memos['0-0-5-1'].merge_span, { rowSpan: 1, colSpan: 1, mergedInto: '0-0-3-1' });
  });

  it('drops custom reservation time when moving so the destination row time is used', () => {
    const memos = {
      '0-0-2-1': {
        content: '123/홍길동',
        merge_span: {
          rowSpan: 2,
          colSpan: 1,
          mergedInto: null,
          meta: {
            reservation_time: '09:10',
            memo_list: ['주의'],
          },
        },
      },
      '0-0-3-1': {
        content: '',
        merge_span: { rowSpan: 1, colSpan: 1, mergedInto: '0-0-2-1' },
      },
    };

    const result = buildMoveScheduleSelectionPayload({
      ...defaultArgs,
      selectedKeys: new Set(['0-0-2-1']),
      memos,
      rowDelta: 1,
    });

    assert.equal(result.ok, true);
    const moved = result.payload.find((item) => keyOf(item) === '0-0-3-1');
    assert.deepEqual(moved.merge_span, {
      rowSpan: 2,
      colSpan: 1,
      mergedInto: null,
      meta: { memo_list: ['주의'] },
    });
  });
});
