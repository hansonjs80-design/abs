import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatPatientHistoryOverflowTooltipItems,
  getPatientHistoryOverflowTooltipPosition,
} from '../patientHistoryOverflowTooltipUtils.js';

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
