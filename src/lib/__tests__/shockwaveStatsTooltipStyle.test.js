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

test('current status print uses an isolated copy outside the app layout', async () => {
  const [printButton, globalStyles] = await Promise.all([
    readFile(printButtonUrl, 'utf8'),
    readFile(globalStylesUrl, 'utf8'),
  ]);

  assert.match(
    printButton,
    /function prepareStatsGridPrintRoot\(\)[\s\S]*?sourceGrid\.cloneNode\(true\)[\s\S]*?document\.body\.appendChild\(printRoot\)/
  );
  assert.match(
    globalStyles,
    /body\.stats-grid-print #root\s*\{[\s\S]*?display:\s*none !important;[\s\S]*?body\.stats-grid-print \.stats-grid-print-root\s*\{[\s\S]*?display:\s*block !important;/
  );
});
