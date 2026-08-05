import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const dataGridUrl = new URL(
  '../../components/shockwave/ShockwaveDataGrid.jsx',
  import.meta.url
);
const statsGridCssUrl = new URL(
  '../../styles/shockwave_stats_grid.css',
  import.meta.url
);
const globalStylesUrl = new URL(
  '../../styles/index.css',
  import.meta.url
);
const printButtonUrl = new URL(
  '../../components/common/PrintButton.jsx',
  import.meta.url
);

test('grand total prescription tooltip uses each configured prescription color lightly', async () => {
  const [dataGrid, statsGridCss] = await Promise.all([
    readFile(dataGridUrl, 'utf8'),
    readFile(statsGridCssUrl, 'utf8'),
  ]);

  assert.match(
    dataGrid,
    /count:\s*prescriptionCounts\[prescription\],[\s\S]*?prescriptionColor:\s*getPrescriptionColor\(\s*prescription,\s*effectivePrescriptionColors\s*\)/
  );
  assert.match(
    statsGridCss,
    /\.sw-grid-count-tooltip--list\s*\.sw-grid-count-tooltip-item--prescription-color\s*\{[\s\S]*?background:\s*color-mix\(\s*in srgb,\s*var\(--prescription-cell-color, #64748b\) 14%,\s*#fff\s*\);/
  );
});

test('current status print releases the page-level scroll container', async () => {
  const globalStyles = await readFile(globalStylesUrl, 'utf8');

  assert.match(
    globalStyles,
    /body\.stats-grid-print \.animate-fade-in,[\s\S]*?height:\s*auto !important;[\s\S]*?overflow:\s*visible !important;/
  );
});

test('current status print uses an isolated print document', async () => {
  const [printButton, globalStyles] = await Promise.all([
    readFile(printButtonUrl, 'utf8'),
    readFile(globalStylesUrl, 'utf8'),
  ]);

  assert.match(
    printButton,
    /function prepareStatsGridPrintFrame\(orientation, margin\)[\s\S]*?sourceGrid\.outerHTML[\s\S]*?printWindow\.print\(\)/
  );
  assert.match(
    globalStyles,
    /body\.stats-grid-print \.sw-stats-panel > :not\(\.sw-stats-body--grid\)\s*\{[\s\S]*?display:\s*none !important;/
  );
});

test('current status print repeats the complete table header on every page', async () => {
  const printButton = await readFile(printButtonUrl, 'utf8');

  assert.match(
    printButton,
    /\.sw-grid-table thead\s*\{[\s\S]*?display:\s*table-header-group !important;[\s\S]*?break-after:\s*avoid !important;/
  );
  assert.match(
    printButton,
    /\.sw-grid-table thead > tr\s*\{[\s\S]*?display:\s*table-row !important;[\s\S]*?page-break-inside:\s*avoid !important;/
  );
});

test('current status print uses clear table borders and wraps one-prescription therapist counts', async () => {
  const [dataGrid, printButton] = await Promise.all([
    readFile(dataGridUrl, 'utf8'),
    readFile(printButtonUrl, 'utf8'),
  ]);

  assert.match(
    printButton,
    /\.sw-grid-table \{[\s\S]*?border:\s*0\.45mm solid #1e293b !important;/
  );
  assert.match(
    printButton,
    /\.sw-grid-table td \{[\s\S]*?border:\s*0\.25mm solid #64748b !important;[\s\S]*?text-align:\s*center !important;/
  );
  assert.match(
    printButton,
    /\.sw-grid-table \.therapist-group-start,[\s\S]*?border-left:\s*0\.4mm solid #334155 !important;/
  );
  assert.match(
    printButton,
    /\.sw-grid-table \.tr-date-start td\s*\{[\s\S]*?border-top:\s*0\.4mm solid #334155 !important;/
  );
  assert.match(
    printButton,
    /\.sw-grid-table \.sw-header-row-therapists > th:nth-child\(6\),[\s\S]*?text-align:\s*left !important;/
  );
  assert.match(dataGrid, /const hasSinglePrescription = group\.prescriptions\.length === 1;/);
  assert.match(dataGrid, /hdr-therapist--single-prescription/);
  assert.match(dataGrid, /sw-grid-therapist-count/);
  assert.match(
    printButton,
    /html\[data-print-orientation="portrait"\] \.sw-grid-table \.hdr-therapist--single-prescription \.sw-grid-therapist-count\s*\{[\s\S]*?display:\s*block !important;[\s\S]*?white-space:\s*nowrap !important;/
  );
});

test('portrait current status print wraps compact cells without shrinking totals below readability', async () => {
  const printButton = await readFile(printButtonUrl, 'utf8');

  assert.match(
    printButton,
    /html\[data-print-orientation="portrait"\] \.sw-grid-table th,[\s\S]*?white-space:\s*normal !important;[\s\S]*?overflow-wrap:\s*anywhere !important;/
  );
  assert.match(
    printButton,
    /html\[data-print-orientation="portrait"\] \.sw-grid-table \.sw-grid-summary-main-number,[\s\S]*?font-size:\s*6\.8pt !important;/
  );
  assert.match(
    printButton,
    /html\[data-print-orientation="portrait"\] \.sw-grid-table \.gc-bold\s*\{[\s\S]*?padding:\s*0\.45mm 0\.35mm !important;[\s\S]*?text-align:\s*center !important;/
  );
});

test('current status print removes screen-only sticky table positioning', async () => {
  const globalStyles = await readFile(globalStylesUrl, 'utf8');

  assert.match(
    globalStyles,
    /\.sw-stats-body--grid \.sw-grid-table td\s*\{[\s\S]*?position:\s*static !important;[\s\S]*?z-index:\s*auto !important;[\s\S]*?will-change:\s*auto !important;/
  );
});
