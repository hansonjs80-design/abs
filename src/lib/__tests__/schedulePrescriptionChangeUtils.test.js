import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  mergeSchedulePayloadIntoPendingContextSaves,
  mergeSchedulePayloadIntoPendingShortcutSaves,
} from '../schedulePrescriptionChangeUtils.js';

describe('schedule prescription change pending save sync', () => {
  it('updates pending context-menu saves so older debounced edits keep the new prescription', () => {
    const pending = new Map([
      ['0-0-1-2', {
        memo: {
          content: '1234/홍길동(2)',
          prescription: 'F/R',
          body_part: 'Lumbar',
        },
        overrides: {
          body_part: 'Cervical',
        },
      }],
    ]);

    mergeSchedulePayloadIntoPendingContextSaves(pending, {
      week_index: 0,
      day_index: 0,
      row_index: 1,
      col_index: 2,
      content: '1234/홍길동(2)',
      prescription: 'F1.5',
      body_part: 'Cervical',
      merge_span: { rowSpan: 1, colSpan: 1, mergedInto: null },
    });

    assert.equal(pending.get('0-0-1-2').memo.prescription, 'F1.5');
    assert.equal(pending.get('0-0-1-2').overrides.prescription, 'F1.5');
    assert.equal(pending.get('0-0-1-2').overrides.body_part, 'Cervical');
  });

  it('updates pending keyboard visit saves so they do not restore the old prescription', () => {
    const pending = new Map([
      ['0-0-1-2', {
        kw: 0,
        kd: 0,
        kr: 1,
        kc: 2,
        memo: {
          content: '1234/홍길동(2)',
          prescription: 'F/R',
        },
        nextContent: '1234/홍길동(3)',
      }],
    ]);

    mergeSchedulePayloadIntoPendingShortcutSaves(pending, {
      week_index: 0,
      day_index: 0,
      row_index: 1,
      col_index: 2,
      content: '1234/홍길동(3)',
      prescription: 'F/Rdc',
      merge_span: { rowSpan: 1, colSpan: 1, mergedInto: null },
    });

    assert.equal(pending.get('0-0-1-2').memo.prescription, 'F/Rdc');
    assert.equal(pending.get('0-0-1-2').nextContent, '1234/홍길동(3)');
  });

  it('updates pending keyboard reservation saves with both content and merge span', () => {
    const pending = new Map([
      ['0-0-1-2', {
        kw: 0,
        kd: 0,
        kr: 1,
        kc: 2,
        memo: {
          content: '1234/홍길동40(2)',
          prescription: '40분',
        },
        stableContent: '1234/홍길동40(2)',
        nextMergeSpan: { rowSpan: 2, colSpan: 1, mergedInto: null },
      }],
    ]);
    const nextMergeSpan = { rowSpan: 3, colSpan: 1, mergedInto: null };

    mergeSchedulePayloadIntoPendingShortcutSaves(pending, {
      key: '0-0-1-2',
      content: '1234/홍길동60(2)',
      prescription: '60분',
      merge_span: nextMergeSpan,
    });

    assert.equal(pending.get('0-0-1-2').memo.prescription, '60분');
    assert.equal(pending.get('0-0-1-2').stableContent, '1234/홍길동60(2)');
    assert.deepEqual(pending.get('0-0-1-2').nextMergeSpan, nextMergeSpan);
  });
});
