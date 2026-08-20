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
  const rowNumberHeaderRule = shockwaveCss.match(
    /\.patient-history-table thead \.patient-history-row-number-cell\s*\{([^}]*)\}/s
  )?.[1] || '';

  assert.match(rowNumberRule, /position:\s*sticky;/);
  assert.match(rowNumberRule, /left:\s*0;/);
  assert.match(rowNumberRule, /font-size:\s*0\.82rem;/);
  assert.match(rowNumberHeaderRule, /color:\s*var\(--text-primary, #1f2937\);/);
  assert.match(rowNumberHeaderRule, /font-size:\s*0\.78rem;/);
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
  assert.match(patientHistoryFilters, /getPatientHistoryFilterWidthWeight\(options\)/);
  assert.match(patientHistoryFilters, /--patient-history-filter-weight/);
  assert.match(shockwaveCss, /\.patient-history-filter-section--body\s*\{/);
  assert.match(shockwaveCss, /\.patient-history-filter-section--prescription\s*\{/);
});

test('patient history checkbox filters share width by content in a compact layout', async () => {
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
  const sectionRule = shockwaveCss.match(
    /\.patient-history-filter-section\s*\{([^}]*)\}/s
  )?.[1] || '';
  const optionRule = shockwaveCss.match(
    /\.patient-history-filter-option\s*\{([^}]*)\}/s
  )?.[1] || '';
  const countRule = shockwaveCss.match(
    /\.patient-history-filter-count\s*\{([^}]*)\}/s
  )?.[1] || '';

  assert.match(headerRule, /padding:\s*6px 8px 7px;/);
  assert.match(sectionsRule, /display:\s*flex;/);
  assert.match(sectionsRule, /align-items:\s*flex-start;/);
  assert.match(sectionsRule, /width:\s*100%;/);
  assert.match(sectionsRule, /min-width:\s*0;/);
  assert.doesNotMatch(sectionsRule, /grid-template-columns:/);
  assert.match(sectionRule, /grid-template-columns:\s*30px minmax\(0, 1fr\);/);
  assert.match(sectionRule, /flex-grow:\s*var\(--patient-history-filter-weight, 1\);/);
  assert.match(sectionRule, /flex-shrink:\s*1;/);
  assert.match(sectionRule, /flex-basis:\s*0;/);
  assert.match(sectionRule, /box-sizing:\s*border-box;/);
  assert.match(sectionRule, /padding:\s*3px;/);
  assert.match(optionsRule, /max-height:\s*41px;/);
  assert.match(optionsRule, /column-gap:\s*2px;/);
  assert.match(optionRule, /min-height:\s*19px;/);
  assert.match(optionRule, /gap:\s*2px;/);
  assert.match(optionRule, /padding:\s*1px 2px;/);
  assert.match(optionRule, /font-size:\s*0\.69rem;/);
  assert.match(countRule, /padding:\s*1px 2px;/);
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
  assert.match(currentRowCellsRule, /height:\s*23px;/);
  assert.match(currentRowCellsRule, /padding-top:\s*3px\s*!important;/);
  assert.match(currentRowCellsRule, /padding-bottom:\s*3px\s*!important;/);
  assert.match(currentRowNumberRule, /border-left:\s*2px solid/);
  assert.match(currentRowLastCellRule, /border-right:\s*2px solid/);
  assert.doesNotMatch(shockwaveView, /outline:\s*isCurrentHistoryRow/);
});

