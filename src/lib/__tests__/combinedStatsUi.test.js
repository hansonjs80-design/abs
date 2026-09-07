import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

const appUrl = new URL('../../App.jsx', import.meta.url);
const permissionUrl = new URL('../authPermissions.js', import.meta.url);
const pageUrl = new URL('../../pages/CombinedStatsPage.jsx', import.meta.url);
const topTabsUrl = new URL('../../components/layout/TopTabs.jsx', import.meta.url);
const styleUrl = new URL('../../styles/combined_stats.css', import.meta.url);

describe('combined statistics UI', () => {
  it('registers the combined tab immediately after manual therapy statistics', async () => {
    const [appSource, permissionSource] = await Promise.all([
      readFile(appUrl, 'utf8'),
      readFile(permissionUrl, 'utf8'),
    ]);

    assert.match(appSource, /path="\/combined-stats"/);
    assert.match(permissionSource, /key: 'combined_stats'/);
    assert.ok(
      permissionSource.indexOf("key: 'manual_therapy_stats'")
        < permissionSource.indexOf("key: 'combined_stats'")
    );
    assert.ok(
      permissionSource.indexOf("key: 'combined_stats'")
        < permissionSource.indexOf("key: 'pt_stats'")
    );
  });

  it('shows count, cryo-adjusted settlement, incentive, and recent period totals', async () => {
    const pageSource = await readFile(pageUrl, 'utf8');

    assert.match(pageSource, /충격파 · 신장분사 · 도수치료의 크라이오 반영 결산/);
    assert.match(pageSource, /<th>총건수<\/th>/);
    assert.match(pageSource, /<th>처방별 총 결산 금액<\/th>/);
    assert.match(pageSource, /<th>처방별 총 인센티브<\/th>/);
    assert.match(pageSource, /<th>인센<\/th>/);
    assert.match(pageSource, /<IncentiveRateList rates=\{item\.incentiveRates\?\.\[treatment\.key\]\} \/>/);
    assert.match(pageSource, /<tr className="combined-therapist-total">\s*<th>합계<\/th>/);
    assert.match(pageSource, /const visibleTreatments = COMBINED_STATS_TREATMENTS\.filter/);
    assert.match(pageSource, /visibleTreatments\.length > 0/);
    assert.match(pageSource, /className="combined-therapist-header-count"/);
    assert.match(pageSource, /\{formatCount\(item\.total\.count\)\}/);
    assert.match(pageSource, /<ManualTherapySixMonthIonTreatment/);
    assert.match(pageSource, /onSave=\{handleSaveIonTreatment\}/);
    assert.match(pageSource, /setManualTherapyIonTreatment/);
    assert.match(pageSource, /recentPeriodInput/);
    assert.match(pageSource, /일반 계정에서는 신장분사 인센티브 15% 처방이 결산에서 제외/);
  });

  it('removes decorative icons from the desktop top tabs', async () => {
    const source = await readFile(topTabsUrl, 'utf8');
    assert.doesNotMatch(source, /const Icon = item\.icon/);
    assert.doesNotMatch(source, /<Icon size=\{18\}/);
  });

  it('uses current-month-first loading and compact screen and print table geometry', async () => {
    const [pageSource, styleSource] = await Promise.all([
      readFile(pageUrl, 'utf8'),
      readFile(styleUrl, 'utf8'),
    ]);

    assert.match(pageSource, /loadStatsMonthsCurrentFirst/);
    assert.match(pageSource, /onCurrentLoaded:\s*\(summary\)/);
    assert.match(pageSource, /className="combined-current-col-type"/);
    assert.match(pageSource, /className="combined-recent-col-month"/);
    assert.match(styleSource, /\.combined-current-col-type\s*\{\s*width:\s*15\.95%;/s);
    assert.match(styleSource, /\.combined-current-col-count\s*\{\s*width:\s*11\.39%;/s);
    assert.match(styleSource, /\.combined-current-col-rate\s*\{\s*width:\s*9\.1%;/s);
    assert.match(styleSource, /\.combined-recent-col-month\s*\{\s*width:\s*23\.94%;/s);
    assert.match(styleSource, /\.combined-recent-col-count\s*\{\s*width:\s*19\.72%;/s);
    assert.match(styleSource, /font-size:\s*calc\(0\.95rem \+ 2px\);/);
    assert.match(styleSource, /\.combined-therapist-card\s*\{\s*border-top:\s*3px solid var\(--combined-tone-strong\);/s);
    assert.match(styleSource, /border-right:\s*1px solid #cbd5e1;/);
    assert.match(styleSource, /\.combined-stats-recent\s*\{[\s\S]*border-top:\s*3px solid #0891b2;/);
    assert.match(styleSource, /\.combined-stats-side \.sw-manual-ion-summary-card/);
    assert.match(styleSource, /@media print\s*\{[\s\S]*height:\s*36\.5px !important;[\s\S]*font-size:\s*calc\(0\.95rem \+ 2px\) !important;/);
  });
});
