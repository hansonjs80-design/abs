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
    assert.match(pageSource, /충격파 · 신장분사의 크라이오 반영 결산/);
    assert.match(pageSource, /<th>총건수<\/th>/);
    assert.match(pageSource, /<th>처방별 총 결산 금액<\/th>/);
    assert.match(pageSource, /<th>처방별 총 인센티브<\/th>/);
    assert.match(pageSource, /<th>인센<\/th>/);
    assert.match(pageSource, /<IncentiveRateList rates=\{row\.rates\} \/>/);
    assert.match(pageSource, /<tr className="combined-therapist-total">\s*<th>합계<\/th>/);
    assert.match(pageSource, /const visibleTreatments = buildTherapistTreatmentSections\(item\)/);
    assert.match(pageSource, /visibleTreatments\.length > 0/);
    assert.match(pageSource, /rowSpan=\{treatment\.rows\.length\}/);
    assert.match(pageSource, /metric="count"\s*includeManual=\{isAdmin\}/);
    assert.match(pageSource, /metric="amount"\s*includeManual=\{isAdmin\}/);
    assert.match(pageSource, /metric="incentive"\s*includeManual=\{isAdmin\}/);
    assert.doesNotMatch(pageSource, /combined-recent-total/);
    assert.match(pageSource, /className="combined-therapist-header-count"/);
    assert.match(pageSource, /\{formatCount\(item\.total\.count\)\}/);
    assert.match(pageSource, /className="combined-therapist-card combined-therapist-summary-card"/);
    assert.match(pageSource, /<span>치료사별 합계<\/span>/);
    assert.match(pageSource, /<th>전체 합계<\/th>/);
    assert.match(pageSource, /\{formatCurrency\(currentSummary\.total\.incentive\)\}/);
    assert.doesNotMatch(pageSource, /ManualTherapySixMonthIonTreatment/);
    assert.doesNotMatch(pageSource, /setManualTherapyIonTreatment/);
    assert.match(pageSource, /recentPeriodInput/);
    assert.match(pageSource, /includeManual \? \[\{/);
    assert.match(pageSource, /return\s*\[\s*\{\s*key:\s*'total'[\s\S]*?key:\s*'shockwave'/);
    assert.doesNotMatch(pageSource, /결산에서 제외됩니다/);
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
    assert.match(pageSource, /className="combined-therapist-amount-cell"/);
    assert.match(pageSource, /className="combined-therapist-incentive-cell"/);
    assert.match(styleSource, /\.combined-therapist-card tbody td\.combined-therapist-amount-cell\s*\{[\s\S]*color:\s*#075fc5;/);
    assert.match(styleSource, /\.combined-therapist-card tbody td\.combined-therapist-incentive-cell\s*\{[\s\S]*color:\s*#7c3aed;/);
    assert.match(styleSource, /\.combined-therapist-card table\s*\{[\s\S]*table-layout:\s*auto;/);
    assert.match(styleSource, /\.combined-current-col-type,[\s\S]*width:\s*auto;/);
    assert.match(styleSource, /\.combined-therapist-card th,[\s\S]*white-space:\s*nowrap;/);
    assert.match(styleSource, /\.combined-therapist-summary-card\s*\{[\s\S]*--combined-tone-strong:\s*#475569;/);
    assert.match(styleSource, /\.combined-recent-col-month,[\s\S]*width:\s*auto;/);
    assert.match(styleSource, /\.combined-summary-amount-cell,[\s\S]*font-size:\s*calc\(1\.05rem \+ 2px\) !important;/);
    assert.match(styleSource, /\.combined-summary-grand-total > th\s*\{[\s\S]*font-size:\s*calc\(1\.05rem \+ 3px\) !important;/);
    assert.match(styleSource, /\.combined-summary-grand-total > td,[\s\S]*font-size:\s*calc\(1\.05rem \+ 3px\) !important;/);
    assert.match(styleSource, /font-size:\s*calc\(0\.95rem \+ 2px\);/);
    assert.match(styleSource, /\.combined-therapist-card\s*\{\s*border-top:\s*3px solid var\(--combined-tone-strong\);/s);
    assert.match(styleSource, /border-right:\s*1px solid #cbd5e1;/);
    assert.match(styleSource, /\.combined-stats-recent\s*\{[\s\S]*border-top:\s*3px solid #0891b2;/);
    assert.doesNotMatch(styleSource, /\.combined-stats-side \.sw-manual-ion-summary-card/);
    assert.match(styleSource, /\.combined-recent-breakdown-item--shinjang/);
    assert.match(styleSource, /\.combined-recent-breakdown-item--total\s*\{[\s\S]*border-bottom:\s*2px solid #94a3b8;/);
    assert.match(styleSource, /@media print\s*\{[\s\S]*height:\s*36\.5px !important;[\s\S]*font-size:\s*calc\(0\.95rem \+ 2px\) !important;/);
  });
});
