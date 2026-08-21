import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const bodyPartPanelUrl = new URL(
  '../../components/shockwave/BodyPartKeyboardPanel.jsx',
  import.meta.url
);
const cssUrl = new URL('../../styles/shockwave.css', import.meta.url);

test('context menu body-part checkbox rows use stronger hover backgrounds', async () => {
  const [bodyPartPanel, css] = await Promise.all([
    readFile(bodyPartPanelUrl, 'utf8'),
    readFile(cssUrl, 'utf8'),
  ]);

  assert.match(bodyPartPanel, /context-menu-check-item/);
  assert.match(
    css,
    /\.context-menu-check-item:hover:not\(\.is-checked\)\s*\{[^}]*background:\s*#e5e7eb;/s
  );
  assert.match(
    css,
    /\.context-menu-check-item\.is-checked:hover\s*\{[^}]*background:\s*#e5e7eb;/s
  );
});
