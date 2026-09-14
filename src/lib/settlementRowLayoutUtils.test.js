import test from 'node:test';
import assert from 'node:assert/strict';
import { getConsecutiveRowSpan } from './settlementRowLayoutUtils.js';

test('rate cells merge adjacent matching rows without crossing gaps or groups', () => {
  const spans = (rows) => rows.map((_, i) => getConsecutiveRowSpan(rows, i, (rate) => rate));
  assert.deepEqual(spans([7, 7, 15, 15]), [2, 0, 2, 0]);
  assert.deepEqual(spans([7, 15, 7]), [1, 1, 1]);
  assert.deepEqual(spans([null, null, 7]), [1, 1, 1]);
  assert.deepEqual(spans([7]), [1]);
  assert.deepEqual(spans([]), []);
});
