import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  formatPatientHistoryOverflowTooltipItems,
  getPatientHistoryOverflowTooltipPosition,
} from '../patientHistoryOverflowTooltipUtils.js';

const shockwaveCssUrl = new URL('../../styles/shockwave.css', import.meta.url);
const shockwaveViewUrl = new URL('../../components/shockwave/ShockwaveView.jsx', import.meta.url);
const patientHistoryFiltersUrl = new URL(
  '../../components/shockwave/PatientHistoryFilters.jsx',
  import.meta.url
);

test('patient history overflow tooltip shows multiple values on separate lines', () => {
  assert.equal(
    formatPatientHistoryOverflowTooltipItems(
      [' Rt. Shoulder ', 'Lt. Knee'],
      { showBullets: true },
    ),
    '• Rt. Shoulder\n• Lt. Knee',
  );
  assert.equal(
    formatPatientHistoryOverflowTooltipItems(['Rt. Shoulder'], { showBullets: true }),
    'Rt. Shoulder',
  );
  assert.equal(
    formatPatientHistoryOverflowTooltipItems(['첫 메모', '', '둘째 메모']),
    '첫 메모\n둘째 메모',
  );
});

test('patient history overflow tooltip stays in the viewport and flips above lower rows', () => {
  assert.deepEqual(getPatientHistoryOverflowTooltipPosition({
    anchorRect: { left: 4, top: 40, bottom: 62, width: 80 },
    tooltipRect: { width: 220, height: 80 },
    viewportWidth: 320,
    viewportHeight: 500,
  }), { left: 12, top: 70 });

  assert.deepEqual(getPatientHistoryOverflowTooltipPosition({
    anchorRect: { left: 220, top: 420, bottom: 442, width: 80 },
    tooltipRect: { width: 180, height: 100 },
    viewportWidth: 320,
    viewportHeight: 500,
  }), { left: 128, top: 312 });
});

test('patient history overflow tooltip stays above the modal with a light gray surface', async () => {
  const [shockwaveCss, shockwaveView] = await Promise.all([
    readFile(shockwaveCssUrl, 'utf8'),
    readFile(shockwaveViewUrl, 'utf8'),
  ]);
  const tooltipRule = shockwaveCss.match(/\.patient-history-overflow-tooltip\s*\{([^}]*)\}/s)?.[1] || '';
  const tooltipZIndex = Number(tooltipRule.match(/z-index:\s*(\d+)/)?.[1]);
  const modalZIndex = Number(shockwaveView.match(/zIndex:\s*(\d+),\s*overscrollBehavior/)?.[1]);

  assert.ok(tooltipZIndex > modalZIndex);
  assert.match(tooltipRule, /background-color:\s*#e2e8f0\s*!important;/);
  assert.match(tooltipRule, /color:\s*#1f2937;/);
});

test('patient history tables show a pinned spreadsheet-style row number column', async () => {
  const [shockwaveCss, shockwaveView] = await Promise.all([
    readFile(shockwaveCssUrl, 'utf8'),
    readFile(shockwaveViewUrl, 'utf8'),
  ]);
  const rowNumberRule = shockwaveCss.match(
    /\.patient-history-table \.patient-history-row-number-cell\s*\{([^}]*)\}/s
  )?.[1] || '';

  assert.match(rowNumberRule, /position:\s*sticky;/);
  assert.match(rowNumberRule, /left:\s*0;/);
  assert.match(shockwaveView, /<th className="patient-history-row-number-cell">번호<\/th>/);
  assert.match(shockwaveView, /aria-label={`행 번호 \$\{idx \+ 1\}`}/);
  assert.match(shockwaveView, /\{idx \+ 1\}/);
});

