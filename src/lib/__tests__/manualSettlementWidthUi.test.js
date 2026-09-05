import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

const pageUrl = new URL('../../pages/ManualTherapyStatsPage.jsx', import.meta.url);
const stylesUrl = new URL('../../styles/shockwave_stats_refinements.css', import.meta.url);

describe('manual therapy settlement readable width', () => {
  it('uses a dedicated wide layout and a label column that fits long breakdown labels', async () => {
    const [pageSource, styles] = await Promise.all([
      readFile(pageUrl, 'utf8'),
      readFile(stylesUrl, 'utf8'),
    ]);

    assert.match(pageSource, /sw-manual-settlement-container--readable/);
    assert.match(styles, /\.sw-manual-settlement-container--readable\s*\{/);
    assert.match(styles, /grid-template-columns: minmax\(760px, 1\.9fr\)/);
    assert.match(styles, /min-width: 820px/);
    assert.match(styles, /min-width: 230px/);
    assert.match(styles, /overflow: visible/);
  });
});
