import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { isWindowsPlatform } from '../platformUtils.js';

const shockwaveCssUrl = new URL('../../styles/shockwave.css', import.meta.url);

test('detects Windows without classifying Mac or Linux as Windows', () => {
  assert.equal(isWindowsPlatform({
    userAgentData: { platform: 'Windows' },
    platform: 'Win32',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  }), true);
  assert.equal(isWindowsPlatform({
    platform: 'MacIntel',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
  }), false);
  assert.equal(isWindowsPlatform({
    platform: 'Linux x86_64',
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
  }), false);
});

test('uses a Windows-only stronger hover for plain current-month cells', async () => {
  const shockwaveCss = await readFile(shockwaveCssUrl, 'utf8');

  assert.match(
    shockwaveCss,
    /html\.platform-windows:not\(\[data-theme="dark"\]\)[\s\S]*?\.sw-cell\.current-month-cell[\s\S]*?:hover\s*\{[^}]*rgba\(15,\s*23,\s*42,\s*0\.08\)/s
  );
  assert.match(
    shockwaveCss,
    /\.sw-cell\.current-month-cell:not\(\.selected\):not\(\.primary-selected\):not\(\.editing\):hover\s*\{[^}]*rgba\(15,\s*23,\s*42,\s*0\.04\)/s
  );
});
