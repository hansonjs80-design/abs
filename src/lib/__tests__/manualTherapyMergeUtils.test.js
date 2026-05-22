import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildManualTherapyMergePayload,
  buildManualTherapyUnmergePayload,
  getManualTherapyRowSpan,
} from '../manualTherapyMergeUtils.js';

const baseArgs = {
  currentYear: 2026,
  currentMonth: 5,
  rowCount: 20,
};

test('getManualTherapyRowSpan maps manual prescriptions to total row span', () => {
  assert.equal(getManualTherapyRowSpan('40분'), 2);
  assert.equal(getManualTherapyRowSpan('60분'), 3);
  assert.equal(getManualTherapyRowSpan('F/R'), 1);
});

test('buildManualTherapyMergePayload creates a 2-row merge for 40 minutes', () => {
  const result = buildManualTherapyMergePayload({
    ...baseArgs,
    key: '0-1-4-2',
    memos: {},
    content: '1234/홍길동40(2)',
    prescription: '40분',
    bodyPart: 'Lumbar',
  });

  assert.equal(result.ok, true);
  assert.equal(result.payload.length, 2);
  assert.deepEqual(result.payload[0].merge_span, { rowSpan: 2, colSpan: 1, mergedInto: null });
  assert.equal(result.payload[0].content, '1234/홍길동40(2)');
  assert.equal(result.payload[0].prescription, '40분');
  assert.equal(result.payload[0].body_part, 'Lumbar');
  assert.deepEqual(result.payload[1].merge_span, { rowSpan: 1, colSpan: 1, mergedInto: '0-1-4-2' });
});

test('buildManualTherapyMergePayload creates a 3-row merge for 60 minutes', () => {
  const result = buildManualTherapyMergePayload({
    ...baseArgs,
    key: '0-1-4-2',
    memos: {},
    content: '1234/홍길동60(2)',
    prescription: '60분',
  });

  assert.equal(result.ok, true);
  assert.equal(result.payload.length, 3);
  assert.deepEqual(result.payload[0].merge_span, { rowSpan: 3, colSpan: 1, mergedInto: null });
  assert.equal(result.payload[1].merge_span.mergedInto, '0-1-4-2');
  assert.equal(result.payload[2].merge_span.mergedInto, '0-1-4-2');
});

test('buildManualTherapyMergePayload blocks occupied rows below the target', () => {
  const result = buildManualTherapyMergePayload({
    ...baseArgs,
    key: '0-1-4-2',
    memos: {
      '0-1-5-2': { content: '9999/이미예약' },
    },
    content: '1234/홍길동40(2)',
    prescription: '40분',
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'occupied');
  assert.deepEqual(result.payload, []);
});

test('buildManualTherapyMergePayload allows visually empty rows with stale treatment metadata below the target', () => {
  const result = buildManualTherapyMergePayload({
    ...baseArgs,
    key: '0-1-4-2',
    memos: {
      '0-1-5-2': {
        content: '',
        bg_color: '#ffe9a8',
        prescription: 'F/R',
        body_part: 'Lumbar',
        merge_span: { rowSpan: 1, colSpan: 1, mergedInto: null },
      },
    },
    content: '1234/홍길동40(2)',
    prescription: '40분',
  });

  assert.equal(result.ok, true);
  assert.equal(result.payload.length, 2);
  const child = result.payload.find((item) => item.row_index === 5);
  assert.equal(child.content, '');
  assert.equal(child.bg_color, null);
  assert.equal(child.prescription, null);
  assert.equal(child.body_part, null);
  assert.deepEqual(child.merge_span, { rowSpan: 1, colSpan: 1, mergedInto: '0-1-4-2' });
});

test('buildManualTherapyMergePayload blocks child rows from another merge', () => {
  const result = buildManualTherapyMergePayload({
    ...baseArgs,
    key: '0-1-4-2',
    memos: {
      '0-1-5-2': { content: '', merge_span: { rowSpan: 1, colSpan: 1, mergedInto: '0-1-2-2' } },
    },
    content: '1234/홍길동40(2)',
    prescription: '40분',
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'occupied');
});

test('buildManualTherapyMergePayload clears rows left from a previous larger merge', () => {
  const result = buildManualTherapyMergePayload({
    ...baseArgs,
    key: '0-1-4-2',
    memos: {
      '0-1-4-2': { content: '1234/홍길동60(2)', merge_span: { rowSpan: 3, colSpan: 1, mergedInto: null } },
      '0-1-5-2': { merge_span: { rowSpan: 1, colSpan: 1, mergedInto: '0-1-4-2' } },
      '0-1-6-2': { merge_span: { rowSpan: 1, colSpan: 1, mergedInto: '0-1-4-2' } },
    },
    content: '1234/홍길동40(2)',
    prescription: '40분',
  });

  assert.equal(result.ok, true);
  assert.equal(result.payload.length, 3);
  const cleared = result.payload.find((item) => item.row_index === 6);
  assert.equal(cleared.content, '');
  assert.equal(cleared.merge_span.rowSpan, 1);
  assert.equal(cleared.merge_span.mergedInto, null);
  assert.equal(cleared.merge_span.meta.intentional_clear, true);
});

test('buildManualTherapyUnmergePayload clears a manual therapy merge when changing to shockwave', () => {
  const result = buildManualTherapyUnmergePayload({
    ...baseArgs,
    key: '0-1-4-2',
    memos: {
      '0-1-4-2': {
        content: '1234/홍길동60(2)',
        bg_color: '#fff1b8',
        prescription: '60분',
        body_part: 'Lumbar',
        merge_span: { rowSpan: 3, colSpan: 1, mergedInto: null },
      },
      '0-1-5-2': { merge_span: { rowSpan: 1, colSpan: 1, mergedInto: '0-1-4-2' } },
      '0-1-6-2': { merge_span: { rowSpan: 1, colSpan: 1, mergedInto: '0-1-4-2' } },
    },
    content: '1234/홍길동(2)',
    bgColor: '#fff1b8',
    prescription: 'F/R',
    bodyPart: 'Lumbar',
  });

  assert.equal(result.ok, true);
  assert.equal(result.payload.length, 3);
  assert.deepEqual(result.affectedKeys, ['0-1-4-2', '0-1-5-2', '0-1-6-2']);
  assert.deepEqual(result.payload[0].merge_span, { rowSpan: 1, colSpan: 1, mergedInto: null });
  assert.equal(result.payload[0].content, '1234/홍길동(2)');
  assert.equal(result.payload[0].prescription, 'F/R');
  assert.equal(result.payload[1].content, '');
  assert.equal(result.payload[1].prescription, null);
  assert.equal(result.payload[1].merge_span.meta.intentional_clear, true);
  assert.equal(result.payload[2].merge_span.meta.intentional_clear, true);
});
