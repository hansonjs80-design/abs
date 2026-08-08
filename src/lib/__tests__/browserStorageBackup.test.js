import assert from 'node:assert/strict';
import test from 'node:test';

import {
  readStorageValueWithCookieBackup,
  writeStorageValueWithCookieBackup,
} from '../browserStorageBackup.js';

function createStorage(entries = {}) {
  const values = new Map(Object.entries(entries));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

function createCookieDocument(entries = {}) {
  const values = new Map(Object.entries(entries));
  return {
    get cookie() {
      return Array.from(values, ([key, value]) => `${key}=${value}`).join('; ');
    },
    set cookie(serialized) {
      const [pair] = String(serialized).split(';');
      const separator = pair.indexOf('=');
      values.set(pair.slice(0, separator), pair.slice(separator + 1));
    },
  };
}

test('restores a display setting from the long-lived cookie after local storage is empty', () => {
  const firstStorage = createStorage();
  const restartedStorage = createStorage();
  const document = createCookieDocument();

  writeStorageValueWithCookieBackup('display-row-height', '31.5', firstStorage, document);
  const restored = readStorageValueWithCookieBackup(
    'display-row-height',
    restartedStorage,
    document
  );

  assert.equal(restored, '31.5');
  assert.equal(restartedStorage.getItem('display-row-height'), '31.5');
});

test('keeps a cookie copy even when browser storage temporarily rejects writes', () => {
  const unavailableStorage = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
  };
  const document = createCookieDocument();

  writeStorageValueWithCookieBackup('display-font-size', '15', unavailableStorage, document);

  assert.equal(
    readStorageValueWithCookieBackup('display-font-size', unavailableStorage, document),
    '15'
  );
});
