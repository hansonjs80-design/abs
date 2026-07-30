import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createRoutePreloader,
  isStatsRoutePath,
} from '../statsRoutePreload.js';

describe('statistics route preloading', () => {
  it('preloads only supported statistics routes', () => {
    assert.equal(isStatsRoutePath('/shockwave-stats'), true);
    assert.equal(isStatsRoutePath('/manual-therapy-stats'), true);
    assert.equal(isStatsRoutePath('/shockwave'), false);
  });

  it('shares one preload while the same route is requested repeatedly', async () => {
    let loadCount = 0;
    let finishLoad;
    const pendingLoad = new Promise((resolve) => {
      finishLoad = resolve;
    });
    const preload = createRoutePreloader({
      '/stats': async () => {
        loadCount += 1;
        await pendingLoad;
      },
    });

    const first = preload('/stats');
    const second = preload('/stats');

    assert.equal(first, second);
    assert.equal(loadCount, 0);

    finishLoad();
    assert.equal(await first, true);
    assert.equal(await second, true);
    assert.equal(loadCount, 1);
    assert.equal(await preload('/stats'), true);
    assert.equal(loadCount, 1);
  });

  it('allows a later retry when background preloading fails', async () => {
    let loadCount = 0;
    const failures = [];
    const preload = createRoutePreloader({
      '/stats': async () => {
        loadCount += 1;
        if (loadCount === 1) throw new Error('temporary failure');
      },
    }, {
      onError: (error, path) => failures.push({ message: error.message, path }),
    });

    assert.equal(await preload('/stats'), false);
    assert.deepEqual(failures, [{ message: 'temporary failure', path: '/stats' }]);
    assert.equal(await preload('/stats'), true);
    assert.equal(loadCount, 2);
  });

  it('ignores routes without a preload loader', async () => {
    const preload = createRoutePreloader({});
    assert.equal(await preload('/not-preloaded'), false);
  });
});
