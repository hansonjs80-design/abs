import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

const appUrl = new URL('../../App.jsx', import.meta.url);
const permissionsUrl = new URL('../authPermissions.js', import.meta.url);
const pageUrl = new URL('../../pages/ShinjangSprayStatsPage.jsx', import.meta.url);
const settingsPanelUrl = new URL('../../components/shockwave/ShinjangSpraySettingsPanel.jsx', import.meta.url);
const statsViewUrl = new URL('../../components/shockwave/ShinjangSprayStatsView.jsx', import.meta.url);
const sharedSettlementViewUrl = new URL('../../components/shockwave/ShockwaveSettlementView.jsx', import.meta.url);
const compactSettlementViewUrl = new URL('../../components/shockwave/ShockwaveSettlementHorizontalCompactView.jsx', import.meta.url);
const monthlyTherapistConfigUrl = new URL('../../components/shockwave/MonthlyTherapistConfig.jsx', import.meta.url);
const scheduleContextUrl = new URL('../../contexts/ScheduleContext.jsx', import.meta.url);
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
    const [pageSource, settingsSource, statsViewSource, settlementSource] = await Promise.all([
      readFile(pageUrl, 'utf8'),
      readFile(settingsPanelUrl, 'utf8'),
      readFile(statsViewUrl, 'utf8'),
      readFile(sharedSettlementViewUrl, 'utf8'),
    ]);
    assert.match(pageSource, /shockwave_patient_logs/);
    assert.match(pageSource, /manual_therapy_patient_logs/);
    assert.match(pageSource, /syncMonthShockwaveScheduleToStats/);
    assert.match(pageSource, /syncMonthManualTherapyScheduleToStats/);
    assert.match(pageSource, /mergeShinjangSprayLogs/);
    assert.match(pageSource, /shockwaveCryoPrescriptions/);
    assert.match(pageSource, /manualTherapyCryoPrescriptions/);
    assert.match(pageSource, /setMonthlyShinjangSpraySettings/);
    assert.match(pageSource, /renameSchedulePrescriptionsForMonth/);
    assert.match(pageSource, /restoreSchedulePrescriptionRenames/);
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
    assert.match(settingsSource, /셀 태그/);
    assert.match(settingsSource, /단축키/);
    assert.match(settingsSource, /치료시간/);
    assert.match(settingsSource, /회차 줄바꿈/);
    assert.match(settingsSource, /숨김/);
    assert.match(settingsSource, /prescriptionRenames/);
    assert.match(settingsSource, /removePrescription/);
    assert.match(settingsSource, /addPrescription/);
    assert.match(settingsSource, /cryoPrescriptions/);
    assert.match(settingsSource, /aria-label="신장분사 집계 치료사 설정"/);
    assert.match(settingsSource, /이번 달 설정 저장/);
    assert.match(statsViewSource, /treatmentLabel="신장분사"/);
    assert.match(statsViewSource, /incentivePercentages=\{incentivePercentages\}/);
    assert.match(statsViewSource, /cryoPrescriptions=\{cryoPrescriptions\}/);
    assert.match(statsViewSource, /viewModeStorageKey=\{SHINJANG_VIEW_MODE_STORAGE_KEY\}/);
    assert.match(statsViewSource, /showOnlyTherapistPrescriptions/);
    assert.match(settlementSource, /emptyTherapistPrescriptionLimit: showOnlyTherapistPrescriptions \? 0 : 3/);
    assert.match(settlementSource, /크라이오 반영 통계/);
    assert.match(settlementSource, /handleViewModeChange\('horizontal2', targetPricingMode\)/);
    assert.match(settlementSource, /handleViewModeChange\('vertical', targetPricingMode\)/);
    assert.match(settlementSource, /처방별 인센티브/);
  });

  it('shows only prescriptions actually completed by each therapist in compact settlement', async () => {
    const source = await readFile(compactSettlementViewUrl, 'utf8');
    assert.match(source, /const therapistPrescriptions = showOnlyTherapistPrescriptions/);
    assert.match(source, /item\.countsByPrescription\[prescription\]/);
    assert.match(source, /rowSpan=\{therapistPrescriptions\.length \+ 1\}/);
    assert.match(source, /therapistPrescriptions\.map/);
  });

  it('adds a monthly shinjang therapist tab and applies it to every shinjang statistics section', async () => {
    const [pageSource, configSource, contextSource] = await Promise.all([
      readFile(pageUrl, 'utf8'),
      readFile(monthlyTherapistConfigUrl, 'utf8'),
      readFile(scheduleContextUrl, 'utf8'),
    ]);

    assert.match(configSource, /activeTab === 'shinjang_spray'/);
    assert.match(configSource, />\s*신장분사 치료사\s*<\/button>/);
    assert.match(configSource, /monthlyShinjangSprayTherapists/);
    assert.match(configSource, /activeTab === 'shinjang_spray' \|\| !onSaveRoster/);
    assert.match(contextSource, /monthlyShinjangSprayTherapists/);
    assert.match(contextSource, /shinjang_spray: \{\}/);
    assert.match(pageSource, /loadMonthlyTherapists\(currentYear, currentMonth, 'shinjang_spray'\)/);
    assert.match(pageSource, /applyMonthlyShinjangSprayTherapists/);
    assert.match(pageSource, /rows=\{combinedRows\}/);
    assert.match(pageSource, /logs=\{combinedRows\}/);
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
