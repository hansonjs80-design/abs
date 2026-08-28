import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const viewUrl = new URL('../../components/shockwave/ShockwaveView.jsx', import.meta.url);
const viewStateUrl = new URL('../../components/shockwave/useScheduleViewState.js', import.meta.url);

test('schedule memo panel header shows the current platform shortcut on the right', async () => {
  const [view, viewState] = await Promise.all([
    readFile(viewUrl, 'utf8'),
    readFile(viewStateUrl, 'utf8'),
  ]);

  assert.match(viewState, /memo:\s*formatScheduleShortcutLabel\('\+', mod\)/);
  assert.match(
    view,
    /메모 목록[\s\S]*className="context-menu-shortcut"[^>]*>\{shortcutLabels\.memo\}<\/span>/,
  );
});
