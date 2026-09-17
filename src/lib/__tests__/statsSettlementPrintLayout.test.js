import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const indexCssUrl = new URL('../../styles/index.css', import.meta.url);
const refinementsCssUrl = new URL('../../styles/shockwave_stats_refinements.css', import.meta.url);
const horizontal2CssUrl = new URL(
  '../../styles/shockwave_settlement_horizontal2.css',
  import.meta.url,
);
const verticalCssUrl = new URL(
  '../../styles/shockwave_settlement_vertical.css',
  import.meta.url,
);
const shinjangRateColumnCssUrl = new URL(
  '../../styles/shinjang_settlement_rate_column.css',
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
const horizontal2ViewUrl = new URL(
  '../../components/shockwave/ShockwaveSettlementHorizontalCompactView.jsx',
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
    /col\.sw-shockwave-settlement-prescription-column\s*\{[^}]*width:\s*auto !important;/s,
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
    /\.sw-horizontal2-grand-table \.grand-title,[\s\S]*?font-size:\s*12\.5pt !important;/s,
  );
  assert.match(
    horizontal2Css,
    /\.sw-horizontal2-grand-table \.horizontal2-grand-total-row td\s*\{[^}]*font-size:\s*12\.5pt !important;/s,
  );
  assert.match(
    horizontal2Css,
    /\.sw-horizontal2-recent-table thead th\s*\{[^}]*font-size:\s*11\.5pt !important;/s,
  );
  assert.match(
    horizontal2Css,
    /\.sw-horizontal2-recent-table tbody tr\.current-period-row th,[\s\S]*?font-size:\s*11\.5pt !important;/s,
  );
});

test('shockwave horizontal2 therapist total rows share the body table columns', async () => {
  const [horizontal2View, horizontal2Css] = await Promise.all([
    readFile(horizontal2ViewUrl, 'utf8'),
    readFile(horizontal2CssUrl, 'utf8'),
  ]);

  assert.match(horizontal2View, /<td className="horizontal2-total-spacer" aria-hidden="true" \/>/);
  assert.match(horizontal2View, /rowSpan=\{therapistPrescriptions\.length \+ 1 \+ \(showIncentiveRateSubtotals \? \(item\.incentiveRateBreakdown\?\.length \|\| 0\) : 0\)\}/);
  assert.doesNotMatch(horizontal2View, /sw-horizontal2-therapist-total-table/);
  assert.match(horizontal2Css, /\.sw-horizontal2-therapist-table \.horizontal2-total-spacer,[\s\S]*?border-right:\s*2px solid #64748b !important;/);
  assert.match(
    horizontal2Css,
    /\.horizontal2-total-spacer[\s\S]*?border-left:\s*0 none transparent !important;[\s\S]*?border-bottom:\s*0 none transparent !important;/s,
  );
});

test('shinjang settlement distinguishes 7 and 15 percent incentive subtotals by background', async () => {
  const [settlementView, horizontal2View, horizontal2Css, verticalCss] = await Promise.all([
    readFile(shockwaveSettlementUrl, 'utf8'),
    readFile(horizontal2ViewUrl, 'utf8'),
    readFile(horizontal2CssUrl, 'utf8'),
    readFile(verticalCssUrl, 'utf8'),
  ]);

  for (const source of [settlementView, horizontal2View]) {
    assert.match(source, /function getIncentiveRateToneClass\(value\)/);
    assert.match(source, /settlement-rate-subtotal-row--7/);
    assert.match(source, /settlement-rate-subtotal-row--15/);
  }
  assert.match(horizontal2Css, /\.settlement-rate-subtotal-row--7[\s\S]*?background:\s*#dbeafe !important;/);
  assert.match(horizontal2Css, /\.settlement-rate-subtotal-row--15[\s\S]*?background:\s*#ffedd5 !important;/);
  assert.match(verticalCss, /tr\.settlement-rate-subtotal-row\.settlement-rate-subtotal-row--7 > \*[\s\S]*?background:\s*#dbeafe !important;/);
  assert.match(verticalCss, /tr\.settlement-rate-subtotal-row\.settlement-rate-subtotal-row--15 > \*[\s\S]*?background:\s*#ffedd5 !important;/);
});

test('vertical settlement distinguishes overall totals with a thicker top border', async () => {
  const verticalCss = await readFile(verticalCssUrl, 'utf8');

  assert.match(
    verticalCss,
    /tr\.vertical-total-row\.settlement-rate-total-row > \*\s*\{[^}]*border-top:\s*3px solid #94a3b8 !important;/s,
  );
  assert.match(
    verticalCss,
    /tr\.grand-total-row\.settlement-rate-total-row > \*\s*\{[^}]*border-top:\s*3px solid #1d4ed8 !important;/s,
  );
});

test('shinjang horizontal settlement carries the label header baseline through prescription headers', async () => {
  const rateColumnCss = await readFile(shinjangRateColumnCssUrl, 'utf8');

  assert.match(
    rateColumnCss,
    /:is\(\.sw-horizontal-settlement-main-table, \.sw-grand-total-table\) thead \.label-col,[\s\S]*?:is\(\.sw-horizontal-settlement-main-table, \.sw-grand-total-table\) thead tr:last-child \.prescription-col\s*\{[^}]*border-bottom:\s*2px solid #b7c4d4 !important;/,
  );
});

test('shinjang horizontal overall amount and incentive totals enlarge only numeric cells', async () => {
  const rateColumnCss = await readFile(shinjangRateColumnCssUrl, 'utf8');

  assert.match(
    rateColumnCss,
    /tr\.settlement-rate-total-row\.settlement-amount-row td\s*\{[^}]*font-size:\s*calc\(1\.18rem \+ 2px\) !important;/,
  );
  assert.match(
    rateColumnCss,
    /tr\.settlement-rate-total-row\.settlement-incentive-row td\s*\{[^}]*font-size:\s*calc\(1\.16rem \+ 2px\) !important;/,
  );
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

test('shinjang horizontal print relaxes main table widths and balances grand total columns', async () => {
  const [indexCss, rateColumnCss, settlementView] = await Promise.all([
    readFile(indexCssUrl, 'utf8'),
    readFile(shinjangRateColumnCssUrl, 'utf8'),
    readFile(shockwaveSettlementUrl, 'utf8'),
  ]);

  // 총합계 테이블에서 th.label-col, th.row-label에만 28%가 지정되어 신장 C가 2배 넓어지는 것 방지
  assert.match(
    indexCss,
    /\.sw-grand-total-table th\.label-col,[\s\S]*?\.sw-grand-total-table th\.row-label,[\s\S]*?\.sw-grand-total-table td:first-child\s*\{[^}]*width:\s*28% !important;/s,
  );

  // 총합계 테이블에 명시적 colgroup 배분
  assert.match(
    settlementView,
    /<table className="sw-settlement-table sw-grand-total-table">[\s\S]*?<colgroup>[\s\S]*?className="sw-shockwave-settlement-label-column"[\s\S]*?className="sw-shockwave-settlement-prescription-column"/s,
  );

  // 신장분사 가로보기 인쇄 시 메인 테이블 너비 100% 및 넉넉한 셀 패딩/min-width 여유 확보
  assert.match(
    rateColumnCss,
    /\.sw-horizontal-settlement-main-table\s*\{[^}]*width:\s*100% !important;[^}]*min-width:\s*100% !important;/s,
  );
  assert.match(
    rateColumnCss,
    /\.sw-horizontal-settlement-main-table :is\(th, td\)\s*\{[^}]*padding:\s*2\.2mm 5\.5mm !important;[^}]*min-width:\s*24mm !important;/s,
  );
});

