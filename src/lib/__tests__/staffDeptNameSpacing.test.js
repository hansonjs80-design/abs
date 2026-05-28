import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeStaffDeptNameSpacing } from '../staffMemoFormatUtils.js';

describe('staff department/name spacing normalization', () => {
  it('removes spaces only around department/name slash', () => {
    assert.equal(normalizeStaffDeptNameSpacing('PT / 홍길동'), 'PT/홍길동');
    assert.equal(normalizeStaffDeptNameSpacing('PT/ 홍길동'), 'PT/홍길동');
    assert.equal(normalizeStaffDeptNameSpacing('PT /홍길동'), 'PT/홍길동');
  });

  it('keeps surrounding duty words separated', () => {
    assert.equal(normalizeStaffDeptNameSpacing('야간 PT / 홍길동'), '야간 PT/홍길동');
    assert.equal(normalizeStaffDeptNameSpacing('PT / 홍길동 연차'), 'PT/홍길동 연차');
  });

  it('compacts comma-separated names after the slash', () => {
    assert.equal(normalizeStaffDeptNameSpacing('PT / 홍길동, 김철수'), 'PT/홍길동,김철수');
    assert.equal(normalizeStaffDeptNameSpacing('PT/ 홍길동,김철수'), 'PT/홍길동,김철수');
  });
});
