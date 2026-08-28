import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  applyPatientHistoryBodyPartAction,
  applyPatientHistoryMemoAction,
  getPatientHistoryCellClipboardText,
  isPatientHistoryEditorAction,
  isPatientHistoryCellClearShortcut,
  normalizePatientHistoryCellValue,
} from '../patientHistoryCellInteractionUtils.js';

describe('patient history body-part cell actions', () => {
  it('normalizes pasted lines and supports the schedule body-part editor actions', () => {
    assert.equal(
      normalizePatientHistoryCellValue('body_part', 'Lt. 어깨\nRt. 무릎'),
      'Lt. 어깨, Rt. 무릎',
    );
    assert.equal(
      applyPatientHistoryBodyPartAction('Lt. 어깨, Rt. 무릎', {
        type: 'bodyPartMove',
        index: 1,
        direction: 'up',
      }),
      'Rt. 무릎, Lt. 어깨',
    );
    assert.equal(
      applyPatientHistoryBodyPartAction('Lt. 어깨, Rt. 무릎', {
        type: 'bodyPartToggle',
        value: 'Lt. 어깨',
      }),
      'Rt. 무릎',
    );
  });

  it('uses line-separated clipboard text for spreadsheet-style copy and paste', () => {
    assert.equal(
      getPatientHistoryCellClipboardText('body_part', 'Lt. 어깨, Rt. 무릎'),
      'Lt. 어깨\nRt. 무릎',
    );
  });
});

describe('patient history memo cell actions', () => {
  it('adds, edits, reorders, and removes memo lines', () => {
    const added = applyPatientHistoryMemoAction('첫 메모', { type: 'memoAdd', value: '둘째 메모' });
    assert.equal(added, '첫 메모\n둘째 메모');
    const edited = applyPatientHistoryMemoAction(added, {
      type: 'memoUpdate',
      index: 1,
      value: '수정 메모',
    });
    assert.equal(edited, '첫 메모\n수정 메모');
    const moved = applyPatientHistoryMemoAction(edited, {
      type: 'memoMove',
      index: 1,
      direction: 'up',
    });
    assert.equal(moved, '수정 메모\n첫 메모');
    assert.equal(
      applyPatientHistoryMemoAction(moved, { type: 'memoRemove', index: 0 }),
      '첫 메모',
    );
  });

  it('routes only supported actions to the patient history editor', () => {
    assert.equal(isPatientHistoryEditorAction('body_part', { type: 'bodyPartPreset' }), true);
    assert.equal(isPatientHistoryEditorAction('memo', { type: 'memoUpdate' }), true);
    assert.equal(isPatientHistoryEditorAction('memo', { type: 'prescription' }), false);
  });

  it('recognizes the same delete and backspace keys used by the schedule table', () => {
    assert.equal(isPatientHistoryCellClearShortcut({ key: 'Delete' }), true);
    assert.equal(isPatientHistoryCellClearShortcut({ key: 'Backspace' }), true);
    assert.equal(isPatientHistoryCellClearShortcut({ key: 'Enter' }), false);
  });
});
