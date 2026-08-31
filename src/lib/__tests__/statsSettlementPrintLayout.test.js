import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const indexCssUrl = new URL('../../styles/index.css', import.meta.url);
const refinementsCssUrl = new URL('../../styles/shockwave_stats_refinements.css', import.meta.url);
const horizontal2CssUrl = new URL(
  '../../styles/shockwave_settlement_horizontal2.css',
  import.meta.url,
);
const shockwaveSettlementUrl = new URL(
  '../../components/shockwave/ShockwaveSettlementView.jsx',
  import.meta.url,
);
const manualTherapySettlementUrl = new URL(
  '../../components/shockwave/ManualTherapyStatsView.jsx',
  import.meta.url,
);
const manualTherapySixMonthStatsUrl = new URL(
  '../../components/shockwave/ManualTherapySixMonthStats.jsx',
  import.meta.url,
);

test('shockwave landscape print uses label-aware prescription columns', async () => {
  const [indexCss, settlementView] = await Promise.all([
    readFile(indexCssUrl, 'utf8'),
    readFile(shockwaveSettlementUrl, 'utf8'),
  ]);

  assert.match(settlementView, /buildShockwaveSettlementPrintColumnWidths/);
  assert.match(settlementView, /<colgroup>[\s\S]*?sw-shockwave-settlement-label-column/);
  assert.match(settlementView, /--sw-shockwave-print-column-width/);
  assert.match(settlementView, /merged-value--single-prescription/);
  assert.match(
    indexCss,
    /col\.sw-shockwave-settlement-prescription-column\s*\{[^}]*width:\s*var\(--sw-shockwave-print-column-width\) !important;/s,
  );
  assert.match(
    indexCss,
    /td\.merged-value--single-prescription\s*\{[^}]*font-size:\s*13\.5pt !important;/s,
  );
});

test('manual settlement headers stay close to their tables on screen and print', async () => {
  const [indexCss, refinementsCss] = await Promise.all([
    readFile(indexCssUrl, 'utf8'),
    readFile(refinementsCssUrl, 'utf8'),
  ]);

  assert.match(
    refinementsCss,
    /\.sw-manual-settlement-container \.sw-settlement-card\s*\{[^}]*gap:\s*6px;/s,
  );
  assert.match(
    refinementsCss,
    /\.sw-manual-settlement-container \.sw-settlement-header\s*\{[^}]*flex:\s*0 0 32px;[^}]*height:\s*32px;[^}]*min-height:\s*32px;[^}]*margin-bottom:\s*6px;/s,
  );
  assert.match(
    indexCss,
    /html\[data-print-orientation="landscape"\] body\.manual-settlement-print[\s\S]*?\.sw-manual-settlement-stack \.sw-settlement-card,[\s\S]*?gap:\s*0\.6mm !important;[\s\S]*?\.sw-manual-settlement-container \.sw-settlement-header\s*\{[^}]*flex:\s*0 0 7mm !important;[^}]*height:\s*7mm !important;[^}]*margin:\s*0 0 0\.6mm !important;/s,
  );
  assert.match(
    indexCss,
    /\.sw-manual-ion-treatment-card \.sw-settlement-header\s*\{[^}]*margin-bottom:\s*0\.6mm !important;/s,
  );
});

test('manual ion print keeps numbers and units on the same typography', async () => {
  const indexCss = await readFile(indexCssUrl, 'utf8');

  assert.match(
    indexCss,
    /\.sw-six-month-ion-input-wrap input\s*\{[^}]*font-size:\s*inherit !important;[^}]*font-weight:\s*inherit !important;[^}]*line-height:\s*inherit !important;/s,
  );
  assert.match(
    indexCss,
    /\.sw-six-month-ion-input-wrap span\s*\{[^}]*font-size:\s*inherit !important;[^}]*font-weight:\s*inherit !important;[^}]*line-height:\s*inherit !important;/s,
  );
  assert.match(
    indexCss,
    /\.sw-manual-ion-summary-card \.sw-summary-table th,[\s\S]*?\.sw-manual-ion-summary-card \.sw-summary-table td\s*\{[^}]*height:\s*6\.8mm !important;[^}]*font-size:\s*10\.3pt !important;/s,
  );
  assert.match(
    indexCss,
    /\.sw-manual-ion-summary-card \.sw-summary-table thead th\s*\{[^}]*font-size:\s*11\.3pt !important;/s,
  );
  assert.match(
    indexCss,
    /\.sw-manual-ion-summary-card \.sw-summary-table tbody tr\.sw-current-month-summary-row > th,[\s\S]*?font-size:\s*11pt !important;/s,
  );
});

