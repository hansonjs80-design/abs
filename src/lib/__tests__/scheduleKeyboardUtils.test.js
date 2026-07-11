import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getEditingCellKeyAction,
  getScheduleShortcutKey,
  isBodyPartMenuShortcut,
  isGridNavigationKey,
  isHolidayBackgroundShortcut,
  isMergeShortcut,
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

  it('detects body part, visit complete, and merge shortcuts', () => {
    assert.equal(isBodyPartMenuShortcut({ metaKey: true, key: 'Enter' }), true);
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

  it('keeps arrow keys as grid navigation only outside cell editing', () => {
    assert.equal(isGridNavigationKey({ key: 'ArrowLeft' }), true);
    assert.equal(isGridNavigationKey({ key: 'ArrowRight' }), true);
    assert.equal(getEditingCellKeyAction({ key: 'ArrowLeft' }), 'allow-input');
    assert.equal(getEditingCellKeyAction({ key: 'ArrowRight' }), 'allow-input');
    assert.equal(getEditingCellKeyAction({ key: 'Escape' }), 'close-edit');
  });
});
