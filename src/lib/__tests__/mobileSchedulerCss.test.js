import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const mobileCssUrl = new URL('../../styles/mobile.css', import.meta.url);
const shockwaveCssUrl = new URL('../../styles/shockwave.css', import.meta.url);
const indexHtmlUrl = new URL('../../../index.html', import.meta.url);
const bottomNavUrl = new URL('../../components/layout/BottomNav.jsx', import.meta.url);
const layoutUrl = new URL('../../components/layout/Layout.jsx', import.meta.url);
const mobilePinchZoomHookUrl = new URL('../../hooks/useMobilePinchZoom.js', import.meta.url);
const scheduleCellUrl = new URL('../../components/shockwave/ShockwaveScheduleCell.jsx', import.meta.url);

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

  assert.match(
    mobileCss,
    /@media screen and \(max-width: 768px\),\s*screen and \(hover: none\) and \(pointer: coarse\) and \(orientation: landscape\)/
  );
  assert.match(mobileCss, /\.app-content\s*\{[^}]*padding:\s*0;/s);
  assert.match(mobileCss, /\.shockwave-view::-webkit-scrollbar\s*\{[^}]*display:\s*none;/s);
  assert.match(mobileCss, /\.staff-calendar::-webkit-scrollbar[\s\S]*display:\s*none;/);
  assert.match(
    mobileCss,
    /@media screen and \(hover: none\) and \(pointer: coarse\) and \(orientation: landscape\)[\s\S]*?\.app-content,\s*\.top-tabs-shell,\s*\.bottom-nav\s*\{[^}]*padding-right:\s*0;[^}]*padding-left:\s*0;/s
  );
});

test('mobile viewport allows native zoom-in and custom zoom-out while resize handles stay drag-specific', async () => {
  const [indexHtml, mobileCss, shockwaveCss, layout, mobilePinchZoomHook] = await Promise.all([
    readFile(indexHtmlUrl, 'utf8'),
    readFile(mobileCssUrl, 'utf8'),
    readFile(shockwaveCssUrl, 'utf8'),
    readFile(layoutUrl, 'utf8'),
    readFile(mobilePinchZoomHookUrl, 'utf8'),
  ]);

  assert.match(indexHtml, /maximum-scale=5\.0/);
  assert.match(indexHtml, /minimum-scale=0\.5/);
  assert.match(indexHtml, /user-scalable=yes/);
  assert.match(indexHtml, /viewport-fit=cover/);
  assert.match(mobileCss, /touch-action:\s*pan-x pan-y pinch-zoom/);
  assert.match(mobileCss, /zoom:\s*var\(--mobile-content-zoom\)/);
  assert.match(
    mobileCss,
    /\.app-content\[data-mobile-pinch-zoom\]\s*\{[^}]*width:\s*100% !important;/s
  );
  assert.match(layout, /useMobilePinchZoom\(contentRef\)/);
  assert.match(
    mobilePinchZoomHook,
    /addEventListener\('gesturechange',\s*handleGestureChange,\s*\{[^}]*passive:\s*false/s
  );
  assert.match(shockwaveCss, /\.sw-col-resize-handle\s*\{[^}]*touch-action:\s*none;/s);
  assert.match(shockwaveCss, /\.sw-day-resize-handle\s*\{[^}]*touch-action:\s*none;/s);
});

test('mobile schedule cell content keeps visible inner spacing', async () => {
  const shockwaveCss = await readFile(shockwaveCssUrl, 'utf8');

  assert.match(
    shockwaveCss,
    /@media \(max-width: 768px\)[\s\S]*?\.sw-cell-display\s*\{[^}]*padding:\s*1px 2px;/s
  );
  assert.match(shockwaveCss, /\.sw-cell-main\s*\{[^}]*max-height:\s*100%;/s);
});

test('mobile schedule cells preserve the desktop horizontal border calculation', async () => {
  const [shockwaveCss, scheduleCell] = await Promise.all([
    readFile(shockwaveCssUrl, 'utf8'),
    readFile(scheduleCellUrl, 'utf8'),
  ]);

  assert.doesNotMatch(
    shockwaveCss,
    /\.sw-cell\s*\{[^}]*border-bottom-color:\s*transparent\s*!important;/s
  );
  assert.doesNotMatch(shockwaveCss, /\.sw-schedule-body::before\s*\{/);
  assert.match(
    scheduleCell,
    /borderBottom:\s*isLastRenderedRow[\s\S]*shouldUseUniformFillBorder\s*\?\s*HORIZONTAL_BORDER_COLOR[\s\S]*cellBorderBottomColor/
  );
});

test('mobile bottom navigation uses compact icon-only tabs', async () => {
  const [mobileCss, bottomNav] = await Promise.all([
    readFile(mobileCssUrl, 'utf8'),
    readFile(bottomNavUrl, 'utf8'),
  ]);

  assert.match(
    mobileCss,
    /\.bottom-nav\s*\{[^}]*height:\s*calc\(32px \+ env\(safe-area-inset-bottom, 0px\)\);/s
  );
  assert.match(mobileCss, /\.bottom-nav-item\s*\{[^}]*min-height:\s*30px;/s);
  assert.match(mobileCss, /\.bottom-nav-item svg\s*\{[^}]*width:\s*18px;[^}]*height:\s*18px;/s);
  assert.match(bottomNav, /aria-label=\{item\.shortLabel \|\| item\.label\}/);
  assert.doesNotMatch(bottomNav, /<span>\{item\.shortLabel \|\| item\.label\}<\/span>/);
});
