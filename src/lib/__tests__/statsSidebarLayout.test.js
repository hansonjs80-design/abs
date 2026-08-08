import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const layoutCssUrl = new URL('../../styles/shockwave_stats_layout.css', import.meta.url);
const mobileCssUrl = new URL('../../styles/mobile.css', import.meta.url);
const shockwaveStatsUrl = new URL('../../components/shockwave/ShockwaveStatsView.jsx', import.meta.url);
const manualStatsUrl = new URL('../../pages/ManualTherapyStatsPage.jsx', import.meta.url);

test('desktop stats sidebar is 20 percent narrower without changing button typography', async () => {
  const layoutCss = await readFile(layoutCssUrl, 'utf8');

  assert.match(layoutCss, /\.sw-stats-sidebar\s*\{[^}]*width:\s*96px;[^}]*flex:\s*0 0 96px;/s);
  assert.match(layoutCss, /\.sw-stats-side-tab\s*\{[^}]*font-size:\s*0\.9rem;/s);
});

test('mobile stats sidebar remains full width', async () => {
  const mobileCss = await readFile(mobileCssUrl, 'utf8');

  assert.match(mobileCss, /\.sw-stats-sidebar\s*\{[^}]*width:\s*100%;/s);
});

test('both stats refresh buttons use the shorter label', async () => {
  const [shockwaveStats, manualStats] = await Promise.all([
    readFile(shockwaveStatsUrl, 'utf8'),
    readFile(manualStatsUrl, 'utf8'),
  ]);

  for (const source of [shockwaveStats, manualStats]) {
    assert.match(source, /'새로 고침 중\.\.\.'\s*:\s*'새로 고침'/);
    assert.doesNotMatch(source, /'데이터 새로고침'/);
  }
});
