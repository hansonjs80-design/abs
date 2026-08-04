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

test('current status print removes screen-only sticky table positioning', async () => {
  const globalStyles = await readFile(globalStylesUrl, 'utf8');

  assert.match(
    globalStyles,
    /\.sw-stats-body--grid \.sw-grid-table td\s*\{[\s\S]*?position:\s*static !important;[\s\S]*?z-index:\s*auto !important;[\s\S]*?will-change:\s*auto !important;/
  );
});
