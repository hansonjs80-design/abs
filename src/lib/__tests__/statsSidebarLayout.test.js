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

test('compact stats sidebar gives every navigation tab a distinct pastel treatment color', async () => {
  const sidebarCss = await readFile(sidebarCssUrl, 'utf8');

  assert.match(sidebarCss, /\.sw-stats-sidebar--compact \.sw-stats-side-tab\s*\{[\s\S]*?--tab-surface:\s*#e0efff;[\s\S]*?--tab-border:\s*#93c5fd;[\s\S]*?background:\s*var\(--tab-surface\);/);
  assert.match(sidebarCss, /\.sw-stats-container--manual[\s\S]*?--tab-surface:\s*#ffeadb;[\s\S]*?--tab-border:\s*#f3b276;/);
  assert.match(sidebarCss, /\.sw-stats-container--shinjang[\s\S]*?--tab-surface:\s*#ddf5e4;[\s\S]*?--tab-border:\s*#86c89a;/);
  assert.match(sidebarCss, /\.sw-stats-sidebar--compact \.sw-stats-side-tab--new-patients\s*\{[\s\S]*?--tab-surface:\s*#eee7ff;[\s\S]*?--tab-border:\s*#c4b5fd;/);
});

test('compact stats sidebar fills the selected tab with its former dark border color', async () => {
  const sidebarCss = await readFile(sidebarCssUrl, 'utf8');

  assert.match(
    sidebarCss,
    /\.sw-stats-layout--compact \.sw-stats-sidebar--compact \.sw-stats-side-tab\.active\s*\{[\s\S]*?background:\s*var\(--tab-active-surface\);[\s\S]*?color:\s*#fff;[\s\S]*?border:\s*2px solid var\(--tab-active-surface\);/
  );
  assert.match(sidebarCss, /--tab-active-surface:\s*#1e40af;/);
  assert.doesNotMatch(sidebarCss, /\.sw-stats-side-tab\.active::before/);
});

test('compact stats sidebar gives therapist filter chips distinct color coding', async () => {
  const sidebarCss = await readFile(sidebarCssUrl, 'utf8');

  assert.match(sidebarCss, /\.sw-sidebar-filter-chip\.tone-0\s*\{\s*--filter-surface:\s*#e7f0ff;[\s\S]*?--filter-accent:\s*#2563b7;/);
  assert.match(sidebarCss, /\.sw-sidebar-filter-chip\.tone-1\s*\{\s*--filter-surface:\s*#f0e9ff;[\s\S]*?--filter-accent:\s*#7042c1;/);
  assert.match(sidebarCss, /\.sw-sidebar-filter-chip\.tone-2\s*\{\s*--filter-surface:\s*#e6f7ec;[\s\S]*?--filter-accent:\s*#237841;/);
  assert.match(sidebarCss, /\.sw-sidebar-filter-chip\.tone-3\s*\{\s*--filter-surface:\s*#fff0df;[\s\S]*?--filter-accent:\s*#a8510b;/);
  assert.match(sidebarCss, /\.sw-sidebar-filter-chip\.tone-4\s*\{\s*--filter-surface:\s*#ffe8f0;[\s\S]*?--filter-accent:\s*#b33d68;/);
  assert.match(sidebarCss, /\.sw-sidebar-filter-chip\.is-active\s*\{[\s\S]*?border-color:\s*var\(--filter-accent\);[\s\S]*?box-shadow:\s*none;/);
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
