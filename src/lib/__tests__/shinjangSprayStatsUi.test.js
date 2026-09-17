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
    assert.match(source, /rowSpan=\{therapistPrescriptions\.length \+ 1 \+ \(showIncentiveRateSubtotals/);
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
  it('places 7% and 15% subtotal rows immediately after each rate group and uses soft pastel backgrounds', async () => {
    const horizontal2Source = await readFile(compactSettlementViewUrl, 'utf8');
    const verticalSource = await readFile(sharedSettlementViewUrl, 'utf8');
    const rateColumnCss = await readFile(new URL('../../styles/shinjang_settlement_rate_column.css', import.meta.url), 'utf8');

    for (const source of [horizontal2Source, verticalSource]) {
      assert.match(source, /isRateGroupEnd/);
      assert.match(source, /settlement-rate-subtotal-row/);
    }
    assert.match(rateColumnCss, /data-incentive-rate="7"[\s\S]*?background:\s*#eff6ff !important;/);
    assert.match(rateColumnCss, /data-incentive-rate="15"[\s\S]*?background:\s*#fff7ed !important;/);
  });

  it('places horizontal settlement subtotal rows first and groups all grand total rows consecutively at the bottom', async () => {
    const source = await readFile(sharedSettlementViewUrl, 'utf8');

    // 상단 테이블 검증: 비율별 건수 -> 비율별 금액 -> 비율별 인센 -> 전체 건수 -> 전체 금액 -> 전체 인센
    const rateCountIdx = source.indexOf('{treatmentLabel} 합계(건)');
    const rateAmountIdx = source.indexOf('결산 금액 합계');
    const rateIncentiveIdx = source.indexOf('인센티브 합계');
    const grandCountIdx = source.indexOf('{treatmentLabel} 전체 합계(건)');
    const grandAmountIdx = source.indexOf('전체 결산 금액(원)');
    const grandIncentiveIdx = source.indexOf('전체 인센티브 합계');

    assert(rateCountIdx >= 0, 'rate count row found');
    assert(rateAmountIdx > rateCountIdx, 'rate amount comes after rate count');
    assert(rateIncentiveIdx > rateAmountIdx, 'rate incentive comes after rate amount');
    assert(grandCountIdx > rateIncentiveIdx, 'grand count comes after rate incentive');
    assert(grandAmountIdx > grandCountIdx, 'grand amount comes after grand count');
    assert(grandIncentiveIdx > grandAmountIdx, 'grand incentive comes after grand amount');
  });

  it('renders merged rate header rows labeled "인센티브 7%" and "인센티브 15%" while keeping prescriptions separate without individual badges', async () => {
    const source = await readFile(sharedSettlementViewUrl, 'utf8');

    // 상단 테이블 검증: settlement-rate-header-row와 rate-header-col 존재
    assert.match(source, /className="settlement-rate-header-row"/);
    assert.match(source, /인센티브 \$\{formatPercentage\(rateGroup\.percentage\)\}/);
    assert.match(source, /renderPrescriptionLabel\(prescription, !showIncentiveRateSubtotals\)/);
    assert.match(source, /renderPrescriptionLabel\(prescription, false\)/);
  });

  it('renders grand total table and recent summaries in the right column with empty therapist rateSpan protection', async () => {
    const compactSource = await readFile(compactSettlementViewUrl, 'utf8');
    const horizontal2Css = await readFile(horizontal2CssUrl, 'utf8');
    const rateColumnCss = await readFile(new URL('../../styles/shinjang_settlement_rate_column.css', import.meta.url), 'utf8');

    // 빈 처방 치료사 effectiveRateSpan 보호 검증
    assert.match(compactSource, /const effectiveRateSpan = \(showIncentiveRateSubtotals && Boolean\(prescription\) && rateSpan > 0\)/);

    // sw-horizontal2-right 내부에 grand-table 및 recent-wrap 배치 검증
    const rightIndex = compactSource.indexOf('className="sw-horizontal2-right"');
    const grandTableIndex = compactSource.indexOf('sw-horizontal2-grand-table');
    const recentTableIndex = compactSource.indexOf('sw-horizontal2-recent-table');
    assert(rightIndex >= 0, 'right column found');
    assert(grandTableIndex > rightIndex, 'grand table is inside right column');
    assert(recentTableIndex > grandTableIndex, 'recent table follows grand table inside right column');

    // 우측 총결산 테이블 및 결산/신환 테이블 높이/폰트 조정 검증
    assert.match(horizontal2Css, /\.sw-horizontal2-grand-table \.horizontal2-grand-total-row th,[\s\S]*?font-size:\s*16\.5px !important;/);
    assert.match(horizontal2Css, /\.sw-horizontal2-recent-table thead th[\s\S]*?font-size:\s*14px !important;/);
    assert.match(horizontal2Css, /\.sw-horizontal2-layout--prescription-incentives \.sw-horizontal2-therapist-table tbody tr\.horizontal2-content-row[\s\S]*?height:\s*34px !important;/);
    assert.match(horizontal2Css, /\.sw-horizontal2-therapist-table \.horizontal2-total-row[\s\S]*?height:\s*38px !important;/);
    // 처방명 열 너비 10% 확대 검증 (세로보기 26.5%, 가로보기2 115px)
    assert.match(rateColumnCss, /:nth-child\(1\)\s*\{\s*width:\s*26\.5% !important;\s*\}/);
    assert.match(rateColumnCss, /\.sw-horizontal2-prescription-column\s*\{\s*width:\s*115px !important;\s*\}/);
    assert.match(rateColumnCss, /\.sw-settlement-rate-column\s*\{\s*width:\s*77px !important;\s*\}/);
    assert.match(rateColumnCss, /th\.sw-settlement-rate-cell[\s\S]*?white-space:\s*nowrap !important;/);
  });

  it('abbreviates prescription names and narrows column width in shinjang spray grid table', async () => {
    const [pageSource, gridSource] = await Promise.all([
      readFile(pageUrl, 'utf8'),
      readFile(new URL('../../components/shockwave/ShockwaveDataGrid.jsx', import.meta.url), 'utf8'),
    ]);

    assert.match(pageSource, /treatmentLabel="신장분사"/);
    assert.match(gridSource, /if\s*\(isShinjangSpray\)\s*return\s*64;/);
    assert.match(gridSource, /prescription\.replace\(\/신장분사\/g,\s*'신장'\)/);
  });
});
