import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const bodyPartPanelUrl = new URL(
  '../../components/shockwave/BodyPartKeyboardPanel.jsx',
  import.meta.url
);
const cssUrl = new URL('../../styles/shockwave.css', import.meta.url);

test('body part preset checkboxes support auto-focus and keyboard arrow/space/enter navigation', async () => {
  const [bodyPartPanel, css] = await Promise.all([
    readFile(bodyPartPanelUrl, 'utf8'),
    readFile(cssUrl, 'utf8'),
  ]);

  // 자동 포커스 시 상단 프리셋 첫 번째 체크박스 항목으로 포커스
  assert.match(bodyPartPanel, /presetItems\.length > 0 && presetRefs\.current\[0\]/);
  assert.match(bodyPartPanel, /presetRefs\.current\[0\]\.focus\(\{ preventScroll: true \}\)/);
  assert.match(bodyPartPanel, /setPresetFocusIndex\(0\)/);

  // 방향키 및 스페이스/엔터 키 핸들러
  assert.match(bodyPartPanel, /const handlePresetKeyDown = \(event, item, index\) =>/);
  assert.match(bodyPartPanel, /event\.key === 'ArrowDown'/);
  assert.match(bodyPartPanel, /event\.key === 'ArrowUp'/);
  assert.match(bodyPartPanel, /event\.key === ' ' \|\| event\.key === 'Spacebar' \|\| event\.key === 'Enter'/);
  assert.match(bodyPartPanel, /togglePresetSelection\(item\)/);

  // 프리셋 항목 포커스 클래스 및 ref 연결
  assert.match(bodyPartPanel, /className=\{`context-menu-body-preset-item\$\{isFocused \? ' is-keyboard-focused' : ''\}`\}/);
  assert.match(bodyPartPanel, /presetRefs\.current\[flatIndex\] = node/);
  assert.match(bodyPartPanel, /onKeyDown=\{\(event\) => handlePresetKeyDown\(event, item, flatIndex\)\}/);

  // 포커스 스타일
  assert.match(css, /\.context-menu-body-preset-item\.is-keyboard-focused/);
  assert.match(css, /\.context-menu-body-preset-label input\[type="checkbox"\]:focus/);
});
