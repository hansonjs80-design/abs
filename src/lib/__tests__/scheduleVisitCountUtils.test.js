import assert from 'node:assert/strict';
import test from 'node:test';

import { incrementSessionCount } from '../scheduleVisitCountUtils.js';

test('shared schedule visit increment keeps copy paste and history apply behavior', () => {
  assert.equal(incrementSessionCount('1234/환자(3)'), '1234/환자(4)');
  assert.equal(incrementSessionCount('1234/환자*'), '1234/환자(2)');
  assert.equal(incrementSessionCount('1234/환자40(3)'), '1234/환자40(4)');
  assert.equal(incrementSessionCount('1234/환자60*'), '1234/환자60(2)');
  assert.equal(incrementSessionCount('1234/환자(-)'), '1234/환자(-)');
  assert.equal(incrementSessionCount('1234/환자'), '1234/환자');
});
