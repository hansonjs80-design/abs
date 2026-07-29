import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  applyRealtimeShockwaveMemoUpdate,
  applyShockwaveMemoStateUpdate,
  buildOptimisticShockwaveMemos,
  clearSupersededScheduleInputValue,
  consumeSupersededScheduleDraft,
  invalidateScheduleCellSaveVersions,
  rollbackShockwaveMemoState,
} from '../scheduleSaveStateUtils.js';

const shouldKeepMemo = (memo) => Boolean(memo?.content || memo?.bg_color);

describe('schedule save state helpers', () => {
  it('invalidates an older cell save before patient history applies a newer value', () => {
    const versions = {
      '0-0-2-1': 4,
    };
    const staleSaveVersion = versions['0-0-2-1'];

    invalidateScheduleCellSaveVersions(versions, [{
      week_index: 0,
      day_index: 0,
      row_index: 2,
      col_index: 1,
    }]);

    assert.equal(versions['0-0-2-1'], 5);
    assert.notEqual(versions['0-0-2-1'], staleSaveVersion);
  });

  it('consumes the abandoned name draft instead of saving it after history apply', () => {
    const discardedDrafts = new Map([
      ['0-0-2-1', '주한솔'],
    ]);

    assert.equal(
      consumeSupersededScheduleDraft(discardedDrafts, '0-0-2-1', ' 주한솔 '),
      true
    );
    assert.equal(discardedDrafts.has('0-0-2-1'), false);
  });

  it('allows a genuinely new edit after clearing the abandoned history draft', () => {
    const discardedDrafts = new Map([
      ['0-0-2-1', '주한솔'],
    ]);

    assert.equal(
      consumeSupersededScheduleDraft(discardedDrafts, '0-0-2-1', '9307/주한솔(2)'),
      false
    );
    assert.equal(discardedDrafts.has('0-0-2-1'), false);
  });

  it('clears the mounted hidden input so a later cell click cannot blur-save the old name', () => {
    const input = {
      dataset: { cellKey: '0-0-2-1' },
      value: '주한솔',
    };

    assert.equal(clearSupersededScheduleInputValue(input, '0-0-2-1'), true);
    assert.equal(input.value, '');
    assert.equal(clearSupersededScheduleInputValue(input, '0-0-3-1'), false);
  });

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

  it('removes one older duplicate when a realtime move target arrives first', () => {
    const current = {
      '0-0-2-1': {
        content: '123/홍길동(2)',
        prescription: 'F/R',
        body_part: 'Lumbar',
        bg_color: null,
        updated_at: '2026-06-24T01:00:00.000Z',
      },
    };

    const next = applyRealtimeShockwaveMemoUpdate(
      current,
      '0-0-3-1',
      {
        content: '123/홍길동(2)',
        prescription: 'F/R',
        body_part: 'Lumbar',
        bg_color: null,
        updated_at: '2026-06-24T01:01:00.000Z',
      },
      shouldKeepMemo
    );

    assert.equal(next['0-0-2-1'], undefined);
    assert.equal(next['0-0-3-1'].content, '123/홍길동(2)');
  });

  it('keeps existing duplicates when a realtime update cannot identify one move source', () => {
    const current = {
      '0-0-1-1': { content: '123/홍길동(2)', prescription: 'F/R', body_part: 'Lumbar' },
      '0-0-2-1': { content: '123/홍길동(2)', prescription: 'F/R', body_part: 'Lumbar' },
    };

    const next = applyRealtimeShockwaveMemoUpdate(
      current,
      '0-0-3-1',
      { content: '123/홍길동(2)', prescription: 'F/R', body_part: 'Lumbar' },
      shouldKeepMemo
    );

    assert.equal(next['0-0-1-1'].content, '123/홍길동(2)');
    assert.equal(next['0-0-2-1'].content, '123/홍길동(2)');
    assert.equal(next['0-0-3-1'].content, '123/홍길동(2)');
  });
});
