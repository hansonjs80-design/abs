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
  assert.match(
    css,
    /\.context-menu-body-preset-list\s*\{[^}]*gap:\s*2\.1px;/s
  );
  assert.match(
    css,
    /\.context-menu-body-presets\s*\{[^}]*gap:\s*6px;[^}]*margin-bottom:\s*8px;[^}]*padding:\s*0 12px 4px 12px !important;/s
  );
  assert.match(
    css,
    /\.context-menu-body-preset-title\s*\{[^}]*margin:\s*0 0 3\.5px;/s
  );
  assert.match(
    css,
    /\.context-menu-body-preset-item\s*\{[^}]*padding:\s*3px 2px;/s
  );
  assert.match(
    css,
    /\.context-menu-body-preset-label input\[type="checkbox"\]\s*\{[^}]*width:\s*14px;[^}]*height:\s*14px;[^}]*min-width:\s*14px;[^}]*align-self:\s*center;/s
  );
  assert.match(
    css,
    /\.context-menu-body-preset-label span\s*\{[^}]*display:\s*inline-flex;[^}]*align-items:\s*center;[^}]*font-size:\s*0\.96rem;[^}]*line-height:\s*1;[^}]*transform:\s*translateY\(0\.5px\);/s
  );
  assert.match(
    css,
    /\.context-menu-body-selected-checkbox,\s*\.context-menu-check-label input\[type="checkbox"\]\s*\{[^}]*width:\s*17px;[^}]*height:\s*17px;[^}]*min-width:\s*17px;/s
  );
  assert.match(
    css,
    /\.context-menu-checklist\s*\{[^}]*gap:\s*3px;/s
  );
  assert.match(
    css,
    /\.context-menu-body-selected-list\s*\{[^}]*gap:\s*3px;[^}]*margin-bottom:\s*5px;/s
  );
  assert.match(
    css,
    /\.context-menu-submenu--body\s*\{[^}]*min-width:\s*min\(288px, var\(--context-body-submenu-max-width, calc\(100vw - 36px\)\)\);[^}]*max-width:\s*min\(420px, calc\(100vw - 36px\), var\(--context-body-submenu-max-width, calc\(100vw - 36px\)\)\);[^}]*width:\s*max-content;/s
  );
  assert.match(
    css,
    /\.context-menu-body-panel\s*\{[^}]*width:\s*max-content;[^}]*min-width:\s*100%;[^}]*max-width:\s*100%;/s
  );
  assert.match(
    css,
    /\.context-menu-body-selected-item \.context-menu-list-text\s*\{[^}]*overflow:\s*visible;[^}]*overflow-wrap:\s*anywhere;[^}]*text-overflow:\s*clip;[^}]*white-space:\s*normal;[^}]*font-size:\s*0\.98rem;/s
  );
  assert.match(
    css,
    /\.context-menu-check-label span\s*\{[^}]*overflow:\s*visible;[^}]*overflow-wrap:\s*anywhere;[^}]*text-overflow:\s*clip;[^}]*white-space:\s*normal;/s
  );
  assert.match(bodyPartPanel, /<Pencil size=\{13\}/);
  assert.match(bodyPartPanel, /<Trash2 size=\{14\}/);
});
