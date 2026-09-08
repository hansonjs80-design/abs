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
const scheduleViewUrl = new URL('../../components/shockwave/ShockwaveContextMenu.jsx', import.meta.url);
const scheduleCellUrl = new URL('../../components/shockwave/ShockwaveScheduleCell.jsx', import.meta.url);
const scheduleViewStateUrl = new URL('../../components/shockwave/useScheduleViewState.js', import.meta.url);
const scheduleCssUrl = new URL('../../styles/shockwave.css', import.meta.url);
const statsCssUrl = new URL('../../styles/shockwave_stats.css', import.meta.url);
const horizontal2CssUrl = new URL('../../styles/shockwave_settlement_horizontal2.css', import.meta.url);

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
    assert(
      permissionSource.indexOf("key: 'shockwave_stats'")
        < permissionSource.indexOf("key: 'shinjang_spray_stats'")
    );
    assert(
      permissionSource.indexOf("key: 'shinjang_spray_stats'")
        < permissionSource.indexOf("key: 'manual_therapy_stats'")
    );
  });

  it('orders scheduler prescription selectors as shockwave, shinjang, then manual therapy', async () => {
    const source = await readFile(scheduleViewUrl, 'utf8');
    const shockwaveIndex = source.indexOf('ariaLabel="충격파 처방 선택"');
    const shinjangIndex = source.indexOf('ariaLabel="신장분사 처방 선택"');
    const manualIndex = source.indexOf('ariaLabel="도수치료 처방 선택"');

    assert(shockwaveIndex >= 0 && shockwaveIndex < shinjangIndex);
    assert(shinjangIndex < manualIndex);
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
    assert.match(pageSource, /showOnlyTherapistPrescriptions/);
    assert.match(pageSource, /aria-label="치료사 필터"/);
    assert.match(settingsSource, /인센티브율/);
    assert.doesNotMatch(settingsSource, />배경색</);
    assert.doesNotMatch(settingsSource, /prescriptionBackgroundColors/);
    assert.match(settingsSource, />\/ 강조</);
    assert.match(settingsSource, />\/ 색</);
    assert.match(settingsSource, />\/ 두께</);
    assert.doesNotMatch(settingsSource, /집계 치료사|draftTherapistNames|therapist_names/);
    assert.doesNotMatch(pageSource, /spraySettings\.therapist_names/);
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
    assert.match(settingsSource, /이번 달 설정 저장/);
    assert.match(statsViewSource, /treatmentLabel="신장분사"/);
    assert.match(statsViewSource, /incentivePercentages=\{incentivePercentages\}/);
    assert.match(pageSource, /hiddenIncentivePercentages=\{canManageSettings \? \[\] : \[15\]\}/);
    assert.equal((pageSource.match(/hiddenIncentivePercentages=/g) || []).length, 1);
    assert.match(statsViewSource, /hiddenIncentivePercentages=\{hiddenIncentivePercentages\}/);
    assert.match(settlementSource, /filterVisibleSettlementPrescriptions/);
    assert.match(statsViewSource, /cryoPrescriptions=\{cryoPrescriptions\}/);
    assert.match(statsViewSource, /viewModeStorageKey=\{SHINJANG_VIEW_MODE_STORAGE_KEY\}/);
    assert.match(statsViewSource, /showOnlyTherapistPrescriptions/);
    assert.match(pageSource, /buildShinjangSprayRecentMonthlySummaries/);
    assert.match(pageSource, /getRecentScheduleMonthTargets/);
    assert.match(pageSource, /recentMonthlySummaries=\{recentMonthlySummaries\}/);
    assert.match(statsViewSource, /recentMonthlySummaries=\{recentMonthlySummaries\}/);
    assert.match(statsViewSource, /recentPeriodInput=\{recentPeriodInput\}/);
    assert.doesNotMatch(statsViewSource, /showRecentSummaries=\{false\}/);
    assert.match(settlementSource, /buildTherapistCompletedPrescriptionGroups/);
    assert.match(settlementSource, /getTherapistCompletedPrescriptions/);
    assert.match(settlementSource, /displayedTherapistSummaries/);
    assert.match(settlementSource, /preserveEmptyColumn: true/);
    assert.match(settlementSource, /크라이오 반영 통계/);
    assert.match(settlementSource, /handleViewModeChange\('horizontal2', targetPricingMode\)/);
    assert.match(settlementSource, /handleViewModeChange\('vertical', targetPricingMode\)/);
    assert.match(settlementSource, /처방별 인센티브/);
    assert.match(settlementSource, /sw-prescription-incentive-rate/);
    assert.match(settlementSource, /formatPercentage\(prescriptionIncentivePercentage\)/);
  });

  it('applies per-prescription patient delimiter styles only when enabled', async () => {
    const [pageSource, settingsSource, viewStateSource, scheduleCellSource, scheduleCssSource] = await Promise.all([
      readFile(pageUrl, 'utf8'),
      readFile(settingsPanelUrl, 'utf8'),
      readFile(scheduleViewStateUrl, 'utf8'),
      readFile(scheduleCellUrl, 'utf8'),
      readFile(scheduleCssUrl, 'utf8'),
    ]);

    assert.doesNotMatch(settingsSource, /배경색/);
    assert.doesNotMatch(settingsSource, /prescription_background_colors/);
    assert.match(settingsSource, /aria-label=\{`\$\{prescription\} 슬래시 강조`\}/);
    assert.match(settingsSource, /aria-label=\{`\$\{prescription\} 슬래시 색`\}/);
    assert.match(settingsSource, /aria-label=\{`\$\{prescription\} 슬래시 두께`\}/);
    assert.doesNotMatch(settingsSource, /disabled=\{!hasPatientDelimiterStyle\}/);
    assert.match(settingsSource, /enablePatientDelimiterPrescription/);
    assert.match(settingsSource, /변경 시 강조 자동 적용/);
    assert.match(pageSource, /patient_delimiter_prescriptions:\s*nextPatientDelimiterPrescriptions/);
    assert.match(pageSource, /patient_delimiter_colors:\s*nextPatientDelimiterColors/);
    assert.match(pageSource, /patient_delimiter_thicknesses:\s*nextPatientDelimiterThicknesses/);
    assert.match(viewStateSource, /enabledPrescriptions\.has\(prescription\)/);
    assert.match(scheduleCellSource, /isShinjangSprayPrescription\(cellPrescription\)/);
    assert.match(scheduleCellSource, /splitSchedulerPatientDelimiter\(text\)/);
    assert.match(scheduleCellSource, /className="sw-cell-shinjang-patient-delimiter"/);
    assert.match(scheduleCssSource, /color:\s*var\(--shinjang-patient-delimiter-color, currentColor\) !important;/);
    assert.match(scheduleCssSource, /-webkit-text-stroke-width:\s*var\(--shinjang-patient-delimiter-thickness, 0\);/);
    assert.match(scheduleCssSource, /paint-order:\s*stroke fill;/);
  });

  it('shows only prescriptions actually completed by each therapist in compact settlement', async () => {
    const source = await readFile(compactSettlementViewUrl, 'utf8');
    assert.match(source, /const completedTherapistPrescriptions = showOnlyTherapistPrescriptions/);
    assert.match(source, /getTherapistCompletedPrescriptions\(item, prescriptions\)/);
    assert.match(source, /: \[null\]/);
    assert.match(source, /sw-prescription-incentive-rate/);
    assert.match(source, /rowSpan=\{therapistPrescriptions\.length \+ 1\}/);
    assert.match(source, /therapistPrescriptions\.map/);
  });

  it('styles prescription incentive badges by percentage with room in compact rows', async () => {
    const [sharedSettlementSource, compactSettlementSource, statsCss, horizontal2Css] = await Promise.all([
      readFile(sharedSettlementViewUrl, 'utf8'),
      readFile(compactSettlementViewUrl, 'utf8'),
      readFile(statsCssUrl, 'utf8'),
      readFile(horizontal2CssUrl, 'utf8'),
    ]);

    assert.match(sharedSettlementSource, /style=\{getIncentiveRateBadgeStyle\(prescriptionIncentivePercentage\)\}/);
    assert.match(compactSettlementSource, /sw-horizontal2-layout--prescription-incentives/);
    assert.match(compactSettlementSource, /treatmentLabel === '신장분사' \? ' sw-horizontal2-layout--shinjang' : ''/);
    assert.match(compactSettlementSource, /style=\{getIncentiveRateBadgeStyle\(prescriptionIncentivePercentage\)\}/);
    assert.match(statsCss, /font-size:\s*calc\(0\.7rem \+ 2px\)/);
    assert.match(statsCss, /--sw-incentive-hue/);
    assert.match(horizontal2Css, /sw-horizontal2-layout--prescription-incentives[\s\S]*?padding-top:\s*4px !important;[\s\S]*?padding-bottom:\s*4px !important;/);
    assert.match(horizontal2Css, /sw-horizontal2-layout--shinjang \.sw-horizontal2-therapist-table[\s\S]*?width:\s*100% !important;/);
    assert.match(horizontal2Css, /sw-horizontal2-layout--shinjang \.sw-horizontal2-therapist-table td\.prescription-name[\s\S]*?width:\s*auto !important;/);
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
    assert.match(pageSource, /syncMonthShockwaveScheduleToStats/);
  });
});
