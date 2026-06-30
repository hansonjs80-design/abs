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

test('resolveManualTherapyAutoPrescription uses the edited name dose tag before the previous prescription', () => {
  assert.equal(resolveManualTherapyAutoPrescription({
    content: '1234/홍길동',
    prescription: '40분',
  }), '40분');
  assert.equal(resolveManualTherapyAutoPrescription({
    content: '1234/홍길동40',
    prescription: '60분',
  }), '40분');
  assert.equal(resolveManualTherapyAutoPrescription({
    content: '13/주한솔60',
    prescription: '40분',
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

test('buildManualTherapyAutoMergePayload expands a 40 minute cell to 60 minutes when the edited tag changes to 60', () => {
  const result = buildManualTherapyAutoMergePayload({
    ...baseArgs,
    content: '13/주한솔60',
    prescription: '40분',
    memos: {
      '0-1-4-2': {
        content: '13/주한솔40',
        prescription: '40분',
        merge_span: { rowSpan: 2, colSpan: 1, mergedInto: null },
      },
      '0-1-5-2': {
        content: '',
        merge_span: { rowSpan: 1, colSpan: 1, mergedInto: '0-1-4-2' },
      },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.resolvedPrescription, '60분');
  assert.equal(result.payload.length, 3);
  assert.deepEqual(result.payload[0].merge_span, { rowSpan: 3, colSpan: 1, mergedInto: null });
  assert.equal(result.payload[0].content, '13/주한솔60');
  assert.equal(result.payload[0].prescription, '60분');
  assert.equal(result.payload[2].merge_span.mergedInto, '0-1-4-2');
});

test('buildManualTherapyAutoMergePayload creates a merge for a configured prescription duration', () => {
  const result = buildManualTherapyAutoMergePayload({
    ...baseArgs,
    content: '1234/홍길동30',
    prescription: '충격파30',
    durationMinutesMap: { '충격파30': 60 },
    doseTags: { '충격파30': '30' },
  });

  assert.equal(result.ok, true);
  assert.equal(result.resolvedPrescription, '충격파30');
  assert.equal(result.payload.length, 3);
  assert.deepEqual(result.payload[0].merge_span, { rowSpan: 3, colSpan: 1, mergedInto: null });
});

test('buildManualTherapyAutoMergePayload resolves a configured prescription from its cell tag', () => {
  const result = buildManualTherapyAutoMergePayload({
    ...baseArgs,
    content: '1234/홍길동75',
    prescription: '',
    durationMinutesMap: { '커스텀75': 40 },
    doseTags: { '커스텀75': '75' },
  });

  assert.equal(result.ok, true);
  assert.equal(result.resolvedPrescription, '커스텀75');
  assert.equal(result.payload.length, 2);
});

test('buildManualTherapyAutoMergePayload resolves a decimal configured cell tag', () => {
  const result = buildManualTherapyAutoMergePayload({
    ...baseArgs,
    content: '1234/홍길동1.5',
    prescription: '',
    durationMinutesMap: { 'F1.5': 40 },
    doseTags: { 'F1.5': '1.5' },
  });

  assert.equal(result.ok, true);
  assert.equal(result.resolvedPrescription, 'F1.5');
  assert.equal(result.payload.length, 2);
  assert.equal(result.payload[0].prescription, 'F1.5');
});
