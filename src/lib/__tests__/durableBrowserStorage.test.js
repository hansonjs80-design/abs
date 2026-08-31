import assert from 'node:assert/strict';
import test from 'node:test';

import { requestPersistentBrowserStorage } from '../durableBrowserStorage.js';

test('reuses an already persistent browser storage grant', async () => {
  let persistCalls = 0;
  const granted = await requestPersistentBrowserStorage({
    navigator: {
      storage: {
        async persisted() { return true; },
        async persist() {
          persistCalls += 1;
          return true;
        },
      },
    },
  });

  assert.equal(granted, true);
  assert.equal(persistCalls, 0);
});

test('requests persistent browser storage when it has not been granted yet', async () => {
  let persistCalls = 0;
  const granted = await requestPersistentBrowserStorage({
    navigator: {
      storage: {
        async persisted() { return false; },
        async persist() {
          persistCalls += 1;
          return true;
        },
      },
    },
  });

  assert.equal(granted, true);
  assert.equal(persistCalls, 1);
});
