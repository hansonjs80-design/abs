import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildTopTabTransition,
  getTopTabMotionClasses,
} from './topTabTransitionUtils.js';

const items = [
  { path: '/' },
  { path: '/shockwave' },
  { path: '/shockwave-stats' },
  { path: '/settings' },
];

describe('top tab directional transition', () => {
  it('marks a non-adjacent transition that moves to the right', () => {
    const transition = buildTopTabTransition(items, '/', '/shockwave-stats');

    assert.deepEqual(transition, {
      fromPath: '/',
      toPath: '/shockwave-stats',
      direction: 'right',
    });
    assert.match(getTopTabMotionClasses(transition, '/'), /outgoing.*move-right/);
    assert.match(getTopTabMotionClasses(transition, '/shockwave-stats'), /incoming.*move-right/);
  });

  it('marks a transition that moves to the left', () => {
    const transition = buildTopTabTransition(items, '/settings', '/shockwave');

    assert.deepEqual(transition, {
      fromPath: '/settings',
      toPath: '/shockwave',
      direction: 'left',
    });
  });

  it('does not create a transition for the active tab or an unknown route', () => {
    assert.equal(buildTopTabTransition(items, '/shockwave', '/shockwave'), null);
    assert.equal(buildTopTabTransition(items, '/unknown', '/shockwave'), null);
  });
});
