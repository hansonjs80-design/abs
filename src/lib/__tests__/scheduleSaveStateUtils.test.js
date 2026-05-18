import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  applyShockwaveMemoStateUpdate,
  buildOptimisticShockwaveMemos,
  rollbackShockwaveMemoState,
} from '../scheduleSaveStateUtils.js';

const shouldKeepMemo = (memo) => Boolean(memo?.content || memo?.bg_color);

describe('schedule save state helpers', () => {
  it('rolls a failed optimistic single-cell save back to the previous memo', () => {
    const previous = {
      '0-0-0-0': { content: '1234/홍길동', bg_color: null },
    };
    const optimistic = applyShockwaveMemoStateUpdate(
      previous,
      '0-0-0-0',
      { content: '9999/홍길동', bg_color: '#ffe599' },
      shouldKeepMemo
    );

    assert.deepEqual(optimistic['0-0-0-0'], { content: '9999/홍길동', bg_color: '#ffe599' });
    assert.deepEqual(
      rollbackShockwaveMemoState(optimistic, { '0-0-0-0': previous['0-0-0-0'] }),
      previous
    );
  });

  it('removes a newly-created optimistic memo when the save fails', () => {
    const optimistic = applyShockwaveMemoStateUpdate(
      {},
      '0-0-0-0',
      { content: '1234/신환', bg_color: null },
      shouldKeepMemo
    );

    assert.equal(optimistic['0-0-0-0'].content, '1234/신환');
    assert.deepEqual(rollbackShockwaveMemoState(optimistic, { '0-0-0-0': undefined }), {});
  });

  it('builds bulk optimistic snapshots with previous values for rollback', () => {
    const current = {
      '0-0-0-0': { content: '1234/홍길동', bg_color: null },
    };

    const { previousMemos, optimisticMemos } = buildOptimisticShockwaveMemos(
      current,
      [
        {
          week_index: 0,
          day_index: 0,
          row_index: 0,
          col_index: 0,
          content: '1234/홍길동',
          bg_color: '#ffe599',
        },
      ],
      '2026-05-18T00:00:00.000Z'
    );

    assert.deepEqual(previousMemos['0-0-0-0'], current['0-0-0-0']);
    assert.equal(optimisticMemos['0-0-0-0'].bg_color, '#ffe599');
    assert.equal(optimisticMemos['0-0-0-0'].updated_at, '2026-05-18T00:00:00.000Z');
  });
});
