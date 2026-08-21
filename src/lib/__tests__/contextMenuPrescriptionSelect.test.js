import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const viewUrl = new URL('../../components/shockwave/ShockwaveView.jsx', import.meta.url);
const selectUrl = new URL(
  '../../components/shockwave/ContextMenuPrescriptionSelect.jsx',
  import.meta.url
);
const cssUrl = new URL('../../styles/shockwave.css', import.meta.url);

test('context menu prescription dropdowns show current monthly shortcuts on the right', async () => {
  const [view, select, css] = await Promise.all([
    readFile(viewUrl, 'utf8'),
    readFile(selectUrl, 'utf8'),
    readFile(cssUrl, 'utf8'),
  ]);

  assert.match(view, /shortcuts=\{effectiveShockwaveSettings\?\.shortcuts \|\| \{\}\}/);
  assert.match(view, /shortcuts=\{effectiveManualSettings\?\.shortcuts \|\| \{\}\}/);
  assert.match(select, /context-menu-prescription-option-shortcut/);
  assert.match(select, /formatScheduleShortcutLabel/);
  assert.match(select, /const estimatedListHeight = \(options\.length \+ 1\) \* 33 \+ 8;/);
  const dropdownListRule = css.match(
    /\.context-menu-prescription-dropdown-list\s*\{([^}]*)\}/s
  )?.[1] || '';
  assert.doesNotMatch(dropdownListRule, /max-height:/);
  assert.doesNotMatch(dropdownListRule, /overflow-y:\s*auto;/);
  assert.match(dropdownListRule, /width:\s*max\(100%, 148px\);/);
  assert.match(
    css,
    /\.context-menu-prescription-dropdown-option:hover,[^{]*\{[^}]*background:\s*#8fbced;[^}]*font-weight:\s*900;/s
  );
  assert.match(
    css,
    /\.context-menu-prescription-dropdown-option:hover \.context-menu-prescription-option-shortcut,[^{]*\{[^}]*font-weight:\s*900;/s
  );
  assert.match(
    css,
    /\.context-menu-prescription-dropdown-option\.is-selected\s*\{[^}]*background:\s*#dbeafe;[^}]*font-weight:\s*900;[^}]*box-shadow:\s*inset 3px 0 0 #2563eb,/s
  );
  assert.match(
    css,
    /\.context-menu-prescription-dropdown-option\.is-selected::before\s*\{[^}]*content:\s*'✓';/s
  );
  assert.match(
    css,
    /\.context-menu-prescription-dropdown-option\s*\{[^}]*display:\s*flex;[^}]*justify-content:\s*space-between;/s
  );
  assert.match(
    css,
    /\.context-menu-prescription-option-shortcut\s*\{[^}]*margin-left:\s*auto;[^}]*text-align:\s*right;/s
  );
});
