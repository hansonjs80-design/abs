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

test('manual therapy shortcut settings show Ctrl or Cmd and accept digits and letters', async () => {
  const [panel, viewState] = await Promise.all([
    readFile(panelUrl, 'utf8'),
    readFile(stateUrl, 'utf8'),
  ]);

  assert.match(panel, /isAppleShortcutPlatform \? 'Cmd\+' : 'Ctrl\+'/);
  assert.ok(
    panel.includes('const allowedPattern = /[^1-9A-Z]/g;')
  );
  assert.match(panel, /title=\{shortcutTitle\}/);
  assert.match(viewState, /manualPrescriptionModifier: isAppleShortcutPlatform \? '⌘' : 'Ctrl'/);
  assert.match(viewState, /shinjangPrescriptionModifier: isAppleShortcutPlatform \? '⌥' : 'Alt'/);
});

test('shockwave and manual therapy setting headers share the same fixed action column geometry as their rows', async () => {
  const styles = await readFile(stylesUrl, 'utf8');

  assert.match(
    styles,
    /\.shockwave-row,\s*\.manual-therapy-row\s*\{[^}]*grid-template-columns:[^;}]*36px 70px;/s
  );
  assert.match(
    styles,
    /\.settlement-settings-header-row\s*\{[^}]*border:\s*1px solid transparent;[^}]*padding:\s*0 8px;/s
  );
  assert.doesNotMatch(
    styles,
    /\.(?:shockwave|manual-therapy)-row\s*\{[^}]*grid-template-columns:[^;}]*36px auto;/s
  );
});

test('settlement prescription name editing keeps the row stable until blur commits the rename', async () => {
  const panel = await readFile(panelUrl, 'utf8');

  assert.match(panel, /const \[prescriptionNameDrafts, setPrescriptionNameDrafts\] = useState\(\{\}\);/);
  assert.match(panel, /value=\{prescriptionNameDrafts\[prescription\] \?\? prescription\}/);
  assert.match(panel, /onChange=\{\(event\) => updatePrescriptionNameDraft\(prescription, event\.target\.value\)\}/);
  assert.match(panel, /onBlur=\{\(event\) => renamePrescription\(index, event\.target\.value, prescription\)\}/);
  assert.doesNotMatch(panel, /const updatePrescriptionDraftName/);
  assert.doesNotMatch(panel, /renamePrescription\(index, event\.currentTarget\.value\);\s*event\.currentTarget\.blur\(\);/);
});
