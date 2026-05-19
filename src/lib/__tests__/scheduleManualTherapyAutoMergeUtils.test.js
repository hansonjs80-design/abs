import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildManualTherapyAutoMergePayload,
  resolveManualTherapyAutoPrescription,
} from '../scheduleManualTherapyAutoMergeUtils.js';

const baseArgs = {
  currentYear: 2026,
  currentMonth: 5,
  rowCount: 20,
  key: '0-1-4-2',
  memos: {},
};

test('resolveManualTherapyAutoPrescription uses the explicit 40 or 60 minute prescription first', () => {
  assert.equal(resolveManualTherapyAutoPrescription({
    content: '1234/홍길동',
    prescription: '40분',
  }), '40분');
  assert.equal(resolveManualTherapyAutoPrescription({
    content: '1234/홍길동40',
    prescription: '60분',
  }), '60분');
});

test('resolveManualTherapyAutoPrescription detects 40 or 60 from the patient name when prescription is blank', () => {
  assert.equal(resolveManualTherapyAutoPrescription({
    content: '1234/홍길동40',
    prescription: '',
  }), '40분');
  assert.equal(resolveManualTherapyAutoPrescription({
    content: '1234/홍길동60(2)',
    prescription: '',
  }), '60분');
});

test('buildManualTherapyAutoMergePayload creates a merge from a name dose tag alone', () => {
  const result = buildManualTherapyAutoMergePayload({
    ...baseArgs,
    content: '1234/홍길동40',
    prescription: '',
  });

  assert.equal(result.ok, true);
  assert.equal(result.resolvedPrescription, '40분');
  assert.equal(result.payload.length, 2);
  assert.deepEqual(result.payload[0].merge_span, { rowSpan: 2, colSpan: 1, mergedInto: null });
  assert.equal(result.payload[0].prescription, '40분');
});

test('buildManualTherapyAutoMergePayload creates a merge from a prescription even without a name dose tag', () => {
  const result = buildManualTherapyAutoMergePayload({
    ...baseArgs,
    content: '1234/홍길동',
    prescription: '60분',
  });

  assert.equal(result.ok, true);
  assert.equal(result.resolvedPrescription, '60분');
  assert.equal(result.payload.length, 3);
  assert.deepEqual(result.payload[0].merge_span, { rowSpan: 3, colSpan: 1, mergedInto: null });
  assert.equal(result.payload[0].prescription, '60분');
});
