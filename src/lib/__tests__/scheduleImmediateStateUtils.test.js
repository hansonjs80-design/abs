import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getScheduleImmediateStateMonthKey,
  scopeScheduleImmediateState,
} from '../scheduleImmediateStateUtils.js';

describe('schedule immediate state month isolation', () => {
  it('keeps immediate cell state only for the month that created it', () => {
    const pendingState = {
      '0-0-3-1': {
        content: '이전 달 환자',
        bg_color: '#ffcccc',
      },
    };

    assert.equal(
      scopeScheduleImmediateState(pendingState, '2026-08', 2026, 8),
      pendingState
    );
    assert.deepEqual(
      scopeScheduleImmediateState(pendingState, '2026-08', 2026, 9),
      {}
    );
  });

  it('normalizes single digit months before comparing state ownership', () => {
    assert.equal(getScheduleImmediateStateMonthKey('2027', '2'), '2027-02');
    assert.deepEqual(
      scopeScheduleImmediateState({ cell: 'value' }, '2027-2', 2027, 2),
      {}
    );
  });
});

