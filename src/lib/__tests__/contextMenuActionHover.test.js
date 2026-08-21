import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const cssUrl = new URL('../../styles/shockwave.css', import.meta.url);

test('schedule context menu white action rows use a stronger scoped hover background', async () => {
  const css = await readFile(cssUrl, 'utf8');
  const actionHoverRule = css.match(
    /\.shockwave-context-menu\.schedule-context-menu > \.context-menu-item:hover:not\(:disabled\),[^{]*\{([^}]*)\}/s
  )?.[1] || '';
  const metaHoverRule = css.match(
    /\.context-menu-meta-section \.context-menu-meta-item:hover:not\(:disabled\),[^{]*\{([^}]*)\}/s
  )?.[1] || '';

  assert.match(actionHoverRule, /background:\s*rgba\(37, 99, 235, 0\.14\)\s*!important;/);
  assert.match(metaHoverRule, /background:\s*rgba\(37, 99, 235, 0\.08\)\s*!important;/);
});
