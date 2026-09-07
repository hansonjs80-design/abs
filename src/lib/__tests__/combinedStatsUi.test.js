import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

const appUrl = new URL('../../App.jsx', import.meta.url);
const permissionUrl = new URL('../authPermissions.js', import.meta.url);
const pageUrl = new URL('../../pages/CombinedStatsPage.jsx', import.meta.url);
const topTabsUrl = new URL('../../components/layout/TopTabs.jsx', import.meta.url);

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
    assert.match(pageSource, /recentPeriodInput/);
    assert.match(pageSource, /일반 계정에서는 신장분사 인센티브 15% 처방이 결산에서 제외/);
  });

  it('removes decorative icons from the desktop top tabs', async () => {
    const source = await readFile(topTabsUrl, 'utf8');
    assert.doesNotMatch(source, /const Icon = item\.icon/);
    assert.doesNotMatch(source, /<Icon size=\{18\}/);
  });
});
