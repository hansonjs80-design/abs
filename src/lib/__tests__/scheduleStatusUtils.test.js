import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildTreatmentStatusPayload,
  getEffectiveCellBgColor,
  TREATMENT_COMPLETE_BG,
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
});
