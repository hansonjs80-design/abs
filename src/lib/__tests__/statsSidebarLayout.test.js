import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const layoutCssUrl = new URL('../../styles/shockwave_stats_layout.css', import.meta.url);
const mobileCssUrl = new URL('../../styles/mobile.css', import.meta.url);
const sidebarCssUrl = new URL('../../styles/shockwave_stats_sidebar.css', import.meta.url);
const shockwaveStatsUrl = new URL('../../components/shockwave/ShockwaveStatsView.jsx', import.meta.url);
const manualStatsUrl = new URL('../../pages/ManualTherapyStatsPage.jsx', import.meta.url);
const shinjangStatsUrl = new URL('../../pages/ShinjangSprayStatsPage.jsx', import.meta.url);

test('desktop stats sidebar is 20 percent narrower without changing button typography', async () => {
  const layoutCss = await readFile(layoutCssUrl, 'utf8');

  assert.match(layoutCss, /\.sw-stats-sidebar\s*\{[^}]*width:\s*96px;[^}]*flex:\s*0 0 96px;/s);
  assert.match(layoutCss, /\.sw-stats-side-tab\s*\{[^}]*font-size:\s*0\.9rem;/s);
});

test('mobile stats sidebar remains full width', async () => {
  const mobileCss = await readFile(mobileCssUrl, 'utf8');

  assert.match(mobileCss, /\.sw-stats-sidebar\s*\{[^}]*width:\s*100%;/s);
});

test('compact stats sidebar centers navigation and therapist filter labels', async () => {
  const sidebarCss = await readFile(sidebarCssUrl, 'utf8');

  assert.match(sidebarCss, /\.sw-stats-sidebar--compact \.sw-stats-side-tab\s*\{[\s\S]*?text-align:\s*center;/);
  assert.match(sidebarCss, /\.sw-stats-sidebar--compact \.sw-sidebar-filter-title\s*\{[\s\S]*?text-align:\s*center;/);
  assert.match(sidebarCss, /\.sw-stats-sidebar--compact \.sw-sidebar-filter-chip\s*\{[\s\S]*?justify-content:\s*center;/);
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

test('stats therapist filters wait for the current monthly roster before rendering names', async () => {
  const [shockwaveStats, manualStats] = await Promise.all([
    readFile(shockwaveStatsUrl, 'utf8'),
    readFile(manualStatsUrl, 'utf8'),
  ]);

  for (const source of [shockwaveStats, manualStats]) {
    assert.match(
      source,
      /\(\) => \(monthlyTherapistsReady \? safeTherapists : \[\]\)/
    );
  }
});

test('shinjang publishes the monthly roster before log sync and excludes previous-month data', async () => {
  const source = await readFile(shinjangStatsUrl, 'utf8');
  const publishRoster = source.indexOf('setLoadedTherapistsMonthKey(currentMonthKey)');
  const syncLogs = source.indexOf('syncMonthShockwaveScheduleToStats({');
  assert(publishRoster >= 0 && publishRoster < syncLogs);
  assert.match(source, /loadedMonthKey: loadedTherapistsMonthKey/);
  assert.match(source, /loadedTherapistsMonthKey !== currentMonthKey \|\| loadedLogsMonthKey !== currentMonthKey/);
  assert(source.indexOf('setLoadedLogsMonthKey(currentMonthKey)') > source.indexOf('setManualLogs(normalizedManualLogs)'));
  assert.match(source, /shockwaveTherapists: localShockwaveTherapists,/);
  assert.match(source, /manualTherapists: localManualTherapists,/);
  assert.match(source, /return \(\) => \{ requestIdRef\.current \+= 1; \};/);
});
