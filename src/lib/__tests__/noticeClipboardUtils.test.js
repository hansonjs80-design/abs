import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createNoticeClipboard, getNoticeSelectionIndices, parseNoticePasteValues, pasteNoticeClipboard } from '../noticeClipboardUtils.js';

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

function makeBoard(values, indices) {
  const notices = values.map((content, slot_index) => ({ slot_index, content }));
  const clipboard = createNoticeClipboard(notices, indices, 2026, 11);
  const writes = [];
  return {
    notices, clipboard, writes,
    options: {
      text: clipboard.text, clipboard, cut: clipboard, index: 5, slotCount: 100, year: 2026, month: 11,
      saveNotice: async (index, content, year, month) => {
        writes.push({ index, content, year, month });
        const row = notices.find(notice => notice.slot_index === index);
        if (row) row.content = content;
        else notices.push({ slot_index: index, content });
        return true;
      },
      isCutSourceUnchanged: source => (notices.find(row => row.slot_index === source.index)?.content || '') === source.content,
    },
  };
}

test('dragging in either direction copies every selected row in top-to-bottom order including blanks', () => {
  assert.deepEqual(getNoticeSelectionIndices(null), []);
  const indices = getNoticeSelectionIndices({ anchor: 4, focus: 1 });
  assert.deepEqual(indices, [1, 2, 3, 4]);
  assert.deepEqual(getNoticeSelectionIndices({ anchor: 1, focus: 4 }), indices);
  const { clipboard } = makeBoard(['unused', 'first', '', 'third', ''], indices);
  assert.equal(clipboard.text, 'first\n\nthird\n');
  assert.deepEqual(clipboard.values, ['first', '', 'third', '']);
});

test('multi-row copy preserves the source and pastes selected trailing blanks', async () => {
  const { notices, options } = makeBoard(['first', '', 'third', ''], [0, 1, 2, 3]);
  assert.equal(await pasteNoticeClipboard({ ...options, cut: null }), true);
  assert.deepEqual(notices.slice(0, 4).map(row => row.content), ['first', '', 'third', '']);
  assert.deepEqual(notices.filter(row => row.slot_index >= 5).map(row => row.content), ['first', '', 'third', '']);
});

test('moving a range clears every source only after all destinations are saved', async () => {
  const { notices, writes, options } = makeBoard(['one', 'two', 'three'], [0, 1, 2]);
  assert.equal(await pasteNoticeClipboard(options), true);
  assert.deepEqual(writes.slice(0, 3).map(row => row.index), [7, 6, 5]);
  assert.deepEqual(writes.slice(3).map(row => [row.index, row.content]), [[0, ''], [1, ''], [2, '']]);
  assert.deepEqual(notices.slice(0, 3).map(row => row.content), ['', '', '']);
});

test('overlapping cuts work both downward and upward without clearing their new destinations', async () => {
  for (const [indices, index, expected] of [
    [[0, 1, 2], 1, ['', 'A', 'B', 'C']],
    [[1, 2, 3], 0, ['B', 'C', 'D', '']],
    [[0, 1, 2], 0, ['A', 'B', 'C', 'D']],
  ]) {
    const { notices, options } = makeBoard(['A', 'B', 'C', 'D'], indices);
    assert.equal(await pasteNoticeClipboard({ ...options, index }), true);
    assert.deepEqual(notices.map(row => row.content), expected);
  }
});

test('a failed or rejected destination save never triggers source clearing', async () => {
  for (const throws of [false, true]) {
    const { writes, options } = makeBoard(['A', 'B', 'C'], [0, 1, 2]);
    const save = options.saveNotice;
    assert.equal(await pasteNoticeClipboard({ ...options, saveNotice: async (...args) => {
      if (args[0] === 6) {
        if (throws) throw new Error('offline');
        return false;
      }
      return save(...args);
    } }), false);
    assert.equal(writes.some(row => row.content === ''), false);
  }
});

test('a partially failed overlapping move still retains all original selected values', async () => {
  for (const [indices, index, failedTarget] of [[[0, 1, 2], 1, 1], [[1, 2, 3], 0, 2]]) {
    const { notices, clipboard, writes, options } = makeBoard(['A', 'B', 'C', 'D'], indices);
    const save = options.saveNotice;
    assert.equal(await pasteNoticeClipboard({ ...options, index, saveNotice: async (...args) =>
      args[0] === failedTarget ? false : save(...args),
    }), false);
    for (const content of clipboard.values) assert.ok(notices.some(row => row.content === content));
    assert.equal(writes.some(row => row.content === ''), false);
  }
});

test('changed sources and cuts from a different month are not cleared', async () => {
  const { notices, writes, options } = makeBoard(['A', 'B'], [0, 1]);
  notices[1].content = 'newer edit';
  assert.equal(await pasteNoticeClipboard(options), true);
  assert.equal(notices[1].content, 'newer edit');
  assert.equal(writes.some(row => row.index === 1), false);
  const other = makeBoard(['A', 'B'], [0, 1]);
  assert.equal(await pasteNoticeClipboard({ ...other.options, month: 12 }), true);
  assert.equal(other.writes.some(row => row.index < 5), false);
});

test('a cut that will not fit in the month is rejected before writing any cell', async () => {
  const { writes, options } = makeBoard(['A', 'B'], [0, 1]);
  assert.equal(await pasteNoticeClipboard({ ...options, index: 99 }), false);
  assert.equal(writes.length, 0);
  assert.equal(await pasteNoticeClipboard({ ...options, index: -1 }), false);
  assert.equal(writes.length, 0);
});

test('external clipboard text uses its own rows and never clears a pending cut', async () => {
  const { notices, writes, options } = makeBoard(['A', 'B'], [0, 1]);
  assert.equal(await pasteNoticeClipboard({ ...options, text: 'external\nsecond\n' }), true);
  assert.deepEqual(writes.map(row => row.content), ['external', 'second']);
  assert.deepEqual(notices.slice(0, 2).map(row => row.content), ['A', 'B']);
});

test('a failed source clear is reported after destinations have safely received the whole range', async () => {
  const { notices, options } = makeBoard(['A', 'B'], [0, 1]);
  const save = options.saveNotice;
  assert.equal(await pasteNoticeClipboard({ ...options, saveNotice: async (...args) =>
    args[1] === '' ? false : save(...args),
  }), false);
  assert.equal(notices.find(row => row.slot_index === 5).content, 'A');
  assert.equal(notices.find(row => row.slot_index === 6).content, 'B');
});
