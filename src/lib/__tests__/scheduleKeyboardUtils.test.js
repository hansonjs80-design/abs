import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  formatScheduleShortcutLabel,
  getEditingCellKeyAction,
  getScheduleShortcutKey,
  getShiftArrowMoveDelta,
  isBodyPartMenuShortcut,
  isGridNavigationKey,
  isHolidayBackgroundShortcut,
  isMergeShortcut,
  isMemoMenuShortcut,
  isPatientHistoryShortcut,
  isSameReservationGroupShortcut,
  isTreatmentCancelShortcut,
  isTreatmentCompleteShortcut,
  normalizeScheduleShortcutValue,
} from '../scheduleKeyboardUtils.js';

describe('schedule keyboard shortcut detection', () => {
  it('detects patient history search with cmd/ctrl f', () => {
    assert.equal(isPatientHistoryShortcut({ metaKey: true, code: 'KeyF', key: 'f' }), true);
    assert.equal(isPatientHistoryShortcut({ ctrlKey: true, code: '', key: 'F' }), true);
    assert.equal(isPatientHistoryShortcut({ metaKey: true, code: '', key: 'ㄹ' }), true);
    assert.equal(isPatientHistoryShortcut({ code: 'KeyF', key: 'f' }), false);
  });

  it('detects body part, memo, visit complete, and merge shortcuts', () => {
    assert.equal(isBodyPartMenuShortcut({ metaKey: true, key: 'Enter' }), true);
    assert.equal(isMemoMenuShortcut({ metaKey: true, code: 'Period', key: '.' }), true);
    assert.equal(isMemoMenuShortcut({ ctrlKey: true, code: 'NumpadDecimal', key: '.' }), true);
    assert.equal(isMemoMenuShortcut({ metaKey: true, code: '', key: '.' }), true);
    assert.equal(isMemoMenuShortcut({ code: 'Period', key: '.' }), false);
    assert.equal(isMemoMenuShortcut({ metaKey: true, code: 'Equal', key: '+' }), false);
    assert.equal(isTreatmentCompleteShortcut({ ctrlKey: true, code: 'KeyS', key: 's' }), true);
    assert.equal(isTreatmentCompleteShortcut({ metaKey: true, code: '', key: 'S' }), true);
    assert.equal(isTreatmentCompleteShortcut({ metaKey: true, code: '', key: 'ㄴ' }), true);
    assert.equal(isMergeShortcut({ metaKey: true, code: 'KeyG', key: 'g' }), true);
    assert.equal(isMergeShortcut({ ctrlKey: true, code: '', key: 'G' }), true);
    assert.equal(isMergeShortcut({ metaKey: true, code: '', key: 'ㅎ' }), true);
    assert.equal(isTreatmentCancelShortcut({ metaKey: true, code: '', key: 'ㅇ' }), true);
    assert.equal(isHolidayBackgroundShortcut({ metaKey: true, code: '', key: 'ㅠ' }), true);
    assert.equal(isSameReservationGroupShortcut({ metaKey: true, code: '', key: 'ㅂ' }), true);
  });

  it('normalizes physical shortcut keys from code, English key, and Korean key fallback', () => {
    assert.equal(getScheduleShortcutKey({ code: 'Digit4', key: '$' }), '4');
    assert.equal(getScheduleShortcutKey({ code: 'Numpad7', key: '7' }), '7');
    assert.equal(getScheduleShortcutKey({ code: 'KeyS', key: 'ㄴ' }), 'S');
    assert.equal(getScheduleShortcutKey({ code: '', key: 'ㄴ' }), 'S');
    assert.equal(getScheduleShortcutKey({ code: 'Space', key: '' }), ' ');
    assert.equal(normalizeScheduleShortcutValue('a'), 'A');
    assert.equal(normalizeScheduleShortcutValue('ㅁ'), 'A');
  });

  it('formats configured prescription shortcuts for Windows and Apple menus', () => {
    assert.equal(formatScheduleShortcutLabel('3', 'Ctrl'), 'Ctrl+3');
    assert.equal(formatScheduleShortcutLabel('ㅁ', '⌘'), '⌘A');
    assert.equal(formatScheduleShortcutLabel('', 'Ctrl'), '');
  });

  it('keeps arrow keys as grid navigation only outside cell editing', () => {
    assert.equal(isGridNavigationKey({ key: 'ArrowLeft' }), true);
    assert.equal(isGridNavigationKey({ key: 'ArrowRight' }), true);
    assert.equal(getEditingCellKeyAction({ key: 'ArrowLeft' }), 'allow-input');
    assert.equal(getEditingCellKeyAction({ key: 'ArrowRight' }), 'allow-input');
    assert.equal(getEditingCellKeyAction({ key: 'Escape' }), 'close-edit');
  });

  it('maps shift plus every arrow key to a schedule move delta', () => {
    assert.deepEqual(getShiftArrowMoveDelta({ shiftKey: true, key: 'ArrowUp' }), { rowDelta: -1, colDelta: 0 });
    assert.deepEqual(getShiftArrowMoveDelta({ shiftKey: true, key: 'ArrowDown' }), { rowDelta: 1, colDelta: 0 });
    assert.deepEqual(getShiftArrowMoveDelta({ shiftKey: true, key: 'ArrowLeft' }), { rowDelta: 0, colDelta: -1 });
    assert.deepEqual(getShiftArrowMoveDelta({ shiftKey: true, key: 'ArrowRight' }), { rowDelta: 0, colDelta: 1 });
    assert.equal(getShiftArrowMoveDelta({ shiftKey: false, key: 'ArrowLeft' }), null);
  });
});
