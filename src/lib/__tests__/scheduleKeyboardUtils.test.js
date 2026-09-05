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
  resolveSchedulePrescriptionShortcut,
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
    assert.equal(isMemoMenuShortcut({ metaKey: true, code: 'Equal', key: '+' }), true);
    assert.equal(isMemoMenuShortcut({ ctrlKey: true, code: 'NumpadAdd', key: '+' }), true);
    assert.equal(isMemoMenuShortcut({ metaKey: true, code: 'Equal', key: '=' }), true);
    assert.equal(isMemoMenuShortcut({ code: 'Equal', key: '+' }), false);
    assert.equal(isMemoMenuShortcut({ metaKey: true, code: 'Period', key: '.' }), false);
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
    assert.equal(formatScheduleShortcutLabel('4', 'Alt'), 'Alt+4');
    assert.equal(formatScheduleShortcutLabel('4', '⌥'), '⌥+4');
    assert.equal(formatScheduleShortcutLabel('+', 'Ctrl'), 'Ctrl++');
    assert.equal(formatScheduleShortcutLabel('+', '⌘'), '⌘+');
    assert.equal(formatScheduleShortcutLabel('3', 'Ctrl+Shift'), 'Ctrl+Shift+3');
    assert.equal(formatScheduleShortcutLabel('A', '⌘⇧'), '⌘⇧A');
    assert.equal(formatScheduleShortcutLabel('', 'Ctrl'), '');
  });

  it('uses Alt or Option digits only for manual therapy prescriptions', () => {
    const shortcuts = {
      manualShortcuts: { '도수 30분': '4', '도수 영문': 'A' },
      shockwaveShortcuts: { F2: '4' },
    };

    assert.deepEqual(
      resolveSchedulePrescriptionShortcut(
        { altKey: true, code: 'Digit4', key: '¢' },
        shortcuts
      ),
      { type: 'manual_therapy', prescription: '도수 30분', shortcutKey: '4' }
    );
    assert.equal(
      resolveSchedulePrescriptionShortcut(
        { altKey: true, code: 'KeyA', key: 'å' },
        shortcuts
      ),
      null
    );
    assert.equal(
      resolveSchedulePrescriptionShortcut(
        { altKey: true, shiftKey: true, code: 'Digit4', key: '€' },
        shortcuts
      ),
      null
    );
  });

  it('keeps Ctrl or Command prescription shortcuts exclusive to shockwave', () => {
    const shortcuts = {
      manualShortcuts: { '도수 30분': '4' },
      shockwaveShortcuts: { F2: '4', F3: 'A' },
    };

    assert.deepEqual(
      resolveSchedulePrescriptionShortcut(
        { metaKey: true, code: 'Digit4', key: '4' },
        shortcuts
      ),
      { type: 'shockwave', prescription: 'F2', shortcutKey: '4' }
    );
    assert.deepEqual(
      resolveSchedulePrescriptionShortcut(
        { ctrlKey: true, code: 'KeyA', key: 'a' },
        shortcuts
      ),
      { type: 'shockwave', prescription: 'F3', shortcutKey: 'A' }
    );
    assert.equal(
      resolveSchedulePrescriptionShortcut(
        { metaKey: true, altKey: true, code: 'Digit4', key: '4' },
        shortcuts
      ),
      null
    );
  });

  it('uses Ctrl or Command plus Shift for shinjang spray prescriptions', () => {
    const shortcuts = {
      shockwaveShortcuts: { F2: '4' },
      shinjangShortcuts: { 'F3.0(신장분사DC)': '4', '40분(신장분사)': 'A' },
    };

    assert.deepEqual(
      resolveSchedulePrescriptionShortcut(
        { metaKey: true, shiftKey: true, code: 'Digit4', key: '$' },
        shortcuts
      ),
      { type: 'shinjang_spray', prescription: 'F3.0(신장분사DC)', shortcutKey: '4' }
    );
    assert.deepEqual(
      resolveSchedulePrescriptionShortcut(
        { ctrlKey: true, shiftKey: true, code: 'KeyA', key: 'A' },
        shortcuts
      ),
      { type: 'shinjang_spray', prescription: '40분(신장분사)', shortcutKey: 'A' }
    );
    assert.equal(
      resolveSchedulePrescriptionShortcut(
        { ctrlKey: true, shiftKey: true, altKey: true, code: 'KeyA', key: 'A' },
        shortcuts
      ),
      null
    );
  });

  it('does not resolve hidden prescriptions', () => {
    assert.equal(
      resolveSchedulePrescriptionShortcut(
        { altKey: true, code: 'Digit2', key: '™' },
        {
          manualShortcuts: { '도수 60분': '2' },
          hiddenPrescriptions: ['도수 60분'],
        }
      ),
      null
    );
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