test('patient history body and prescription filters render as separate checkbox groups', async () => {
  const [patientHistoryFilters, shockwaveCss, shockwaveView] = await Promise.all([
    readFile(patientHistoryFiltersUrl, 'utf8'),
    readFile(shockwaveCssUrl, 'utf8'),
    readFile(shockwaveViewUrl, 'utf8'),
  ]);

  assert.match(shockwaveView, /<PatientHistoryFilters/);
  assert.match(patientHistoryFilters, /tone="body"/);
  assert.match(patientHistoryFilters, /tone="prescription"/);
  assert.match(patientHistoryFilters, /type="checkbox"/);
  assert.match(patientHistoryFilters, /group\.activeBodyFilters/);
  assert.match(patientHistoryFilters, /group\.activePrescriptionFilters/);
  assert.match(shockwaveCss, /\.patient-history-filter-section--body\s*\{/);
  assert.match(shockwaveCss, /\.patient-history-filter-section--prescription\s*\{/);
});

test('patient history checkbox filters stay compact in a two-column layout', async () => {
  const shockwaveCss = await readFile(shockwaveCssUrl, 'utf8');
  const headerRule = shockwaveCss.match(
    /\.patient-history-group-header\s*\{([^}]*)\}/s
  )?.[1] || '';
  const sectionsRule = shockwaveCss.match(
    /\.patient-history-filter-sections\s*\{([^}]*)\}/s
  )?.[1] || '';
  const optionsRule = shockwaveCss.match(
    /\.patient-history-filter-options\s*\{([^}]*)\}/s
  )?.[1] || '';
  const optionRule = shockwaveCss.match(
    /\.patient-history-filter-option\s*\{([^}]*)\}/s
  )?.[1] || '';

  assert.match(headerRule, /padding:\s*6px 8px 7px;/);
  assert.match(sectionsRule, /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(optionsRule, /max-height:\s*41px;/);
  assert.match(optionRule, /min-height:\s*19px;/);
  assert.match(optionRule, /font-size:\s*0\.69rem;/);
});

test('manual patient history header omits its bottom border without changing shockwave rows', async () => {
  const [shockwaveCss, shockwaveView] = await Promise.all([
    readFile(shockwaveCssUrl, 'utf8'),
    readFile(shockwaveViewUrl, 'utf8'),
  ]);
  const manualHeaderRule = shockwaveCss.match(
    /\.patient-history-table--manual thead th\s*\{([^}]*)\}/s
  )?.[1] || '';

  assert.match(shockwaveView, /patient-history-table--\$\{group\.key\}/);
  assert.match(manualHeaderRule, /border-bottom:\s*0\s*!important;/);
  assert.doesNotMatch(shockwaveCss, /\.patient-history-table--shockwave thead th\s*\{[^}]*border-bottom/s);
});

test('current patient history row border includes the pinned number cell as one thicker outline', async () => {
  const [shockwaveCss, shockwaveView] = await Promise.all([
    readFile(shockwaveCssUrl, 'utf8'),
    readFile(shockwaveViewUrl, 'utf8'),
  ]);
  const currentRowCellsRule = shockwaveCss.match(
    /\.patient-history-table tbody tr\.patient-history-current-row td\s*\{([^}]*)\}/s
  )?.[1] || '';
  const currentRowNumberRule = shockwaveCss.match(
    /\.patient-history-table tbody tr\.patient-history-current-row \.patient-history-row-number-cell\s*\{([^}]*)\}/s
  )?.[1] || '';
  const currentRowLastCellRule = shockwaveCss.match(
    /\.patient-history-table tbody tr\.patient-history-current-row td:last-child\s*\{([^}]*)\}/s
  )?.[1] || '';

  assert.match(currentRowCellsRule, /border-top:\s*2px solid/);
  assert.match(currentRowCellsRule, /border-bottom:\s*2px solid/);
  assert.match(currentRowNumberRule, /border-left:\s*2px solid/);
  assert.match(currentRowLastCellRule, /border-right:\s*2px solid/);
  assert.doesNotMatch(shockwaveView, /outline:\s*isCurrentHistoryRow/);
});

test('patient history prescription dropdown keeps its height and uses a smaller tightly spaced arrow', async () => {
  const shockwaveView = await readFile(shockwaveViewUrl, 'utf8');
  const prescriptionSelect = shockwaveView.match(
    /<select\s+aria-label="처방 수정"[\s\S]*?<\/select>/
  )?.[0] || '';

  assert.match(prescriptionSelect, /appearance:\s*'none'/);
  assert.match(prescriptionSelect, /backgroundPosition:\s*'right 3px center'/);
  assert.match(prescriptionSelect, /backgroundSize:\s*'6px 4px'/);
  assert.match(prescriptionSelect, /padding:\s*'2px 11px 2px 5px'/);
  assert.doesNotMatch(prescriptionSelect, /(?:minH|h)eight:\s*'20px'/);
});
