import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  applyPatientHistoryBodyPartAction,
  applyPatientHistoryMemoAction,
  buildPatientHistoryUndoAction,
  getPatientHistoryEscapeAction,
  getPatientHistoryEditorPlacement,
  getPatientHistoryCellClipboardMode,
  getPatientHistoryCellClipboardText,
  getPatientHistoryUndoRestoreChanges,
  isPatientHistoryEditorAction,
  isPatientHistoryCellClearShortcut,
  isPatientHistoryCellEditorShortcut,
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

  it('opens the selected history editor with an unmodified Enter key', () => {
    assert.equal(isPatientHistoryCellEditorShortcut({ key: 'Enter' }), true);
    assert.equal(isPatientHistoryCellEditorShortcut({ key: 'Enter', isComposing: true }), false);
    assert.equal(isPatientHistoryCellEditorShortcut({ key: 'Enter', ctrlKey: true }), false);
    assert.equal(isPatientHistoryCellEditorShortcut({ key: ' ' }), false);
  });

  it('restores a cut and paste as one undo action in reverse mutation order', () => {
    const sourceCell = { id: 'source', rowKey: 'row-1', field: 'memo' };
    const targetCell = { id: 'target', rowKey: 'row-2', field: 'memo' };
    const action = buildPatientHistoryUndoAction([
      {
        cell: targetCell,
        previousValue: '대상 메모',
        nextValue: '원본 메모',
      },
      {
        cell: sourceCell,
        previousValue: '원본 메모',
        nextValue: '',
      },
    ]);

    assert.deepEqual(getPatientHistoryUndoRestoreChanges(action), [
      { cell: sourceCell, value: '원본 메모' },
      { cell: targetCell, value: '대상 메모' },
    ]);
  });

  it('does not record an undo action when paste keeps the same normalized value', () => {
    assert.equal(buildPatientHistoryUndoAction([{
      cell: { id: 'same', rowKey: 'row-1', field: 'body_part' },
      previousValue: 'Lt. 어깨, Rt. 무릎',
      nextValue: 'Lt. 어깨\nRt. 무릎',
    }]), null);
  });

  it('recognizes copy and cut by physical key even with a Korean input layout', () => {
    assert.equal(getPatientHistoryCellClipboardMode({ metaKey: true, code: 'KeyC', key: 'ㅊ' }), 'copy');
    assert.equal(getPatientHistoryCellClipboardMode({ ctrlKey: true, code: 'KeyX', key: 'ㅌ' }), 'cut');
    assert.equal(getPatientHistoryCellClipboardMode({ code: 'KeyC', key: 'c' }), null);
    assert.equal(getPatientHistoryCellClipboardMode({ metaKey: true, code: 'KeyV', key: 'ㅍ' }), null);
  });

  it('dismisses clipboard and selection states before closing the history modal', () => {
    assert.equal(getPatientHistoryEscapeAction({
      hasClipboardCell: true,
      hasContextMenu: true,
      hasSelectedCell: true,
    }), 'close-editor');
    assert.equal(getPatientHistoryEscapeAction({
      hasClipboardCell: true,
      hasSelectedCell: true,
    }), 'clear-clipboard');
    assert.equal(getPatientHistoryEscapeAction({
      hasContextMenu: true,
      hasSelectedCell: true,
    }), 'close-editor');
    assert.equal(getPatientHistoryEscapeAction({ hasSelectedCell: true }), 'clear-selection');
    assert.equal(getPatientHistoryEscapeAction(), 'close-modal');
  });

  it('keeps the history editor immediately to the right when usable space remains', () => {
    assert.deepEqual(getPatientHistoryEditorPlacement({
      rect: { left: 900, right: 1040 },
      field: 'memo',
      viewportWidth: 1400,
    }), {
      x: 1048,
      width: 272,
      side: 'right',
    });
  });

  it('keeps the history editor close to a right-edge cell instead of jumping far left', () => {
    assert.deepEqual(getPatientHistoryEditorPlacement({
      rect: { left: 1032, right: 1165 },
      field: 'memo',
      viewportWidth: 1280,
    }), {
      x: 998,
      width: 272,
      side: 'overlap',
    });
  });
});
