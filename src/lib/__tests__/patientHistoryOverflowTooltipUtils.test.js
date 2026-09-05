import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  formatPatientHistoryOverflowTooltipItems,
  getPatientHistoryOverflowTooltipPosition,
} from '../patientHistoryOverflowTooltipUtils.js';

const shockwaveCssUrl = new URL('../../styles/shockwave.css', import.meta.url);
const shockwaveViewUrl = new URL('../../components/shockwave/ShockwaveView.jsx', import.meta.url);
const patientHistoryEditableCellsUrl = new URL(
  '../../components/shockwave/PatientHistoryEditableCells.jsx',
  import.meta.url,
);
const patientHistoryFiltersUrl = new URL(
  '../../components/shockwave/PatientHistoryFilters.jsx',
  import.meta.url
);

async function readPatientHistoryRenderSource() {
  const [viewSource, editableCellsSource] = await Promise.all([
    readFile(shockwaveViewUrl, 'utf8'),
    readFile(patientHistoryEditableCellsUrl, 'utf8'),
  ]);
  return `${viewSource}\n${editableCellsSource}`;
}

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

test('patient history prescription and body filters render as unlabeled checkbox groups in that order', async () => {
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
  assert.match(
    patientHistoryFilters,
    /activeFilters=\{group\.activePrescriptionFilters\}[\s\S]*?tone="prescription"[\s\S]*?activeFilters=\{group\.activeBodyFilters\}[\s\S]*?tone="body"/
  );
  assert.doesNotMatch(patientHistoryFilters, /patient-history-filter-title/);
  assert.doesNotMatch(patientHistoryFilters, /label="(?:처방|부위)"/);
  assert.match(patientHistoryFilters, /getPatientHistoryFilterWidthWeight\(options\)/);
  assert.match(patientHistoryFilters, /--patient-history-filter-weight/);
  assert.match(shockwaveCss, /\.patient-history-filter-section--body\s*\{/);
  assert.match(shockwaveCss, /\.patient-history-filter-section--prescription\s*\{/);
  assert.doesNotMatch(shockwaveCss, /\.patient-history-filter-title/);
});

test('patient history exposes treatment tabs, selectable sorting, and treatment identity columns', async () => {
  const [shockwaveCss, shockwaveView] = await Promise.all([
    readFile(shockwaveCssUrl, 'utf8'),
    readFile(shockwaveViewUrl, 'utf8'),
  ]);

  assert.match(shockwaveView, /patientHistoryTreatmentTabOptions\.map/);
  assert.match(shockwaveView, /role="tablist"/);
  assert.match(shockwaveView, /role="tab"/);
  assert.match(shockwaveView, /patientHistoryTreatmentTab === 'all'/);
  assert.match(shockwaveView, /PATIENT_HISTORY_SORT_OPTIONS\.map/);
  assert.match(shockwaveView, /aria-label="스케줄 내역 정렬 기준"/);
  assert.match(shockwaveView, /patient-history-row-number-cell--\$\{historyTreatmentGroup\}/);
  assert.match(shockwaveView, />치료 구분<\/th>/);
  assert.match(shockwaveView, /patient-history-treatment-type-cell--\$\{historyTreatmentGroup\}/);
  assert.match(shockwaveCss, /\.patient-history-treatment-tab--shockwave\.is-active/);
  assert.match(shockwaveCss, /\.patient-history-treatment-tab--manual\.is-active/);
  assert.match(shockwaveCss, /\.patient-history-treatment-tab--shinjang\.is-active/);
  assert.match(shockwaveCss, /\.patient-history-treatment-type-cell--shinjang/);
  assert.match(shockwaveCss, /\.patient-history-row-number-cell--shinjang/);
  assert.match(
    shockwaveCss,
    /\.patient-history-treatment-tab\s*\{[^}]*border-radius:\s*9px 9px 0 0;[^}]*box-shadow:/s
  );
  assert.match(
    shockwaveCss,
    /\.patient-history-treatment-tab\.is-active\s*\{[^}]*border-top:\s*3px solid var\(--patient-history-tab-accent\);[^}]*font-size:\s*0\.86rem;/s
  );
  assert.match(
    shockwaveCss,
    /\.patient-history-treatment-tabs:has\(\.patient-history-treatment-tab--shinjang\.is-active\)\s*\{[^}]*border-bottom-color:\s*#0891b2;/s
  );
});

