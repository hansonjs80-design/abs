import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  formatPatientHistoryOverflowTooltipItems,
  getPatientHistoryOverflowTooltipPosition,
} from '../patientHistoryOverflowTooltipUtils.js';

const shockwaveCssUrl = new URL('../../styles/shockwave.css', import.meta.url);
const shockwaveViewUrl = new URL('../../components/shockwave/ShockwaveView.jsx', import.meta.url);

test('patient history overflow tooltip shows multiple values on separate lines', () => {
  assert.equal(
    formatPatientHistoryOverflowTooltipItems(
      [' Rt. Shoulder ', 'Lt. Knee'],
      { showBullets: true },
    ),
    '• Rt. Shoulder\n• Lt. Knee',
  );
  assert.equal(
    formatPatientHistoryOverflowTooltipItems(['Rt. Shoulder'], { showBullets: true }),
    'Rt. Shoulder',
  );
  assert.equal(
    formatPatientHistoryOverflowTooltipItems(['첫 메모', '', '둘째 메모']),
    '첫 메모\n둘째 메모',
  );
});

test('patient history overflow tooltip stays in the viewport and flips above lower rows', () => {
  assert.deepEqual(getPatientHistoryOverflowTooltipPosition({
    anchorRect: { left: 4, top: 40, bottom: 62, width: 80 },
    tooltipRect: { width: 220, height: 80 },
    viewportWidth: 320,
    viewportHeight: 500,
  }), { left: 12, top: 70 });

  assert.deepEqual(getPatientHistoryOverflowTooltipPosition({
    anchorRect: { left: 220, top: 420, bottom: 442, width: 80 },
    tooltipRect: { width: 180, height: 100 },
    viewportWidth: 320,
    viewportHeight: 500,
  }), { left: 128, top: 312 });
});

test('patient history overflow tooltip stays above the modal with a light gray surface', async () => {
  const [shockwaveCss, shockwaveView] = await Promise.all([
    readFile(shockwaveCssUrl, 'utf8'),
    readFile(shockwaveViewUrl, 'utf8'),
  ]);
  const tooltipRule = shockwaveCss.match(/\.patient-history-overflow-tooltip\s*\{([^}]*)\}/s)?.[1] || '';
  const tooltipZIndex = Number(tooltipRule.match(/z-index:\s*(\d+)/)?.[1]);
  const modalZIndex = Number(shockwaveView.match(/zIndex:\s*(\d+),\s*overscrollBehavior/)?.[1]);

  assert.ok(tooltipZIndex > modalZIndex);
  assert.match(tooltipRule, /background:\s*#f3f4f6;/);
  assert.match(tooltipRule, /color:\s*#1f2937;/);
});
