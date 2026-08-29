import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const indexCssUrl = new URL('../../styles/index.css', import.meta.url);
const refinementsCssUrl = new URL('../../styles/shockwave_stats_refinements.css', import.meta.url);
const shockwaveSettlementUrl = new URL(
  '../../components/shockwave/ShockwaveSettlementView.jsx',
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
});