test('manual settlement print keeps only the incentive header badge', async () => {
  const [indexCss, settlementView] = await Promise.all([
    readFile(indexCssUrl, 'utf8'),
    readFile(manualTherapySettlementUrl, 'utf8'),
  ]);

  assert.match(settlementView, /className="sw-settlement-meta-total">총 /);
  assert.match(settlementView, /className="sw-settlement-meta-sales">매출 /);
  assert.match(settlementView, /className="sw-settlement-meta-incentive">인센티브 /);
  assert.match(
    indexCss,
    /body\.manual-settlement-print[\s\S]*?\.sw-settlement-meta-total,[\s\S]*?body\.manual-settlement-print[\s\S]*?\.sw-settlement-meta-sales\s*\{[^}]*display:\s*none !important;/s,
  );
});

test('shockwave horizontal2 print enlarges summary text without resizing tables', async () => {
  const horizontal2Css = await readFile(horizontal2CssUrl, 'utf8');

  assert.match(
    horizontal2Css,
    /\.sw-horizontal2-grand-table \.grand-title\s*\{[^}]*font-size:\s*8\.4pt !important;/s,
  );
  assert.match(
    horizontal2Css,
    /\.sw-horizontal2-grand-table \.horizontal2-grand-total-row td\s*\{[^}]*font-size:\s*8\.4pt !important;/s,
  );
  assert.match(
    horizontal2Css,
    /\.sw-horizontal2-recent-table thead th\s*\{[^}]*font-size:\s*9pt !important;/s,
  );
  assert.match(
    horizontal2Css,
    /\.sw-horizontal2-recent-table tbody tr:not\(\.current-period-row\) th,[\s\S]*?font-size:\s*8\.7pt !important;/s,
  );
  assert.match(
    horizontal2Css,
    /\.sw-horizontal2-recent-table tbody tr\.current-period-row th,[\s\S]*?font-size:\s*9\.1pt !important;/s,
  );
  assert.match(horizontal2Css, /\.sw-horizontal2-grand-table\s*\{[^}]*width:\s*87mm !important;/s);
  assert.match(horizontal2Css, /\.sw-horizontal2-recent-table\s*\{[^}]*width:\s*88mm !important;/s);
});

test('manual settlement screen enlarges section titles and compacts only body rows', async () => {
  const refinementsCss = await readFile(refinementsCssUrl, 'utf8');

  assert.match(
    refinementsCss,
    /\.sw-manual-settlement-main-card \.sw-manual-compact-settlement-table thead th,[\s\S]*?\.sw-manual-summary-card \.sw-summary-table thead th\s*\{[^}]*font-size:\s*1\.3rem !important;/s,
  );
  assert.match(
    refinementsCss,
    /@media screen\s*\{[\s\S]*?\.sw-manual-settlement-container \.sw-settlement-header h2\s*\{[^}]*font-size:\s*1\.3rem !important;/s,
  );
  assert.match(
    refinementsCss,
    /@media screen\s*\{[\s\S]*?\.sw-manual-summary-card:not\(\.sw-manual-ion-summary-card\)[\s\S]*?tbody td\s*\{[^}]*height:\s*36px;[^}]*padding-block:\s*6px;/s,
  );
  assert.match(
    refinementsCss,
    /@media screen\s*\{[\s\S]*?\.sw-manual-ion-summary-card \.sw-summary-table tbody th,[\s\S]*?tbody td\s*\{[^}]*height:\s*34px;[^}]*padding-block:\s*2px;/s,
  );
  assert.match(
    refinementsCss,
    /\.sw-six-month-ion-input-wrap input\s*\{[^}]*height:\s*30px;[^}]*font:\s*inherit;/s,
  );
});

test('manual settlement recent-period header omits the redundant aggregate badge', async () => {
  const sixMonthStats = await readFile(manualTherapySixMonthStatsUrl, 'utf8');

  assert.doesNotMatch(sixMonthStats, /개월 집계/);
  assert.match(sixMonthStats, /aria-label="도수치료 최근 현황 기간"/);
});
