import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const shockwaveCssUrl = new URL('../../styles/shockwave.css', import.meta.url);

test('schedule editor keeps cell fills and uses white for cells without a fill', async () => {
  const shockwaveCss = await readFile(shockwaveCssUrl, 'utf8');

  assert.match(
    shockwaveCss,
    /\.sw-cell-input-wrapper\s*\{[^}]*background-color:\s*var\(--sw-cell-fill-color,\s*#fff\);[^}]*color:\s*inherit;/s
  );
  assert.match(
    shockwaveCss,
    /\.sw-cell-input\s*\{[^}]*color:\s*inherit;[^}]*-webkit-text-fill-color:\s*currentColor;[^}]*caret-color:\s*currentColor;/s
  );
  assert.match(
    shockwaveCss,
    /\.sw-cell-input-wrapper\.is-single-row\s*\{[^}]*height:\s*calc\(150% \+ 2px\);/s
  );
  assert.doesNotMatch(
    shockwaveCss,
    /\.sw-cell-input-wrapper\.is-single-row\s*\{[^}]*height:\s*calc\(200% \+ 2px\);/s
  );
  assert.match(
    shockwaveCss,
    /\.sw-cell\.other-month-bg\s*\{[^}]*background:\s*#f3f4f6;[^}]*color:\s*var\(--text-primary\);/s
  );
  assert.doesNotMatch(
    shockwaveCss,
    /\.sw-cell-input-wrapper\s*\{[^}]*background:\s*white;/s
  );
  assert.doesNotMatch(
    shockwaveCss,
    /\.sw-cell-input\s*\{[^}]*color:\s*#000;/s
  );
});
