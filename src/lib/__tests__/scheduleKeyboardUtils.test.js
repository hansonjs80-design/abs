import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getEditingCellKeyAction,
  isBodyPartMenuShortcut,
  isGridNavigationKey,
  isMergeShortcut,
  isPatientHistoryShortcut,
  isTreatmentCompleteShortcut,
} from '../scheduleKeyboardUtils.js';

describe('schedule keyboard shortcut detection', () => {
  it('detects patient history search with cmd/ctrl f', () => {
    assert.equal(isPatientHistoryShortcut({ metaKey: true, code: 'KeyF', key: 'f' }), true);
    assert.equal(isPatientHistoryShortcut({ ctrlKey: true, code: '', key: 'F' }), true);
    assert.equal(isPatientHistoryShortcut({ code: 'KeyF', key: 'f' }), false);
  });

  it('detects body part, visit complete, and merge shortcuts', () => {
    assert.equal(isBodyPartMenuShortcut({ metaKey: true, key: 'Enter' }), true);
    assert.equal(isTreatmentCompleteShortcut({ ctrlKey: true, code: 'KeyS', key: 's' }), true);
    assert.equal(isTreatmentCompleteShortcut({ metaKey: true, code: '', key: 'S' }), true);
    assert.equal(isMergeShortcut({ metaKey: true, code: 'KeyG', key: 'g' }), true);
    assert.equal(isMergeShortcut({ ctrlKey: true, code: '', key: 'G' }), true);
  });

  it('keeps arrow keys as grid navigation only outside cell editing', () => {
    assert.equal(isGridNavigationKey({ key: 'ArrowLeft' }), true);
    assert.equal(isGridNavigationKey({ key: 'ArrowRight' }), true);
    assert.equal(getEditingCellKeyAction({ key: 'ArrowLeft' }), 'allow-input');
    assert.equal(getEditingCellKeyAction({ key: 'ArrowRight' }), 'allow-input');
    assert.equal(getEditingCellKeyAction({ key: 'Escape' }), 'close-edit');
  });
});
