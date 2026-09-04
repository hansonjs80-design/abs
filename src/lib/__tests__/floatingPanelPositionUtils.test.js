import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  getAnchoredFloatingPanelLayout,
  getBrowserViewport,
  getFloatingPanelViewportOffset,
} from '../floatingPanelPositionUtils.js';

test('keeps a floating submenu inside every viewport edge', () => {
  const viewport = { width: 1000, height: 700, offsetLeft: 0, offsetTop: 0 };

  assert.deepEqual(
    getFloatingPanelViewportOffset(
      { left: 850, right: 1050, top: 620, bottom: 820 },
      viewport,
      12,
    ),
    { x: -62, y: -132 },
  );
  assert.deepEqual(
    getFloatingPanelViewportOffset(
      { left: -30, right: 170, top: -20, bottom: 180 },
      viewport,
      12,
    ),
    { x: 42, y: 32 },
  );
});

test('uses visual viewport dimensions and offsets when they are available', () => {
  assert.deepEqual(
    getBrowserViewport({
      innerWidth: 1200,
      innerHeight: 800,
      visualViewport: {
        width: 900,
        height: 600,
        offsetLeft: 40,
        offsetTop: 25,
      },
    }),
    { width: 900, height: 600, offsetLeft: 40, offsetTop: 25 },
  );
});

test('places a wide submenu beside the context menu without overlapping it', () => {
  const viewport = { width: 1366, height: 768, offsetLeft: 0, offsetTop: 0 };

  assert.deepEqual(
    getAnchoredFloatingPanelLayout({
      panelRect: { width: 420 },
      anchorRect: { left: 800, right: 1024 },
      viewport,
      preferLeft: false,
    }),
    { openLeft: true, maxWidth: 784 },
  );

  assert.deepEqual(
    getAnchoredFloatingPanelLayout({
      panelRect: { width: 420 },
      anchorRect: { left: 12, right: 236 },
      viewport,
      preferLeft: true,
    }),
    { openLeft: false, maxWidth: 1114 },
  );
});

test('limits a body submenu to the larger free side when neither side fits', () => {
  assert.deepEqual(
    getAnchoredFloatingPanelLayout({
      panelRect: { width: 420 },
      anchorRect: { left: 160, right: 384 },
      viewport: { width: 520, height: 700, offsetLeft: 0, offsetTop: 0 },
      preferLeft: false,
    }),
    { openLeft: true, maxWidth: 144 },
  );
});

test('repositions an open context submenu whenever its rendered size changes', async () => {
  const [positioningHook, css] = await Promise.all([
    readFile(
      new URL('../../components/shockwave/useContextMenuPositioning.js', import.meta.url),
      'utf8',
    ),
    readFile(new URL('../../styles/shockwave.css', import.meta.url), 'utf8'),
  ]);

  assert.match(positioningHook, /useLayoutEffect\(\(\) => \{/);
  assert.match(positioningHook, /new window\.ResizeObserver/);
  assert.match(positioningHook, /resizeObserver\.observe\(submenu\)/);
  assert.match(positioningHook, /getAnchoredFloatingPanelLayout/);
  assert.match(positioningHook, /!menu\.classList\.contains\('standalone-mode'\)/);
  assert.match(
    css,
    /\.context-menu-submenu\s*\{[^}]*box-sizing:\s*border-box;/s,
  );
  assert.match(
    css,
    /\.context-menu-submenu--body\s*\{[^}]*--context-body-submenu-max-width/s,
  );
  assert.match(
    css,
    /\.context-menu-body-preset-label\s*\{[^}]*flex:\s*1 1 auto;[^}]*overflow:\s*hidden;/s,
  );
  assert.match(
    css,
    /\.context-menu-body-preset-directions\s*\{[^}]*flex:\s*0 0 auto;[^}]*margin-left:\s*auto;/s,
  );
});
