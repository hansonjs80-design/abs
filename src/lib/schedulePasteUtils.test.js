import test from 'node:test';
import assert from 'node:assert/strict';
import { needsSchedulePasteHistory } from './schedulePasteUtils.js';
import { applyShockwaveMemoStateUpdate, applyShockwaveMemoStateUpdates } from './scheduleSaveStateUtils.js';

test('complete reservations skip history, incomplete fields still trigger the original autofill path', () => {
  assert.equal(needsSchedulePasteHistory({content:'가상 예약',prescription:'충격파',body_part:'허리'}),false);
  assert.equal(needsSchedulePasteHistory({content:'가상 예약',prescription:'충격파',body_part:''}),true);
  assert.equal(needsSchedulePasteHistory({content:'가상 예약',prescription:'',body_part:'허리'}),true);
  assert.equal(needsSchedulePasteHistory({content:'가상 예약'}),true);
  assert.equal(needsSchedulePasteHistory({content:''}),false);
  assert.equal(needsSchedulePasteHistory(null),false);
});

test('batch optimistic update matches sequential replacements and removals without mutating source snapshots', () => {
  const prev=Object.fromEntries(Array.from({length:3000},(_,i)=>[String(i),{content:`예약${i}`,merge_span:{rowSpan:2}}]));
  const original=structuredClone(prev);
  const updates=Object.fromEntries(Array.from({length:150},(_,i)=>[String(i*20),{content:i%3?'새 예약':'',prescription:'검증'}]));
  updates.new={content:'추가'};
  const keep=m=>Boolean(m?.content);
  const expected=Object.entries(updates).reduce((state,[key,memo])=>applyShockwaveMemoStateUpdate(state,key,memo,keep),prev);
  assert.deepEqual(applyShockwaveMemoStateUpdates(prev,updates,keep),expected);
  assert.deepEqual(prev,original);
  assert.deepEqual(applyShockwaveMemoStateUpdates(undefined,updates,keep),
    Object.fromEntries(Object.entries(updates).filter(([,memo])=>keep(memo))));
});
