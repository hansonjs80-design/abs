import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  applyShockwaveMemoStateUpdate,
  buildOptimisticShockwaveMemos,
  buildShockwaveScheduleDeleteFilters,
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

  it('builds chunked bulk delete filters for schedule cells', () => {
    const filters = buildShockwaveScheduleDeleteFilters([
      { year: 2026, month: 6, week_index: 0, day_index: 1, row_index: 2, col_index: 3 },
      { year: 2026, month: 6, week_index: 0, day_index: 1, row_index: 2, col_index: 3 },
      { year: 2026, month: 6, week_index: 0, day_index: 1, row_index: 3, col_index: 3 },
      { year: 2026, month: 6, week_index: 0, day_index: 1, row_index: 'bad', col_index: 3 },
    ], 1);

    assert.deepEqual(filters, [
      'and(year.eq.2026,month.eq.6,week_index.eq.0,day_index.eq.1,row_index.eq.2,col_index.eq.3)',
      'and(year.eq.2026,month.eq.6,week_index.eq.0,day_index.eq.1,row_index.eq.3,col_index.eq.3)',
    ]);
  });
});
