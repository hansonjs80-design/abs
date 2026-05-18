import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  computeScheduleSelectionInfo,
  getEffectiveScheduleMergeSpan,
  normalizeScheduleCellToMergeMaster,
  normalizeScheduleKeysToMergeMasters,
} from '../scheduleSelectionUtils.js';

const masterSpan = (rowSpan, colSpan) => ({ rowSpan, colSpan, mergedInto: null });
const childSpan = (mergedInto) => ({ rowSpan: 1, colSpan: 1, mergedInto });

describe('schedule selection merge helpers', () => {
  it('keeps a horizontal merged child attached to its master', () => {
    const memos = {
      '0-0-1-1': { merge_span: masterSpan(1, 2) },
      '0-0-1-2': { merge_span: childSpan('0-0-1-1') },
    };

    assert.deepEqual(
      getEffectiveScheduleMergeSpan({ key: '0-0-1-2', memos }),
      childSpan('0-0-1-1')
    );
  });

  it('keeps a rectangular merged child attached inside the full row and column range', () => {
    const memos = {
      '0-0-1-1': { merge_span: masterSpan(2, 2) },
      '0-0-2-2': { merge_span: childSpan('0-0-1-1') },
    };

    assert.deepEqual(
      getEffectiveScheduleMergeSpan({ key: '0-0-2-2', memos }),
      childSpan('0-0-1-1')
    );
  });

  it('detaches a stale child when it is outside the master rectangle', () => {
    const memos = {
      '0-0-1-1': { merge_span: masterSpan(1, 2) },
      '0-0-2-2': { merge_span: childSpan('0-0-1-1') },
    };

    assert.deepEqual(
      getEffectiveScheduleMergeSpan({ key: '0-0-2-2', memos }),
      { rowSpan: 1, colSpan: 1, mergedInto: null }
    );
  });

  it('uses pending merge spans for immediate master normalization', () => {
    const pendingMergeSpans = {
      '0-0-4-1': masterSpan(1, 3),
      '0-0-4-3': childSpan('0-0-4-1'),
    };

    assert.deepEqual(
      normalizeScheduleCellToMergeMaster({
        cell: { w: 0, d: 0, r: 4, c: 3 },
        memos: {},
        pendingMergeSpans,
      }),
      { w: 0, d: 0, r: 4, c: 1 }
    );
  });

  it('expands selection info from a child cell to the full merged rectangle', () => {
    const memos = {
      '0-0-3-2': { merge_span: masterSpan(2, 2) },
      '0-0-4-3': { merge_span: childSpan('0-0-3-2') },
    };

    const info = computeScheduleSelectionInfo({
      selectedCell: { w: 0, d: 0, r: 4, c: 3 },
      selectedKeys: new Set(['0-0-4-3']),
      memos,
    });

    assert.equal(info.masterKey, '0-0-3-2');
    assert.equal(info.minRow, 3);
    assert.equal(info.maxRow, 4);
    assert.equal(info.minCol, 2);
    assert.equal(info.maxCol, 3);
    assert.equal(info.isMergedMaster, true);
  });

  it('deduplicates selected merged children to their master key', () => {
    const memos = {
      '0-0-0-0': { merge_span: masterSpan(1, 2) },
      '0-0-0-1': { merge_span: childSpan('0-0-0-0') },
    };

    assert.deepEqual(
      normalizeScheduleKeysToMergeMasters({
        keys: new Set(['0-0-0-0', '0-0-0-1']),
        memos,
      }),
      new Set(['0-0-0-0'])
    );
  });
});
