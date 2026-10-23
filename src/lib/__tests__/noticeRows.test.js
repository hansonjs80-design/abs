import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getNoticeRowCount } from '../noticeRows.js';
import { pasteNoticeClipboard } from '../noticeClipboardUtils.js';

const filled = (length) => Array.from({ length }, (_, slot_index) => ({ slot_index, content: `전달 ${slot_index + 1}` }));

test('keeps six initial rows and adds one empty row whenever the last row fills', () => {
  assert.equal(getNoticeRowCount([]), 6);
  assert.equal(getNoticeRowCount(filled(5)), 6);
  assert.equal(getNoticeRowCount(filled(6)), 7);
  assert.equal(getNoticeRowCount(filled(7)), 8);
  assert.equal(getNoticeRowCount([...filled(5), { slot_index: 5, content: '   ' }]), 6);
});

test('expands while typing and keeps the active editor mounted while clearing its text', () => {
  assert.equal(getNoticeRowCount(filled(5), 5, '새 전달'), 7);
  assert.equal(getNoticeRowCount(filled(6), 6, '새 전달'), 8);
  assert.equal(getNoticeRowCount([], 7, ''), 8);
});

test('restores additional rows from saved indices without shifting notices across gaps or months', () => {
  const saved = [{ slot_index: 2, content: '기존 전달' }, { slot_index: 8, content: '추가 전달' }];
  assert.equal(getNoticeRowCount(saved), 10);
  assert.deepEqual(saved.map(notice => notice.slot_index), [2, 8]);
  assert.equal(getNoticeRowCount([]), 6, 'an empty month starts with the original six rows');
  assert.equal(getNoticeRowCount([{ slot_index: 8, content: '' }]), 6);
});

test('never allocates a slot belonging to the following month', () => {
  assert.equal(getNoticeRowCount(filled(100)), 100);
  assert.equal(getNoticeRowCount([], 99, '마지막 전달'), 100);
  assert.equal(getNoticeRowCount([{ slot_index: 100, content: '다른 월' }]), 6);
});

test('multi-line paste extends beyond the initial six rows and leaves one blank row', async () => {
  const notices = filled(5);
  await pasteNoticeClipboard({
    text: '여섯째\n일곱째\n여덟째\n', index: 5, slotCount: 100, year: 2026, month: 10,
    saveNotice: async (slot_index, content, year, month) => {
      assert.equal(year, 2026); assert.equal(month, 10);
      notices.push({ slot_index, content }); return true;
    },
  });
  assert.deepEqual(notices.slice(5).map(notice => notice.content), ['여섯째', '일곱째', '여덟째']);
  assert.equal(getNoticeRowCount(notices), 9);
});