test('current patient history row uses light treatment-specific backgrounds', async () => {
  const shockwaveView = await readFile(shockwaveViewUrl, 'utf8');

  assert.match(
    shockwaveView,
    /group\.key === 'manual' \? '#fff1e3' : '#e6f6fe'/
  );
  assert.doesNotMatch(shockwaveView, /#fedfbb|#c8ebfd/);
});

test('patient history edit fields keep a flat base style until focused', async () => {
  const [shockwaveCss, shockwaveView] = await Promise.all([
    readFile(shockwaveCssUrl, 'utf8'),
    readFile(shockwaveViewUrl, 'utf8'),
  ]);
  const editFieldRule = shockwaveCss.match(
    /\.patient-history-table \.patient-history-edit-field\s*\{([^}]*)\}/s
  )?.[1] || '';
  const editFieldFocusRule = shockwaveCss.match(
    /\.patient-history-table \.patient-history-edit-field:focus:not\(:disabled\)\s*\{([^}]*)\}/s
  )?.[1] || '';

  assert.equal(
    shockwaveView.match(/className="patient-history-edit-field/g)?.length,
    4
  );
  assert.match(editFieldRule, /border:\s*0\s*!important;/);
  assert.match(editFieldRule, /background-color:\s*transparent\s*!important;/);
  assert.match(editFieldRule, /box-shadow:\s*none\s*!important;/);
  assert.match(editFieldFocusRule, /box-shadow:\s*inset 0 -2px 0/);
});

test('patient history cursors distinguish editable and read-only cells', async () => {
  const [shockwaveCss, shockwaveView] = await Promise.all([
    readFile(shockwaveCssUrl, 'utf8'),
    readFile(shockwaveViewUrl, 'utf8'),
  ]);
  const bodyCellRule = shockwaveCss.match(
    /\.patient-history-table tbody td\s*\{([^}]*)\}/s
  )?.[1] || '';
  const tableHeaderRule = shockwaveCss.match(
    /\.patient-history-table\.sw-summary-table thead th,[\s\S]*?\.patient-history-table\.sw-compact-summary-table thead th\s*\{([^}]*)\}/s
  )?.[1] || '';
  const editableFieldRule = shockwaveCss.match(
    /\.patient-history-table \.patient-history-edit-field:not\(:disabled\)\s*\{([^}]*)\}/s
  )?.[1] || '';
  const disabledFieldRule = shockwaveCss.match(
    /\.patient-history-table \.patient-history-edit-field:disabled\s*\{([^}]*)\}/s
  )?.[1] || '';

  assert.match(bodyCellRule, /cursor:\s*default;/);
  assert.match(tableHeaderRule, /cursor:\s*default;/);
  assert.match(editableFieldRule, /cursor:\s*text;/);
  assert.match(disabledFieldRule, /cursor:\s*default;/);
  assert.doesNotMatch(shockwaveView, /cursor:\s*canEditHistoryMemo\s*\?\s*'text'\s*:\s*'not-allowed'/);
});

test('patient history editable values use compact inset fields without changing type size', async () => {
  const [shockwaveCss, shockwaveView] = await Promise.all([
    readFile(shockwaveCssUrl, 'utf8'),
    readFile(shockwaveViewUrl, 'utf8'),
  ]);
  const insetFieldRule = shockwaveCss.match(
    /\.patient-history-table \.patient-history-edit-field--inset\s*\{([^}]*)\}/s
  )?.[1] || '';

  assert.equal(
    shockwaveView.match(/patient-history-edit-field--inset/g)?.length,
    4
  );
  assert.match(insetFieldRule, /width:\s*calc\(100% - 2px\)\s*!important;/);
  assert.match(insetFieldRule, /border:\s*1px solid/);
  assert.match(insetFieldRule, /border-radius:\s*3px\s*!important;/);
  assert.doesNotMatch(insetFieldRule, /font-size:/);
});

test('patient history body and memo text use the shared content size with shorter data rows', async () => {
  const [shockwaveCss, shockwaveView] = await Promise.all([
    readFile(shockwaveCssUrl, 'utf8'),
    readFile(shockwaveViewUrl, 'utf8'),
  ]);
  const tableCellRule = shockwaveCss.match(
    /\.patient-history-table\.sw-summary-table th,[\s\S]*?\.patient-history-table\.sw-compact-summary-table td\s*\{([^}]*)\}/s
  )?.[1] || '';
  const detailFieldRule = shockwaveCss.match(
    /\.patient-history-table \.patient-history-edit-field--detail\s*\{([^}]*)\}/s
  )?.[1] || '';

  assert.equal(
    shockwaveView.match(/patient-history-edit-field--detail/g)?.length,
    2
  );
  assert.match(detailFieldRule, /font-size:\s*0\.82rem\s*!important;/);
  assert.match(detailFieldRule, /overflow-y:\s*hidden\s*!important;/);
  assert.match(detailFieldRule, /resize:\s*none\s*!important;/);
  assert.match(tableCellRule, /padding:\s*1px 3px\s*!important;/);
  assert.match(tableCellRule, /height:\s*20px;/);
  assert.match(shockwaveView, /bodyPartTextareaRows === 1 \? '19px'/);
  assert.match(shockwaveView, /memoTextareaRows === 1 \? '19px'/);
  assert.doesNotMatch(shockwaveView, /resize:\s*memoTextareaRows/);
});

