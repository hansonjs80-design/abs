import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPatientHistoryPrintColumns, formatPatientHistoryPrintText, getPatientHistoryPrintCellText, PATIENT_HISTORY_PRINT_CSS } from '../patientHistoryPrint.js';

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


test('omits private and editing columns and allocates all available width to remaining columns', () => {
  const labels = ['번호', '치료 구분', '날짜', '챠트번호', '처방', '부위', '메모', '회차', '실비소진', '갱신 일자', '담당', '적용'];
  const columns = getPatientHistoryPrintColumns(labels);
  assert.deepEqual(columns.map((column) => column.label), ['번호', '치료 구분', '날짜', '부위', '회차', '실비소진', '갱신 일자']);
  assert.deepEqual(columns.map((column) => column.index), [0, 1, 2, 5, 7, 8, 9]);
  assert.equal(columns.reduce((sum, column) => sum + column.width, 0), 100);
  assert.equal(columns.find((column) => column.label === '부위').width, 40);
  const grouped = getPatientHistoryPrintColumns(labels.filter((label) => label !== '치료 구분'));
  assert.ok(Math.abs(grouped.reduce((sum, column) => sum + column.width, 0) - 100) < 0.001);
  assert.ok(grouped.find((column) => column.label === '부위').width > 40);
  assert.deepEqual(getPatientHistoryPrintColumns(['차트번호', '적용']), []);
});

test('joins multiline body parts into a readable single line without discarding content', () => {
  assert.equal(formatPatientHistoryPrintText('Lt. Shoulder\nRt. Knee\n\nBoth Elbow', '부위'), 'Lt. Shoulder, Rt. Knee, Both Elbow');
  assert.equal(formatPatientHistoryPrintText('2026-09-20\n(일)', '날짜'), '2026-09-20 (일)');
});
