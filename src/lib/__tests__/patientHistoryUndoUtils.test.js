import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createPatientHistoryMutationQueue,
  undoPatientHistoryDraft,
  updatePatientHistoryDraft,
} from '../patientHistoryUndoUtils.js';

test('undo restores deleted multiline memo text without saving a draft', () => {
  const original = { cell: { id: 'a:memo' }, value: '• 첫 메모\n• 둘째 메모', undoValues: [] };
  const cleared = updatePatientHistoryDraft(original, '');
  assert.deepEqual(undoPatientHistoryDraft(cleared), original);
  assert.equal(original.value, '• 첫 메모\n• 둘째 메모');
});

test('typing over a selected cell and successive deletes can each be undone', () => {
  const original = { value: '본인부담', undoValues: [] };
  const typed = updatePatientHistoryDraft(original, '수정');
  const deleted = updatePatientHistoryDraft(typed, '수');
  assert.deepEqual(undoPatientHistoryDraft(deleted), typed);
  assert.deepEqual(undoPatientHistoryDraft(typed), original);
  assert.equal(undoPatientHistoryDraft(original), null);
  assert.equal(updatePatientHistoryDraft(original, '본인부담'), original);
});

test('undo restores a cleared visit count including a nonnumeric marker', () => {
  const original = { value: '*', undoValues: [] };
  assert.deepEqual(undoPatientHistoryDraft(updatePatientHistoryDraft(original, '')), original);
});

test('immediate undo waits for every range delete and its undo record', async () => {
  const queue = createPatientHistoryMutationQueue();
  let finishSave;
  const blockedSave = new Promise(resolve => { finishSave = resolve; });
  const data = ['첫 메모', '둘째 메모'];
  const history = [];
  const deletion = queue.enqueue(async () => {
    const previous = [...data];
    data[0] = '';
    await blockedSave;
    data[1] = '';
    history.push(previous);
  });
  const undo = queue.enqueue(() => { data.splice(0, data.length, ...history.pop()); });
  await Promise.resolve();
  assert.deepEqual(data, ['', '둘째 메모']);
  finishSave();
  await Promise.all([deletion, undo]);
  assert.deepEqual(data, ['첫 메모', '둘째 메모']);
});

test('repeated undo requests execute in order and the queue survives failed saves', async () => {
  const queue = createPatientHistoryMutationQueue();
  const history = ['first', 'second'];
  const restored = [];
  const failed = queue.enqueue(() => { throw new Error('save failed'); });
  const firstUndo = queue.enqueue(async () => { await Promise.resolve(); restored.push(history.pop()); });
  const secondUndo = queue.enqueue(() => restored.push(history.pop()));
  await assert.rejects(failed, /save failed/);
  await Promise.all([firstUndo, secondUndo]);
  assert.deepEqual(restored, ['second', 'first']);
});

test('closing the modal cancels pending undo and prevents an old save from patching a new session', async () => {
  const queue = createPatientHistoryMutationQueue();
  let finishSave;
  const blockedSave = new Promise(resolve => { finishSave = resolve; });
  let stalePatch = false;
  const save = queue.enqueue(async () => {
    await blockedSave;
    if (queue.isCurrent()) stalePatch = true;
  });
  const undo = queue.enqueue(() => { throw new Error('old undo must not run'); });
  await Promise.resolve();
  queue.reset();
  const nextSession = queue.enqueue(() => queue.isCurrent());
  finishSave();
  await save;
  assert.equal(await undo, false);
  assert.equal(stalePatch, false);
  assert.equal(await nextSession, true);
});
