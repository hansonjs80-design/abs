import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildDeleteCellsPayload,
  buildMergeSelectionPayload,
} from '../scheduleMergeUtils.js';

const cellKey = (w, d, r, c) => `${w}-${d}-${r}-${c}`;
const defaultSpan = { rowSpan: 1, colSpan: 1, mergedInto: null };

describe('schedule merge payload helpers', () => {
  it('builds a merge payload that combines selected cell content into the master cell', () => {
    const memos = {
      '0-0-1-1': { content: '123/홍길동', bg_color: '#fff' },
      '0-0-1-2': { content: '메모', bg_color: null },
    };

    const { oldMemos, payload } = buildMergeSelectionPayload({
      selection: {
        w: 0,
        d: 0,
        minRow: 1,
        maxRow: 1,
        minCol: 1,
        maxCol: 2,
        masterKey: '0-0-1-1',
        isMergedMaster: false,
      },
      memos,
      currentYear: 2026,
      currentMonth: 5,
      cellKey,
    });

    assert.equal(oldMemos.length, 2);
    assert.equal(payload[0].content, '123/홍길동\n메모');
    assert.deepEqual(payload[0].merge_span, { rowSpan: 1, colSpan: 2, mergedInto: null });
    assert.equal(payload[1].content, '');
    assert.deepEqual(payload[1].merge_span, { rowSpan: 1, colSpan: 1, mergedInto: '0-0-1-1' });
  });

  it('builds an unmerge payload that preserves each cell content and clears merge spans', () => {
    const memos = {
      '0-0-2-1': {
        content: '123/홍길동',
        bg_color: '#fff',
        merge_span: { rowSpan: 1, colSpan: 2, mergedInto: null },
      },
      '0-0-2-2': {
        content: '',
        bg_color: null,
        merge_span: { rowSpan: 1, colSpan: 1, mergedInto: '0-0-2-1' },
      },
    };

    const { payload } = buildMergeSelectionPayload({
      selection: {
        w: 0,
        d: 0,
        minRow: 2,
        maxRow: 2,
        minCol: 1,
        maxCol: 2,
        masterKey: '0-0-2-1',
        isMergedMaster: true,
      },
      memos,
      currentYear: 2026,
      currentMonth: 5,
      cellKey,
    });

    assert.deepEqual(payload.map((item) => item.merge_span), [defaultSpan, defaultSpan]);
    assert.equal(payload[0].content, '123/홍길동');
    assert.equal(payload[1].content, '');
  });

  it('deleting a merged child clears the whole merge rectangle', () => {
    const memos = {
      '0-0-1-1': { content: 'A', merge_span: { rowSpan: 2, colSpan: 2, mergedInto: null } },
      '0-0-1-2': { content: '', merge_span: { rowSpan: 1, colSpan: 1, mergedInto: '0-0-1-1' } },
      '0-0-2-1': { content: '', merge_span: { rowSpan: 1, colSpan: 1, mergedInto: '0-0-1-1' } },
      '0-0-2-2': { content: '', merge_span: { rowSpan: 1, colSpan: 1, mergedInto: '0-0-1-1' } },
    };

    const { oldMemos, payload } = buildDeleteCellsPayload({
      keys: new Set(['0-0-2-2']),
      memos,
      currentYear: 2026,
      currentMonth: 5,
      cellKey,
    });

    assert.deepEqual(
      payload.map((item) => cellKey(item.week_index, item.day_index, item.row_index, item.col_index)).sort(),
      ['0-0-1-1', '0-0-1-2', '0-0-2-1', '0-0-2-2']
    );
    assert.equal(oldMemos.length, 4);
    assert.equal(payload.every((item) => item.content === '' && item.bg_color === null), true);
  });

  it('deleting a pending moved merged master clears the pending merge rectangle', () => {
    const { payload } = buildDeleteCellsPayload({
      keys: new Set(['0-0-5-1']),
      memos: {},
      pendingDisplayValues: { '0-0-5-1': '123/홍길동(3)' },
      pendingMergeSpans: {
        '0-0-5-1': { rowSpan: 3, colSpan: 1, mergedInto: null },
        '0-0-6-1': { rowSpan: 1, colSpan: 1, mergedInto: '0-0-5-1' },
        '0-0-7-1': { rowSpan: 1, colSpan: 1, mergedInto: '0-0-5-1' },
      },
      currentYear: 2026,
      currentMonth: 5,
      cellKey,
    });

    assert.deepEqual(
      payload.map((item) => cellKey(item.week_index, item.day_index, item.row_index, item.col_index)).sort(),
      ['0-0-5-1', '0-0-6-1', '0-0-7-1']
    );
    assert.equal(payload.every((item) => item.content === '' && item.bg_color === null), true);
    assert.equal(payload.every((item) => item.merge_span.rowSpan === 1 && item.merge_span.mergedInto === null), true);
  });

  it('uses pending display values in delete undo snapshots', () => {
    const memos = {
      '0-0-0-0': { content: '저장전', merge_span: defaultSpan },
    };

    const { oldMemos } = buildDeleteCellsPayload({
      keys: new Set(['0-0-0-0']),
      memos,
      pendingDisplayValues: { '0-0-0-0': '화면값' },
      currentYear: 2026,
      currentMonth: 5,
      cellKey,
    });

    assert.equal(oldMemos[0].content, '화면값');
  });
});