test('patient history column headers use one compact readable type size', async () => {
  const shockwaveCss = await readFile(shockwaveCssUrl, 'utf8');
  const tableHeaderRule = shockwaveCss.match(
    /\.patient-history-table\.sw-summary-table thead th,[\s\S]*?\.patient-history-table\.sw-compact-summary-table thead th\s*\{([^}]*)\}/s
  )?.[1] || '';

  assert.match(tableHeaderRule, /font-size:\s*0\.78rem\s*!important;/);
  assert.match(tableHeaderRule, /line-height:\s*1\.12;/);
});

test('patient history prescription dropdown keeps its height and uses the requested type size with a tightly spaced arrow', async () => {
  const [shockwaveCss, shockwaveView] = await Promise.all([
    readFile(shockwaveCssUrl, 'utf8'),
    readFile(shockwaveViewUrl, 'utf8'),
  ]);
  const prescriptionSelect = shockwaveView.match(
    /<select\s+[\s\S]*?aria-label="처방 수정"[\s\S]*?<\/select>/
  )?.[0] || '';
  const prescriptionFieldRule = shockwaveCss.match(
    /\.patient-history-table \.patient-history-edit-field--prescription\s*\{([^}]*)\}/s
  )?.[1] || '';

  assert.match(prescriptionSelect, /patient-history-edit-field--prescription/);
  assert.match(prescriptionSelect, /appearance:\s*'none'/);
  assert.match(prescriptionSelect, /backgroundPosition:\s*'right 3px center'/);
  assert.match(prescriptionSelect, /backgroundSize:\s*'6px 4px'/);
  assert.match(prescriptionSelect, /padding:\s*'2px 11px 2px 5px'/);
  assert.match(prescriptionFieldRule, /font-size:\s*0\.82rem\s*!important;/);
  assert.doesNotMatch(prescriptionSelect, /(?:minH|h)eight:\s*'20px'/);
});

test('patient history data cells stay consistent with a compact apply button label', async () => {
  const [shockwaveCss, shockwaveView] = await Promise.all([
    readFile(shockwaveCssUrl, 'utf8'),
    readFile(shockwaveViewUrl, 'utf8'),
  ]);
  const bodyCellRule = shockwaveCss.match(
    /\.patient-history-table tbody td\s*\{([^}]*)\}/s
  )?.[1] || '';
  const inputRule = shockwaveCss.match(
    /\.patient-history-table input\s*\{([^}]*)\}/s
  )?.[1] || '';
  const therapistCellRule = shockwaveCss.match(
    /\.patient-history-table \.patient-history-therapist-cell\s*\{([^}]*)\}/s
  )?.[1] || '';
  const applyButtonRule = shockwaveCss.match(
    /\.patient-history-table \.patient-history-apply-button\s*\{([^}]*)\}/s
  )?.[1] || '';

  assert.match(bodyCellRule, /font-size:\s*0\.82rem;/);
  assert.match(inputRule, /font-size:\s*0\.82rem;/);
  assert.match(therapistCellRule, /font-size:\s*0\.82rem;/);
  assert.match(shockwaveView, /className="patient-history-therapist-cell"/);
  assert.match(applyButtonRule, /font-size:\s*0\.74rem\s*!important;/);
  assert.match(shockwaveView, /fontSize:\s*'0\.82rem'.*?>현재 셀<\/span>/s);
  assert.doesNotMatch(shockwaveView, /patient-history-compact-text-cell/);
});
