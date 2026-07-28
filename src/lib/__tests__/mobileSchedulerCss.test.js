import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const mobileCssUrl = new URL('../../styles/mobile.css', import.meta.url);
const shockwaveCssUrl = new URL('../../styles/shockwave.css', import.meta.url);
const indexHtmlUrl = new URL('../../../index.html', import.meta.url);

test('mobile tables keep device typography and size variables authoritative', async () => {
  const [mobileCss, shockwaveCss] = await Promise.all([
    readFile(mobileCssUrl, 'utf8'),
    readFile(shockwaveCssUrl, 'utf8'),
  ]);

  assert.match(mobileCss, /font-size:\s*var\(--staff-calendar-date-font-size\)/);
  assert.match(mobileCss, /font-size:\s*var\(--staff-calendar-weekday-font-size\)/);
  assert.match(mobileCss, /font-size:\s*var\(--staff-calendar-memo-font-size\)/);
  assert.match(mobileCss, /font-size:\s*var\(--sw-cell-font-size\)/);
  assert.match(mobileCss, /font-size:\s*var\(--sw-header-font-size\)/);
  assert.match(mobileCss, /font-size:\s*var\(--sw-therapist-font-size\)/);
  assert.match(mobileCss, /var\(--sw-mobile-day-width\)/);

  assert.doesNotMatch(
    mobileCss,
    /clamp\([^;]*var\(--(?:staff-calendar|sw-)[^;]+font-size/
  );
  assert.doesNotMatch(shockwaveCss, /min\(11px,\s*var\(--sw-cell-font-size\)\)/);
});

test('mobile table viewport removes outer padding and visible scrollbars', async () => {
  const mobileCss = await readFile(mobileCssUrl, 'utf8');

  assert.match(mobileCss, /\.app-content\s*\{[^}]*padding:\s*0;/s);
  assert.match(mobileCss, /\.shockwave-view::-webkit-scrollbar\s*\{[^}]*display:\s*none;/s);
  assert.match(mobileCss, /\.staff-calendar::-webkit-scrollbar[\s\S]*display:\s*none;/);
});

test('mobile viewport allows pinch zoom while table resize handles stay drag-specific', async () => {
  const [indexHtml, mobileCss, shockwaveCss] = await Promise.all([
    readFile(indexHtmlUrl, 'utf8'),
    readFile(mobileCssUrl, 'utf8'),
    readFile(shockwaveCssUrl, 'utf8'),
  ]);

  assert.match(indexHtml, /maximum-scale=5\.0/);
  assert.match(indexHtml, /user-scalable=yes/);
  assert.match(mobileCss, /touch-action:\s*pan-x pan-y pinch-zoom/);
  assert.match(shockwaveCss, /\.sw-col-resize-handle\s*\{[^}]*touch-action:\s*none;/s);
  assert.match(shockwaveCss, /\.sw-day-resize-handle\s*\{[^}]*touch-action:\s*none;/s);
});
