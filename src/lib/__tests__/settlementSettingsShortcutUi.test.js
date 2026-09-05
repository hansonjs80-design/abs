import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const panelUrl = new URL(
  '../../components/shockwave/SettlementSettingsPanel.jsx',
  import.meta.url
);
const stateUrl = new URL(
  '../../components/shockwave/useScheduleViewState.js',
  import.meta.url
);
const stylesUrl = new URL('../../styles/shockwave_stats_reports.css', import.meta.url);

test('settlement prescription rows expose cryo selection before base and cryo prices', async () => {
  const [panel, styles] = await Promise.all([
    readFile(panelUrl, 'utf8'),
    readFile(stylesUrl, 'utf8'),
  ]);
  const cryoHeaderIndex = panel.indexOf('>크라이오</span>');
  const basePriceHeaderIndex = panel.indexOf('>단가</span>');
  const cryoPriceHeaderIndex = panel.indexOf('>크라이오 가격</span>');

  assert.ok(cryoHeaderIndex >= 0);
  assert.ok(cryoHeaderIndex < basePriceHeaderIndex);
  assert.ok(basePriceHeaderIndex < cryoPriceHeaderIndex);
  assert.match(panel, /checked=\{isCryoEnabled\}/);
  assert.match(panel, /cryo_prescriptions:\s*Array\.from\(next\)/);
  assert.match(panel, /aria-label=\{`\$\{prescription\} 크라이오 가격`\}/);
  assert.match(panel, /disabled=\{!isCryoEnabled\}/);
  assert.match(panel, /cryo_prices:\s*cleanedCryoPrices/);
  assert.match(styles, /\.settlement-cryo-toggle\s*\{/);
  assert.match(styles, /\.settlement-cryo-price-input:disabled\s*\{/);
});

test('manual therapy shortcut settings show Alt or Option and accept digits only', async () => {
  const [panel, viewState] = await Promise.all([
    readFile(panelUrl, 'utf8'),
    readFile(stateUrl, 'utf8'),
  ]);

  assert.match(panel, /isAppleShortcutPlatform \? 'Option\+' : 'Alt\+'/);
  assert.ok(
    panel.includes('const allowedPattern = isManualTherapy ? /[^1-9]/g : /[^1-9A-Z]/g;')
  );
  assert.match(panel, /title=\{shortcutTitle\}/);
  assert.match(viewState, /manualPrescriptionModifier: isAppleShortcutPlatform \? '⌥' : 'Alt'/);
  assert.match(viewState, /shinjangPrescriptionModifier: isAppleShortcutPlatform \? '⌘⇧' : 'Ctrl\+Shift'/);
});
