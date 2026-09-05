import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

const appUrl = new URL('../../App.jsx', import.meta.url);
const permissionsUrl = new URL('../authPermissions.js', import.meta.url);
const pageUrl = new URL('../../pages/ShinjangSprayStatsPage.jsx', import.meta.url);
const settingsPanelUrl = new URL('../../components/shockwave/ShinjangSpraySettingsPanel.jsx', import.meta.url);

describe('shinjang spray statistics UI', () => {
  it('registers the top-level route and permission tab', async () => {
    const [appSource, permissionSource] = await Promise.all([
      readFile(appUrl, 'utf8'),
      readFile(permissionsUrl, 'utf8'),
    ]);
    assert.match(appSource, /path="\/shinjang-spray-stats"/);
    assert.match(permissionSource, /key: 'shinjang_spray_stats'/);
    assert.match(permissionSource, /label: '신장분사 통계'/);
  });

  it('combines shockwave and manual logs and exposes per-prescription incentive settings', async () => {
    const [pageSource, settingsSource] = await Promise.all([
      readFile(pageUrl, 'utf8'),
      readFile(settingsPanelUrl, 'utf8'),
    ]);
    assert.match(pageSource, /shockwave_patient_logs/);
    assert.match(pageSource, /manual_therapy_patient_logs/);
    assert.match(pageSource, /mergeShinjangSprayLogs/);
    assert.match(pageSource, /setMonthlyShinjangSpraySettings/);
    assert.match(settingsSource, /인센티브율/);
    assert.match(settingsSource, /이번 달 설정 저장/);
  });
});
