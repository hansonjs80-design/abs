import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseNoticePasteValues, pasteNoticeClipboard } from '../noticeClipboardUtils.js';

test('pastes consecutive notice rows without clearing another cell for a trailing newline', () => {
  assert.deepEqual(parseNoticePasteValues('첫째\n둘째\n', 4), ['첫째', '둘째']);
  assert.deepEqual(parseNoticePasteValues('첫째\n\n셋째', 2), ['첫째', '']);
  assert.deepEqual(parseNoticePasteValues('첫째\t다른 열\n둘째', 1), ['첫째']);
});


test('clears a cut source only after a successful paste into another cell', async () => {
  const writes = [];
  const cut = { index: 0, content: '전달', year: 2026, month: 10 };
  const paste = (overrides = {}) => pasteNoticeClipboard({
    text: '전달', index: 2, slotCount: 6, year: 2026, month: 10, cut,
    saveNotice: async (...args) => { writes.push(args); return true; },
    isCutSourceUnchanged: () => true, ...overrides,
  });
  await paste();
  assert.deepEqual(writes, [[2, '전달', 2026, 10], [0, '', 2026, 10]]);
  for (const overrides of [{ cut: null }, { index: 0 }, { isCutSourceUnchanged: () => false }, { month: 11 }]) {
    writes.length = 0;
    await paste(overrides);
    assert.equal(writes.length, 1);
    assert.equal(writes[0][1], '전달');
  }
  writes.length = 0;
  assert.equal(await paste({ saveNotice: async (...args) => { writes.push(args); return false; } }), false);
  assert.equal(writes.length, 1);
});
