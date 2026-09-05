import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

const appUrl = new URL('../../App.jsx', import.meta.url);
const permissionsUrl = new URL('../authPermissions.js', import.meta.url);
const pageUrl = new URL('../../pages/ShinjangSprayStatsPage.jsx', import.meta.url);
const settingsPanelUrl = new URL('../../components/shockwave/ShinjangSpraySettingsPanel.jsx', import.meta.url);
const statsViewUrl = new URL('../../components/shockwave/ShinjangSprayStatsView.jsx', import.meta.url);
const loginSettingsUrl = new URL('../../components/settings/LoginSettings.jsx', import.meta.url);
const shockwaveStatsViewUrl = new URL('../../components/shockwave/ShockwaveStatsView.jsx', import.meta.url);

describe('shinjang spray statistics UI', () => {
  it('registers the top-level route and permission tab', async () => {
    const [appSource, permissionSource, loginSettingsSource] = await Promise.all([
      readFile(appUrl, 'utf8'),
      readFile(permissionsUrl, 'utf8'),
      readFile(loginSettingsUrl, 'utf8'),
    ]);
    assert.match(appSource, /path="\/shinjang-spray-stats"/);
    assert.match(permissionSource, /key: 'shinjang_spray_stats'/);
    assert.match(permissionSource, /label: '신장분사 통계'/);
    assert.match(loginSettingsSource, /APP_TABS\.map\(\(tab\) =>/);
    assert.match(loginSettingsSource, /toggleAppUserPermission\(row\.id, tab\.key\)/);
  });

  it('combines shockwave and manual logs and exposes per-prescription incentive settings', async () => {
    const [pageSource, settingsSource, statsViewSource] = await Promise.all([
      readFile(pageUrl, 'utf8'),
      readFile(settingsPanelUrl, 'utf8'),
      readFile(statsViewUrl, 'utf8'),
    ]);
    assert.match(pageSource, /shockwave_patient_logs/);
    assert.match(pageSource, /manual_therapy_patient_logs/);
    assert.match(pageSource, /syncMonthShockwaveScheduleToStats/);
    assert.match(pageSource, /syncMonthManualTherapyScheduleToStats/);
    assert.match(pageSource, /mergeShinjangSprayLogs/);
    assert.match(pageSource, /shockwaveCryoPrescriptions/);
    assert.match(pageSource, /manualTherapyCryoPrescriptions/);
    assert.match(pageSource, /setMonthlyShinjangSpraySettings/);
    assert.match(pageSource, /신장분사 현황/);
    assert.match(pageSource, /신장분사 결산/);
    assert.match(pageSource, /activeSection === 'new-patients'/);
    assert.match(pageSource, /<ShockwaveNewPatientsView/);
    assert.match(pageSource, /<ShockwaveDataGrid/);
    assert.match(pageSource, /aria-label="치료사 필터"/);
    assert.match(settingsSource, /인센티브율/);
    assert.match(settingsSource, /집계 치료사/);
    assert.match(settingsSource, /크라이오 가격/);
    assert.match(settingsSource, /처방 단가/);
    assert.match(settingsSource, /removePrescription/);
    assert.match(settingsSource, /addPrescription/);
    assert.match(settingsSource, /cryoPrescriptions/);
    assert.match(settingsSource, /aria-label="신장분사 집계 치료사 설정"/);
    assert.match(settingsSource, /이번 달 설정 저장/);
    assert.match(statsViewSource, /크라이오 반영 통계/);
    assert.match(statsViewSource, /isCryoAdjusted/);
    assert.match(statsViewSource, /크라이오 차감/);
  });

  it('keeps shinjang marker rows out of the regular shockwave statistics UI', async () => {
    const source = await readFile(shockwaveStatsViewUrl, 'utf8');
    assert.match(source, /isShinjangSprayPrescription/);
    assert.match(source, /visibleShockwaveLogs/);
    assert.match(source, /!isShinjangSprayPrescription\(log\?\.prescription\)/);
  });

  it('synchronizes both source statistics before reading their monthly logs', async () => {
    const pageSource = await readFile(pageUrl, 'utf8');
    const shockwaveSyncIndex = pageSource.indexOf('syncMonthShockwaveScheduleToStats({');
    const manualSyncIndex = pageSource.indexOf('syncMonthManualTherapyScheduleToStats({');
    const shockwaveQueryIndex = pageSource.lastIndexOf("buildMonthQuery('shockwave_patient_logs'");
    const manualQueryIndex = pageSource.lastIndexOf("buildMonthQuery('manual_therapy_patient_logs'");

    assert(shockwaveSyncIndex >= 0 && shockwaveSyncIndex < shockwaveQueryIndex);
    assert(manualSyncIndex >= 0 && manualSyncIndex < manualQueryIndex);
  });
});
