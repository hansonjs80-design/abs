import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseNoticePasteValues } from '../noticeClipboardUtils.js';

test('pastes consecutive notice rows without clearing another cell for a trailing newline', () => {
  assert.deepEqual(parseNoticePasteValues('첫째\n둘째\n', 4), ['첫째', '둘째']);
  assert.deepEqual(parseNoticePasteValues('첫째\n\n셋째', 2), ['첫째', '']);
  assert.deepEqual(parseNoticePasteValues('첫째\t다른 열\n둘째', 1), ['첫째']);
});
