import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseCArmClipboard, pasteCArmCounts } from '../cArmClipboard.js';
import { cArmMonthTotal } from '../cArmStats.js';

const source = () => ({ incentive_rate: 2000, radiographers: [
  { id: 'a', name: '가', days: { 1: { first: 8, returning: 9 }, 10: { first: 7 } } },
  { id: 'b', name: '나', days: {} },
] });
const paste = (document, text, options = {}) => pasteCArmCounts(document, { text, year: 2026, month: 9, personId: 'a', day: 1, kind: 'first', ...options });

describe('C-Arm spreadsheet paste', () => {
  it('parses Excel CRLF, Google Sheets LF, quotes and trailing separators', () => {
    assert.deepEqual(parseCArmClipboard('"1,000"\t2\r\n3\t4\r\n'), [['1,000', '2'], ['3', '4']]);
    assert.deepEqual(parseCArmClipboard('1\t\n\t\n'), [['1', ''], ['', '']]);
    assert.deepEqual(parseCArmClipboard('"a\nb"\t"a""b"'), [['a\nb', 'a"b']]);
    assert.throws(() => parseCArmClipboard('"1\t2'), /따옴표/);
  });
  it('fills both visit columns across days, preserving other days and the source', () => {
    const original = source();
    const snapshot = structuredClone(original);
    const result = paste(original, '1\t2\n3\t4\n');
    assert.equal(result.rows, 2);
    assert.equal(result.columns, 2);
    assert.deepEqual(result.document.radiographers[0].days[1], { first: 1, returning: 2 });
    assert.deepEqual(result.document.radiographers[0].days[2], { first: 3, returning: 4 });
    assert.equal(result.document.radiographers[0].days[10].first, 7);
    assert.deepEqual(original, snapshot);
    assert.equal(cArmMonthTotal(result.document), 17);
  });
  it('pastes four columns into two radiographer tables', () => {
    const result = paste(source(), '1\t2\t3\t4\n5\t6\t7\t8');
    assert.deepEqual(result.document.radiographers[1].days[1], { first: 3, returning: 4 });
    assert.deepEqual(result.document.radiographers[1].days[2], { first: 7, returning: 8 });
  });
  it('starts at the focused returning column and leaves the first column unchanged', () => {
    const result = paste(source(), '2\t3\t4', { kind: 'returning' });
    assert.equal(result.document.radiographers[0].days[1].first, 8);
    assert.deepEqual(result.document.radiographers[1].days[1], { first: 3, returning: 4 });
  });
  it('handles copied dates and optional header rows without treating dates as counts', () => {
    const compactResult = paste(source(), '날짜\t초진\t재진\r\n9월 1일 (화)\t3\t4\r\n9월 2일 (수)\t5\t6\r\n');
    assert.equal(compactResult.document.radiographers[0].days[2].returning, 6);
    const result = paste(source(), '날짜\t초진환자\t재진환자\r\n9월 1일 (화)\t3\t4\r\n9월 2일 (수)\t5\t6\r\n');
    assert.equal(result.document.radiographers[0].days[2].returning, 6);
    assert.equal(paste(source(), '2026-09-01\t2\t3').document.radiographers[0].days[1].first, 2);
    assert.equal(paste(source(), '9/1\t2\t3').document.radiographers[0].days[1].first, 2);
    assert.throws(() => paste(source(), '2025-09-01\t2\t3'), /날짜/);
    assert.throws(() => paste(source(), '9월 2일\t2\t3'), /날짜/);
    assert.throws(() => paste(source(), '9월 1일\t2\t3\n9월 3일\t2\t3'), /날짜/);
  });
  it('accepts thousands separators and integer decimal formats and clears blank cells', () => {
    const result = paste(source(), '"1,234"\t0.00\n\t');
    assert.deepEqual(result.document.radiographers[0].days[1], { first: 1234, returning: 0 });
    assert.deepEqual(result.document.radiographers[0].days[2], { first: null, returning: null });
    assert.equal(paste(source(), '').document.radiographers[0].days[1].first, null);
  });
  it('rejects invalid values atomically, including formulas and fractional/negative counts', () => {
    const original = source();
    const snapshot = structuredClone(original);
    for (const value of ['-1', '1.5', '1,23', '=2+3', '환자', '100001', 'Infinity']) {
      assert.throws(() => paste(original, `1\t2\n3\t${value}`));
      assert.deepEqual(original, snapshot);
    }
  });
  it('rejects month overflow, column overflow, and non-rectangular data without truncation', () => {
    assert.throws(() => paste(source(), '1\n2', { day: 30 }), /마지막 날짜/);
    assert.throws(() => paste(source(), '1\t2', { personId: 'b', kind: 'returning' }), /열이/);
    assert.throws(() => paste(source(), '1\t2\n3'), /열 수/);
    assert.equal(paste(source(), '1\n2', { year: 2028, month: 2, day: 28 }).rows, 2);
    assert.throws(() => paste(source(), '1\n2', { year: 2026, month: 2, day: 28 }), /마지막 날짜/);
  });
});
