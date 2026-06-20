import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  isIntentionalClearScheduleItem,
  sanitizeShockwaveScheduleItemForDisplay,
} from '../shockwaveScheduleSanitize.js';

describe('shockwave schedule sanitize helpers', () => {
  it('clears stale display fields from merged child cells', () => {
    const item = sanitizeShockwaveScheduleItemForDisplay({
      content: '14314/정경훈40(6)',
      bg_color: '#ffe599',
      prescription: '40분',
      body_part: 'Lumbar',
      merge_span: { rowSpan: 1, colSpan: 1, mergedInto: '2-5-12-0' },
    });

    assert.equal(item.content, '');
    assert.equal(item.bg_color, null);
    assert.equal(item.prescription, null);
    assert.equal(item.body_part, null);
    assert.equal(item.merge_span.mergedInto, '2-5-12-0');
  });

  it('detects intentional clear payloads before save sanitization removes metadata', () => {
    assert.equal(isIntentionalClearScheduleItem({
      merge_span: { rowSpan: 1, colSpan: 1, mergedInto: null, meta: { intentional_clear: true } },
    }), true);
  });
});
