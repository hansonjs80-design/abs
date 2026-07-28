import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getResizePointerClient,
  isTouchResizeEvent,
  resolveTouchResizeStart,
} from './resizePointerUtils.js';

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

test('confirmed touch resize arms the next touch instead of starting the current touch', () => {
  let confirmCalls = 0;
  const firstTouch = resolveTouchResizeStart(
    { touches: [{ clientX: 100, clientY: 40 }] },
    0,
    {
      now: 1000,
      confirmResize: () => {
        confirmCalls += 1;
        return true;
      },
    }
  );

  assert.deepEqual(firstTouch, {
    shouldStart: false,
    armedUntil: 11000,
    confirmed: true,
  });

  const dragTouch = resolveTouchResizeStart(
    { touches: [{ clientX: 100, clientY: 40 }] },
    firstTouch.armedUntil,
    {
      now: 1500,
      confirmResize: () => {
        confirmCalls += 1;
        return true;
      },
    }
  );

  assert.deepEqual(dragTouch, {
    shouldStart: true,
    armedUntil: 0,
    confirmed: false,
  });
  assert.equal(confirmCalls, 1);
});

test('expired or cancelled touch resize does not start dragging', () => {
  const expired = resolveTouchResizeStart(
    { touches: [{ clientX: 120, clientY: 40 }] },
    5000,
    { now: 6000, confirmResize: () => false }
  );

  assert.deepEqual(expired, {
    shouldStart: false,
    armedUntil: 0,
    confirmed: false,
  });
});
