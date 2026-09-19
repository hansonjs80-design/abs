import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPatientHistoryPrintCellText, PATIENT_HISTORY_PRINT_CSS } from '../patientHistoryPrint.js';

test('prints live select, input, and complete multiline textarea values', () => {
  const fields = [
    { tagName: 'SELECT', value: 'f2', selectedOptions: [{ textContent: 'F2.0' }] },
    { tagName: 'TEXTAREA', value: '첫 줄\n화면 아래 숨겨진 마지막 메모' },
    { tagName: 'INPUT', value: '12' },
  ];
  const replacements = [];
  let removedHandle = false;
  const copy = {
    ownerDocument: { createTextNode: (text) => text },
    querySelectorAll: (selector) => selector === 'input, textarea, select'
      ? fields.map((_, index) => ({ replaceWith: (value) => { replacements[index] = value; } }))
      : [{ remove: () => { removedHandle = true; } }],
    get textContent() { return replacements.join(' '); },
  };
  const source = { cloneNode: () => copy, querySelectorAll: () => fields };
  assert.equal(getPatientHistoryPrintCellText(source), 'F2.0 첫 줄\n화면 아래 숨겨진 마지막 메모 12');
  assert.equal(removedHandle, true);
  assert.equal(fields[1].value, '첫 줄\n화면 아래 숨겨진 마지막 메모');
});

test('uses A4 landscape, wrapping, and repeated headers without viewport clipping', () => {
  assert.match(PATIENT_HISTORY_PRINT_CSS, /size: A4 landscape/);
  assert.match(PATIENT_HISTORY_PRINT_CSS, /table-header-group/);
  assert.match(PATIENT_HISTORY_PRINT_CSS, /overflow-wrap: anywhere/);
  assert.match(PATIENT_HISTORY_PRINT_CSS, /white-space: pre-wrap/);
  assert.doesNotMatch(PATIENT_HISTORY_PRINT_CSS, /overflow:\s*(hidden|auto)|max-height|vh/);
});
