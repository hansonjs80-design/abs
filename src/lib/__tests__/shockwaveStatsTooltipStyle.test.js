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