test('patient history group count follows the title in a larger compact format', async () => {
  const [shockwaveCss, shockwaveView] = await Promise.all([
    readFile(shockwaveCssUrl, 'utf8'),
    readFile(shockwaveViewUrl, 'utf8'),
  ]);
  const titleRowRule = shockwaveCss.match(
    /\.patient-history-group-title-row\s*\{([^}]*)\}/s
  )?.[1] || '';
  const countRule = shockwaveCss.match(
    /\.patient-history-group-count\s*\{([^}]*)\}/s
  )?.[1] || '';

  assert.match(
    shockwaveView,
    /\(\{group\.logs\.length\}\/\{group\.totalLogs\.length\}\)건/
  );
  assert.match(titleRowRule, /justify-content:\s*flex-start;/);
  assert.match(titleRowRule, /gap:\s*4px;/);
  assert.match(countRule, /font-size:\s*0\.76rem;/);
  assert.match(countRule, /white-space:\s*nowrap;/);
});

test('patient history filter cells keep body gray and prescription purple backgrounds', async () => {
  const shockwaveCss = await readFile(shockwaveCssUrl, 'utf8');
  const bodySectionRule = shockwaveCss.match(
    /\.patient-history-filter-section--body\s*\{([^}]*)\}/s
  )?.[1] || '';
  const prescriptionSectionRule = shockwaveCss.match(
    /\.patient-history-filter-section--prescription\s*\{([^}]*)\}/s
  )?.[1] || '';
  const bodyOptionRule = shockwaveCss.match(
    /\.patient-history-filter-section--body \.patient-history-filter-option\s*\{([^}]*)\}/s
  )?.[1] || '';
  const prescriptionOptionRule = shockwaveCss.match(
    /\.patient-history-filter-section--prescription \.patient-history-filter-option\s*\{([^}]*)\}/s
  )?.[1] || '';
  const bodyCheckedRule = shockwaveCss.match(
    /\.patient-history-filter-section--body \.patient-history-filter-option\.is-checked\s*\{([^}]*)\}/s
  )?.[1] || '';
  const prescriptionCheckedRule = shockwaveCss.match(
    /\.patient-history-filter-section--prescription \.patient-history-filter-option\.is-checked\s*\{([^}]*)\}/s
  )?.[1] || '';

  assert.match(bodySectionRule, /background:\s*#f1f5f9;/);
  assert.match(bodyOptionRule, /background:\s*#f1f5f9;/);
  assert.match(bodyCheckedRule, /background:\s*#f1f5f9;/);
  assert.match(prescriptionSectionRule, /background:\s*#f3e8ff;/);
  assert.match(prescriptionOptionRule, /background:\s*#f3e8ff;/);
  assert.match(prescriptionCheckedRule, /background:\s*#f3e8ff;/);
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
  assert.match(sectionRule, /display:\s*block;/);
  assert.doesNotMatch(sectionRule, /grid-template-columns:/);
  assert.match(sectionRule, /flex-grow:\s*var\(--patient-history-filter-weight, 1\);/);
  assert.match(sectionRule, /flex-shrink:\s*1;/);
  assert.match(sectionRule, /flex-basis:\s*0;/);
  assert.match(sectionRule, /box-sizing:\s*border-box;/);
  assert.match(sectionRule, /padding:\s*2px;/);
  assert.match(optionsRule, /flex-wrap:\s*wrap;/);
  assert.match(optionsRule, /align-content:\s*flex-start;/);
  assert.match(optionsRule, /box-sizing:\s*border-box;/);
  assert.match(optionsRule, /width:\s*100%;/);
  assert.match(optionsRule, /max-height:\s*41px;/);
  assert.match(optionsRule, /column-gap:\s*1px;/);
  assert.match(optionsRule, /row-gap:\s*2px;/);
  assert.match(optionRule, /flex:\s*0 0 auto;/);
  assert.match(optionRule, /min-height:\s*19px;/);
  assert.match(optionRule, /gap:\s*1px;/);
  assert.match(optionRule, /padding:\s*1px;/);
  assert.match(optionRule, /font-size:\s*0\.80rem;/);
  assert.match(countRule, /display:\s*inline-flex;/);
  assert.match(countRule, /align-items:\s*center;/);
  assert.match(countRule, /justify-content:\s*center;/);
  assert.match(countRule, /padding:\s*1px;/);
  assert.match(countRule, /font-size:\s*0\.80rem;/);
  assert.match(countRule, /line-height:\s*1;/);
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

test('patient history tables use a stronger scoped line color throughout', async () => {
  const [shockwaveCss, shockwaveView] = await Promise.all([
    readFile(shockwaveCssUrl, 'utf8'),
    readFile(shockwaveViewUrl, 'utf8'),
  ]);
  const tableCellRule = shockwaveCss.match(
    /\.patient-history-table\.sw-summary-table th,[\s\S]*?\.patient-history-table\.sw-compact-summary-table td\s*\{([^}]*)\}/
  )?.[1] || '';
  const groupHeaderRule = shockwaveCss.match(
    /\.patient-history-group-header\s*\{([^}]*)\}/s
  )?.[1] || '';
  const numberCellRule = shockwaveCss.match(
    /\.patient-history-table \.patient-history-row-number-cell\s*\{([^}]*)\}/s
  )?.[1] || '';

  assert.match(shockwaveView, /'--patient-history-border-color': '#c5cfdb'/);
  assert.match(
    shockwaveView,
    /border: '1px solid var\(--patient-history-border-color, #c5cfdb\)'/
  );
  assert.match(tableCellRule, /border-right-color:\s*var\(--patient-history-border-color, #c5cfdb\)\s*!important;/);
  assert.match(tableCellRule, /border-bottom-color:\s*var\(--patient-history-border-color, #c5cfdb\)\s*!important;/);
  assert.match(groupHeaderRule, /border-bottom:\s*1px solid var\(--patient-history-border-color, #c5cfdb\);/);
  assert.match(numberCellRule, /border-right:\s*1px solid var\(--patient-history-border-color, #c5cfdb\);/);
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
  assert.match(currentRowCellsRule, /rgba\(37, 99, 235, 0\.46\)/);
  assert.match(currentRowCellsRule, /height:\s*23px;/);
  assert.match(currentRowCellsRule, /padding-top:\s*3px\s*!important;/);
  assert.match(currentRowCellsRule, /padding-bottom:\s*3px\s*!important;/);
  assert.match(currentRowNumberRule, /border-left:\s*2px solid/);
  assert.match(currentRowNumberRule, /rgba\(37, 99, 235, 0\.46\)/);
  assert.match(currentRowLastCellRule, /border-right:\s*2px solid/);
  assert.match(currentRowLastCellRule, /rgba\(37, 99, 235, 0\.46\)/);
  assert.doesNotMatch(shockwaveView, /outline:\s*isCurrentHistoryRow/);
});

test('current patient history row uses light treatment-specific backgrounds', async () => {
  const shockwaveView = await readFile(shockwaveViewUrl, 'utf8');

  assert.match(
    shockwaveView,
    /historyTreatmentGroup === 'manual'/
  );
  assert.match(shockwaveView, /\? '#fff1e3'/);
  assert.match(shockwaveView, /\? '#ecfdf5'/);
  assert.match(shockwaveView, /: '#e6f6fe'/);
  assert.doesNotMatch(shockwaveView, /#fedfbb|#c8ebfd/);
});

test('patient history edit fields keep a flat base style until focused', async () => {
  const [shockwaveCss, shockwaveView] = await Promise.all([
    readFile(shockwaveCssUrl, 'utf8'),
    readPatientHistoryRenderSource(),
  ]);
  const editFieldRule = shockwaveCss.match(
    /\.patient-history-table \.patient-history-edit-field\s*\{([^}]*)\}/s
  )?.[1] || '';
  const editFieldFocusRule = shockwaveCss.match(
    /\.patient-history-table \.patient-history-edit-field:focus:not\(:disabled\)\s*\{([^}]*)\}/s
  )?.[1] || '';

  assert.equal(
    shockwaveView.match(/className=(?:"patient-history-edit-field|\{`patient-history-edit-field)/g)?.length,
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

test('patient history selection and clipboard outlines stay on the inner detail field', async () => {
  const [shockwaveCss, shockwaveView] = await Promise.all([
    readFile(shockwaveCssUrl, 'utf8'),
    readPatientHistoryRenderSource(),
  ]);
  const selectedCellRule = shockwaveCss.match(
    /\.patient-history-table \.patient-history-data-cell--selectable\.is-selected\s*\{([^}]*)\}/s
  )?.[1] || '';
  const selectedFieldRule = shockwaveCss.match(
    /\.patient-history-table \.patient-history-data-cell--selectable\.is-selected \.patient-history-edit-field--detail\s*\{([^}]*)\}/s
  )?.[1] || '';
  const clipboardFieldRule = shockwaveCss.match(
    /\.patient-history-table \.patient-history-data-cell--selectable\.is-clipboard-source \.patient-history-edit-field--detail\s*\{([^}]*)\}/s
  )?.[1] || '';
  const clipboardOverlayRule = shockwaveCss.match(
    /\.patient-history-table \.patient-history-data-cell--selectable\.is-clipboard-source \.patient-history-overflow-field::after\s*\{([^}]*)\}/s
  )?.[1] || '';

  assert.match(selectedCellRule, /box-shadow:\s*none\s*!important;/);
  assert.match(selectedFieldRule, /border-color:\s*#2563eb\s*!important;/);
  assert.match(selectedFieldRule, /background-color:\s*rgba\(239, 246, 255, 0\.94\)\s*!important;/);
  assert.match(selectedFieldRule, /box-shadow:\s*inset 0 0 0 1px #2563eb\s*!important;/);
  assert.match(clipboardFieldRule, /border-color:\s*#2563eb\s*!important;/);
  assert.match(clipboardOverlayRule, /border:\s*2px dashed #2563eb;/);
  assert.match(clipboardOverlayRule, /pointer-events:\s*none;/);
  assert.equal(shockwaveView.match(/patientHistoryClipboardCell\?\.id ===/g)?.length, 3);
});

test('patient history cell clipboard keeps an immediate selected-cell reference', async () => {
  const cellInteractions = await readFile(
    new URL('../../components/shockwave/usePatientHistoryCellInteractions.js', import.meta.url),
    'utf8',
  );

  assert.match(cellInteractions, /const selectedCellRef = useRef\(null\);/);
  assert.match(
    cellInteractions,
    /selectedCellRef\.current = primaryCell;\s*setSelectedCell\(primaryCell\);/,
  );
  assert.match(cellInteractions, /const activeCell = selectedCellRef\.current;\s*if \(!activeCell\) return;/);
  assert.match(
    cellInteractions,
    /if \(isPatientHistoryCellClearShortcut\(event\)\)[\s\S]*?clearSelectedCell\(\);/,
  );
  assert.match(cellInteractions, /if \(!modalOpen\) return undefined;/);
  assert.match(cellInteractions, /window\.addEventListener\('copy', handleClipboardWrite, true\);/);
  assert.match(cellInteractions, /window\.addEventListener\('cut', handleClipboardWrite, true\);/);
  assert.match(cellInteractions, /event\.clipboardData\?\.setData\('text\/plain', nextClipboard\.plainText\);/);
  assert.match(cellInteractions, /window\.addEventListener\('mousedown', handleOutsideMouseDown, true\);/);
  assert.match(
    cellInteractions,
    /if \(!selectedCellRef\.current && !clipboardRef\.current\) return;\s*clearCellSelection\(\{ clearClipboard: true \}\);/,
  );
  assert.match(
    cellInteractions,
    /if \(isPatientHistoryCellEditorShortcut\(event\)\)[\s\S]*?if \(activeCell\.field !== 'body_part'\)[\s\S]*?beginInlineCellEdit\(activeCell, cellElement\);[\s\S]*?openEditorAtRect\(activeCell, cellElement\.getBoundingClientRect\(\)\);/,
  );
  assert.match(
    cellInteractions,
    /if \(isUndoShortcutEvent\(event\)\)[\s\S]*?undoLastHistoryChange\(\);/,
  );
  assert.match(
    cellInteractions,
    /recordHistoryUndo\(\[[\s\S]*?previousValue: sourcePreviousValue,[\s\S]*?clearClipboardCell\(\);/,
  );
  assert.doesNotMatch(
    cellInteractions,
    /const clipboardMode = getPatientHistoryCellClipboardMode\(event\);[\s\S]{0,120}event\.preventDefault\(\);/,
  );
});

test('patient history cells support range selection, direct typing, and fill handles', async () => {
  const [shockwaveView, cellInteractions, dragInteractions, shockwaveCss] = await Promise.all([
    readPatientHistoryRenderSource(),
    readFile(
      new URL('../../components/shockwave/usePatientHistoryCellInteractions.js', import.meta.url),
      'utf8',
    ),
    readFile(
      new URL('../../components/shockwave/usePatientHistoryDragInteractions.js', import.meta.url),
      'utf8',
    ),
    readFile(shockwaveCssUrl, 'utf8'),
  ]);

  assert.match(cellInteractions, /const directInputText = getPatientHistoryCellDirectInputText\(event\);/);
  assert.match(
    cellInteractions,
    /beginInlineCellEdit\(activeCell, cellElement, \{ initialText: directInputText \}\);/,
  );
  assert.match(dragInteractions, /const updateRangeSelectionTarget = useCallback/);
  assert.match(dragInteractions, /targetIndex === drag\.targetIndex/);
  assert.match(dragInteractions, /setCellSelection\(cells, drag\.sourceCell\);/);
  assert.match(dragInteractions, /buildPatientHistoryCellFillValues\([\s\S]*?drag\.targetCells\.length/);
  assert.match(dragInteractions, /runPatientHistoryTasksWithConcurrency\(/);
  assert.match(dragInteractions, /rollbackSucceeded/);
  assert.equal(shockwaveView.match(/startPatientHistoryCellRangeSelection\(event,/g)?.length, 3);
  assert.equal(shockwaveView.match(/className="patient-history-fill-handle"/g)?.length, 3);
  assert.match(shockwaveView, /startPatientHistoryCellFill\(event, bodyPartHistoryCell\)/);
  assert.match(shockwaveView, /startPatientHistoryCellFill\(event, memoHistoryCell\)/);
  assert.match(shockwaveView, /startPatientHistoryCellFill\(event, visitHistoryCell\)/);
  assert.match(
    shockwaveCss,
    /\.patient-history-fill-handle\s*\{[^}]*width:\s*6px;[^}]*height:\s*6px;/s,
  );
  assert.match(
    shockwaveCss,
    /\.patient-history-data-cell--selectable\.is-fill-preview \.patient-history-edit-field--detail/s,
  );
  assert.match(
    shockwaveCss,
    /\.patient-history-table tbody tr:hover > td,\s*\.patient-history-table tbody tr\.patient-history-row--hovered > td\s*\{\s*background-color:\s*#94a3b8 !important;\s*\}/,
  );
  assert.match(shockwaveView, /classList\.add\('patient-history-row--hovered'\)/);
  assert.match(shockwaveView, /classList\.remove\('patient-history-row--hovered'\)/);
  assert.match(
    shockwaveCss,
    /:has\(\.patient-history-data-cell--selectable\.is-selected\) > td,[\s\S]*?:has\(\.patient-history-data-cell--selectable\.is-fill-preview\) > td[\s\S]*?background-color:\s*#cbd5e1 !important;/s,
  );
  assert.doesNotMatch(
    shockwaveCss,
    /\.patient-history-table tbody tr:hover\s+\.patient-history-edit-field--inset/,
  );
});

test('patient history clipboard outline survives selecting a paste target', async () => {
  const dragInteractions = await readFile(
    new URL('../../components/shockwave/usePatientHistoryDragInteractions.js', import.meta.url),
    'utf8',
  );
  const startRangeSelection = dragInteractions.match(
    /const startRangeSelection = useCallback\(\(event, cell\) => \{([\s\S]*?)\n\s{2}\}, \[/,
  )?.[1] || '';

  assert.match(startRangeSelection, /setCellSelection\(\[cell\], cell\);/);
  assert.doesNotMatch(startRangeSelection, /clearClipboardCell\(\);/);
});

test('patient history memo and visit double click activate inline field editors', async () => {
  const [shockwaveView, cellInteractions, shockwaveCss, overflowField] = await Promise.all([
    readPatientHistoryRenderSource(),
    readFile(
      new URL('../../components/shockwave/usePatientHistoryCellInteractions.js', import.meta.url),
      'utf8',
    ),
    readFile(shockwaveCssUrl, 'utf8'),
    readFile(
      new URL('../../components/shockwave/PatientHistoryOverflowField.jsx', import.meta.url),
      'utf8',
    ),
  ]);

  assert.match(
    cellInteractions,
    /if \(cell\.field !== 'body_part'\) \{\s*beginInlineCellEdit\(cell, event\.currentTarget\);\s*return;/,
  );
  assert.match(cellInteractions, /field\.focus\(\{ preventScroll: true \}\);/);
  assert.match(cellInteractions, /\['memo', 'visit_count'\]\.includes\(cell\?\.field\)/);
  assert.match(
    shockwaveView,
    /readOnly=\{!isMemoInlineEditing\}[\s\S]*?onChange=\{\(event\) =>[\s\S]*?formatPatientHistoryMemoEditDraft[\s\S]*?updatePatientHistoryInlineCellDraft/,
  );
  assert.match(shockwaveView, /window\.requestAnimationFrame\(\(\) => \{/);
  assert.match(shockwaveView, /activeMemoLineCount = isMemoInlineEditing/);
  assert.match(
    shockwaveView,
    /event\.key === 'Enter' && !event\.altKey && !isComposing[\s\S]*?insertPatientHistoryMemoLineBreak/,
  );
  assert.match(
    shockwaveView,
    /event\.key === 'Backspace'[\s\S]*?removeEmptyPatientHistoryMemoLine[\s\S]*?field\.setSelectionRange/,
  );
  assert.match(shockwaveView, /event\.nativeEvent\?\.isComposing/);
  assert.match(
    shockwaveView,
    /onBlur=\{\(event\) =>[\s\S]*?commitPatientHistoryInlineCellEdit/,
  );
  assert.match(
    shockwaveCss,
    /\.patient-history-edit-field--inline-editing\s*\{[^}]*pointer-events:\s*auto;[^}]*cursor:\s*text;[^}]*user-select:\s*text;/s,
  );
  assert.match(overflowField, /if \(disabled\) \{\s*hideTooltip\(\);\s*return;/);
  assert.equal(
    shockwaveView.match(/<PatientHistoryOverflowField\s+disabled/g)?.length,
    3,
  );
  assert.doesNotMatch(shockwaveView, /disabled=\{isMemoInlineEditing\}/);
  assert.match(
    shockwaveView,
    /className="patient-history-body-part-menu-trigger"[\s\S]*?onMouseEnter=\{\(event\) => openPatientHistoryCellEditor\(event, bodyPartHistoryCell\)\}/,
  );
  assert.match(
    shockwaveCss,
    /\.patient-history-body-part-menu-trigger::before\s*\{[^}]*border-left:\s*6px solid #475569;[^}]*\}/s,
  );
  assert.match(shockwaveView, /field: 'visit_count',[\s\S]*?canEdit: true/);
  assert.match(shockwaveView, /readOnly=\{!isVisitInlineEditing\}/);
  assert.match(shockwaveView, /data-patient-history-field=\{visitHistoryCell\.field\}/);
  assert.match(
    shockwaveView,
    /<PatientHistoryOverflowField disabled value=\{activeVisitCountValue\}>/,
  );
  assert.match(
    cellInteractions,
    /const navigationDirection = getPatientHistoryCellNavigationDirection\(event\);[\s\S]*?moveSelectedCell\(navigationDirection\)/,
  );
  assert.match(cellInteractions, /direction === 'ArrowLeft' \|\| direction === 'ArrowRight'/);
  assert.match(cellInteractions, /direction === 'ArrowUp' \? -1 : 1/);
});

test('patient history search autofocus runs only when the modal opens', async () => {
  const shockwaveView = await readFile(shockwaveViewUrl, 'utf8');
  const focusEffect = shockwaveView.match(
    /useEffect\(\(\) => \{\s*if \(!patientHistoryModalOpen\) return;\s*const focusFrame = requestAnimationFrame[\s\S]*?\}, \[patientHistoryModalOpen\]\);/,
  )?.[0] || '';

  assert.match(focusEffect, /patientHistorySearchInputRef\.current\?\.focus/);
  assert.match(focusEffect, /cancelAnimationFrame\(focusFrame\)/);
  assert.doesNotMatch(focusEffect, /dismissPatientHistoryCellInteraction/);
});

test('patient history clipboard shortcuts suspend the background schedule keyboard handlers', async () => {
  const [shockwaveView, keyboardActions, globalEvents] = await Promise.all([
    readFile(shockwaveViewUrl, 'utf8'),
    readFile(new URL('../../components/shockwave/useScheduleKeyboardActions.js', import.meta.url), 'utf8'),
    readFile(new URL('../../components/shockwave/useScheduleGlobalEvents.js', import.meta.url), 'utf8'),
  ]);

  assert.match(shockwaveView, /useScheduleKeyboardActions\(\{\s*disabled:\s*patientHistoryModalOpen,/);
  assert.match(shockwaveView, /useScheduleGlobalEvents\(\{\s*keyboardDisabled:\s*patientHistoryModalOpen,/);
  assert.match(keyboardActions, /const handleEarlyPrescriptionShortcut = \(event\) => \{\s*if \(disabled\) return;/);
  assert.match(keyboardActions, /return useCallback\(\(e\) => \{\s*if \(disabled\) return;/);
  assert.match(globalEvents, /const handleWindowKeyDown = \(event\) => \{\s*if \(keyboardDisabled\) return;/);
  assert.match(globalEvents, /const handlePasteEvent = \(event\) => \{\s*if \(keyboardDisabled\) return;/);
});

test('patient history escape dismisses cell interaction state before closing the modal', async () => {
  const [shockwaveView, cellInteractions] = await Promise.all([
    readFile(shockwaveViewUrl, 'utf8'),
    readFile(new URL('../../components/shockwave/usePatientHistoryCellInteractions.js', import.meta.url), 'utf8'),
  ]);

  assert.match(
    shockwaveView,
    /if \(dismissPatientHistoryCellInteraction\(\)\) return;\s*closePatientHistoryModal\(\);/,
  );
  assert.match(shockwaveView, /if \(patientHistoryModalOpen && e\.key === 'Escape'\) return;/);
  assert.match(cellInteractions, /if \(action === 'close-editor'\)[\s\S]*setContextMenu\(null\);[\s\S]*setActiveContextSubmenu\(null\);/);
  assert.match(cellInteractions, /if \(action === 'clear-clipboard'\)[\s\S]*setClipboardCell\(null\);/);
  assert.match(cellInteractions, /if \(action === 'clear-selection'\)[\s\S]*setSelectedCell\(null\);/);
});

test('patient history editable values use compact inset fields without changing type size', async () => {
  const [shockwaveCss, shockwaveView] = await Promise.all([
    readFile(shockwaveCssUrl, 'utf8'),
    readPatientHistoryRenderSource(),
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

test('patient history visit count fields show derived sequence background colors', async () => {
  const [shockwaveCss, shockwaveView] = await Promise.all([
    readFile(shockwaveCssUrl, 'utf8'),
    readPatientHistoryRenderSource(),
  ]);
  const sequenceFieldRule = shockwaveCss.match(
    /\.patient-history-table \.patient-history-visit-count-field\.has-visit-sequence\s*\{([^}]*)\}/s
  )?.[1] || '';
  const visitCountFieldRule = shockwaveCss.match(
    /\.patient-history-table \.patient-history-visit-count-field\s*\{([^}]*)\}/s
  )?.[1] || '';

  assert.match(shockwaveView, /const visitSequenceColor = group\.visitSequenceColors\?\.\[idx\] \|\| null;/);
  assert.match(shockwaveView, /patient-history-visit-count-field\$\{visitSequenceColor \? ' has-visit-sequence' : ''\}/);
  assert.match(shockwaveView, /'--patient-history-visit-sequence-bg': visitSequenceColor/);
  assert.match(visitCountFieldRule, /font-weight:\s*800\s*!important;/);
  assert.match(
    sequenceFieldRule,
    /background-color:\s*var\(--patient-history-visit-sequence-bg\)\s*!important;/
  );
});

test('patient history body and memo text use the shared content size with shorter data rows', async () => {
  const [shockwaveCss, shockwaveView] = await Promise.all([
    readFile(shockwaveCssUrl, 'utf8'),
    readPatientHistoryRenderSource(),
  ]);
  const tableCellRule = shockwaveCss.match(
    /\.patient-history-table\.sw-summary-table th,[\s\S]*?\.patient-history-table\.sw-compact-summary-table td\s*\{([^}]*)\}/s
  )?.[1] || '';
  const detailFieldRule = shockwaveCss.match(
    /\.patient-history-table \.patient-history-edit-field--detail\s*\{([^}]*)\}/s
  )?.[1] || '';

  assert.equal(
    shockwaveView.match(/patient-history-edit-field--detail/g)?.length,
    3
  );
  assert.match(detailFieldRule, /font-size:\s*0\.82rem\s*!important;/);
  assert.match(detailFieldRule, /overflow-y:\s*hidden\s*!important;/);
  assert.match(detailFieldRule, /resize:\s*none\s*!important;/);
  assert.match(tableCellRule, /padding:\s*1px 3px\s*!important;/);
  assert.match(tableCellRule, /height:\s*20px;/);
  assert.match(shockwaveView, /bodyPartTextareaRows === 1 \? '19px'/);
  assert.match(shockwaveView, /activeMemoTextareaRows === 1 \? '19px'/);
  assert.doesNotMatch(shockwaveView, /resize:\s*activeMemoTextareaRows/);
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
  const currentPrescriptionFieldRule = shockwaveCss.match(
    /\.patient-history-table tbody tr\.patient-history-current-row \.patient-history-edit-field--prescription\s*\{([^}]*)\}/s
  )?.[1] || '';
  const prescriptionOptionRule = shockwaveCss.match(
    /\.patient-history-table \.patient-history-edit-field--prescription option\s*\{([^}]*)\}/s
  )?.[1] || '';

  assert.match(prescriptionSelect, /patient-history-edit-field--prescription/);
  assert.match(prescriptionSelect, /appearance:\s*'none'/);
  assert.match(prescriptionSelect, /backgroundPosition:\s*'right 3px center'/);
  assert.match(prescriptionSelect, /backgroundSize:\s*'6px 4px'/);
  assert.match(prescriptionSelect, /padding:\s*'2px 11px 2px 5px'/);
  assert.match(prescriptionFieldRule, /font-size:\s*0\.82rem\s*!important;/);
  assert.match(prescriptionFieldRule, /font-weight:\s*800\s*!important;/);
  assert.match(prescriptionFieldRule, /text-align:\s*center;/);
  assert.match(prescriptionFieldRule, /text-align-last:\s*center;/);
  assert.match(currentPrescriptionFieldRule, /font-size:\s*0\.86rem\s*!important;/);
  assert.match(currentPrescriptionFieldRule, /font-weight:\s*900\s*!important;/);
  assert.match(prescriptionOptionRule, /text-align:\s*left;/);
  assert.match(prescriptionOptionRule, /text-align-last:\s*left;/);
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

test('patient history date cells expose single-click schedule navigation and selection', async () => {
  const patientHistoryActionsUrl = new URL(
    '../../components/shockwave/usePatientHistoryActions.js',
    import.meta.url
  );
  const [shockwaveCss, shockwaveView, patientHistoryActions] = await Promise.all([
    readFile(shockwaveCssUrl, 'utf8'),
    readFile(shockwaveViewUrl, 'utf8'),
    readFile(patientHistoryActionsUrl, 'utf8'),
  ]);
  const dateCellRule = shockwaveCss.match(
    /\.patient-history-table \.patient-history-date-cell\s*\{([^}]*)\}/s
  )?.[1] || '';

  assert.match(shockwaveView, /className="patient-history-date-cell"/);
  assert.match(shockwaveView, /onClick=\{\(\) => handlePatientHistoryDateClick\(log\)\}/);
  assert.doesNotMatch(shockwaveView, /handlePatientHistoryDateDoubleClick/);
  assert.match(shockwaveView, /targetDate:\s*pendingPatientHistoryNavigation\?\.date \|\| null/);
  assert.match(shockwaveView, /selectSingleCell\(normalizedCell, \{ normalize: false \}\)/);
  assert.doesNotMatch(shockwaveView, /document\.getElementById\(`cell-\$\{targetKey\}`\)\?\.scrollIntoView/);
  assert.match(shockwaveView, /onTargetDateScrolled:\s*handlePatientHistoryDateScrollComplete/);
  assert.match(patientHistoryActions, /scheduler_cell_key:\s*getScheduleRowSchedulerCellKey\(s\)/);
  assert.match(dateCellRule, /cursor:\s*pointer;/);
});
