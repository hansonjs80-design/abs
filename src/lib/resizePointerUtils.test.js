import test from 'node:test';
import assert from 'node:assert/strict';
import { getResizePointerClient, isTouchResizeEvent } from './resizePointerUtils.js';

test('mouse resize coordinates are normalized', () => {
  assert.deepEqual(getResizePointerClient({ clientX: 120, clientY: 45 }), {
    x: 120,
    y: 45,
  });
  assert.equal(isTouchResizeEvent({ clientX: 120, clientY: 45 }), false);
});

test('active touch coordinates take precedence over mouse coordinates', () => {
  const event = {
    clientX: 1,
    clientY: 2,
    touches: [{ clientX: 210, clientY: 90 }],
  };

  assert.deepEqual(getResizePointerClient(event), { x: 210, y: 90 });
  assert.equal(isTouchResizeEvent(event), true);
});

test('touchend coordinates are read from changedTouches', () => {
  const event = {
    touches: [],
    changedTouches: [{ clientX: 305, clientY: 150 }],
  };

  assert.deepEqual(getResizePointerClient(event), { x: 305, y: 150 });
  assert.equal(isTouchResizeEvent(event), true);
});
