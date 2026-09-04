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
});
