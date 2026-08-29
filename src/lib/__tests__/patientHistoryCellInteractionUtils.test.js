import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  applyPatientHistoryBodyPartAction,
  applyPatientHistoryMemoAction,
  buildPatientHistoryCellFillValues,
  buildPatientHistoryVisitFillValues,
  buildPatientHistoryUndoAction,
  getPatientHistoryCellDirectInputText,
  getPatientHistoryEscapeAction,
  getPatientHistoryEditorPlacement,
  getPatientHistoryCellClipboardMode,
  getPatientHistoryCellClipboardText,
  getPatientHistoryCellNavigationDirection,
  getPatientHistoryVisitCountShortcutDelta,
  getPatientHistoryInlineEditInitialValue,
  getPatientHistoryUndoRestoreChanges,
  isPatientHistoryEditorAction,
  isPatientHistoryCellClearShortcut,
  isPatientHistoryCellEditorShortcut,
  normalizePatientHistoryCellValue,
  stepPatientHistoryVisitCount,
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

  it('normalizes visit-count clipboard values and recognizes unmodified arrow navigation', () => {
    assert.equal(normalizePatientHistoryCellValue('visit_count', ' 12회 '), '12');
    assert.equal(normalizePatientHistoryCellValue('visit_count', '*'), '*');
    assert.equal(getPatientHistoryCellClipboardText('visit_count', '3'), '3');
    assert.equal(getPatientHistoryCellNavigationDirection({ key: 'ArrowLeft' }), 'ArrowLeft');
    assert.equal(getPatientHistoryCellNavigationDirection({ key: 'ArrowDown' }), 'ArrowDown');
    assert.equal(getPatientHistoryCellNavigationDirection({ key: 'ArrowUp', shiftKey: true }), null);
    assert.equal(getPatientHistoryCellNavigationDirection({ key: 'Enter' }), null);
  });

  it('starts direct typing for memo and visit cells with spreadsheet-style values', () => {
    assert.equal(getPatientHistoryCellDirectInputText({ key: '새' }), '새');
    assert.equal(getPatientHistoryCellDirectInputText({ key: '4' }), '4');
    assert.equal(getPatientHistoryCellDirectInputText({ key: 'Process', keyCode: 229 }), '');
    assert.equal(getPatientHistoryCellDirectInputText({ key: 'c', metaKey: true }), null);
    assert.equal(getPatientHistoryCellDirectInputText({ key: 'Enter' }), null);
    assert.equal(
      getPatientHistoryInlineEditInitialValue('memo', '기존 메모', '새'),
      '기존 메모\n새',
    );
    assert.equal(getPatientHistoryInlineEditInitialValue('memo', '', '새'), '새');
    assert.equal(getPatientHistoryInlineEditInitialValue('visit_count', '8', '2'), '2');
    assert.equal(getPatientHistoryInlineEditInitialValue('visit_count', '8'), '8');
  });

  it('builds increasing visit counts for the dragged fill range', () => {
    assert.deepEqual(buildPatientHistoryVisitFillValues('3', 4), ['4', '5', '6', '7']);
    assert.deepEqual(buildPatientHistoryVisitFillValues('3회', 2), ['4', '5']);
    assert.deepEqual(buildPatientHistoryVisitFillValues('*', 3), ['2', '3', '4']);
    assert.deepEqual(buildPatientHistoryVisitFillValues('', 3), []);
  });

  it('copies body-part and memo values through their dragged fill ranges', () => {
    assert.deepEqual(
      buildPatientHistoryCellFillValues('body_part', 'Lt. 어깨\nRt. 무릎', 2),
      ['Lt. 어깨, Rt. 무릎', 'Lt. 어깨, Rt. 무릎'],
    );
    assert.deepEqual(
      buildPatientHistoryCellFillValues('memo', '첫 메모\n둘째 메모', 2),
      ['첫 메모\n둘째 메모', '첫 메모\n둘째 메모'],
    );
  });

  it('steps a selected visit cell with the same command arrow sequence as the schedule', () => {
    assert.equal(
      getPatientHistoryVisitCountShortcutDelta({ key: 'ArrowUp', metaKey: true }, 'visit_count'),
      1,
    );
    assert.equal(
      getPatientHistoryVisitCountShortcutDelta({ key: 'ArrowDown', ctrlKey: true }, 'visit_count'),
      -1,
    );
    assert.equal(
      getPatientHistoryVisitCountShortcutDelta({ key: 'ArrowUp' }, 'visit_count'),
      0,
    );
    assert.equal(
      getPatientHistoryVisitCountShortcutDelta({ key: 'ArrowUp', metaKey: true }, 'memo'),
      0,
    );
    assert.equal(stepPatientHistoryVisitCount('*', 1), '1');
    assert.equal(stepPatientHistoryVisitCount('1', 1), '2');
    assert.equal(stepPatientHistoryVisitCount('1', -1), '*');
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
