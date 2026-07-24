import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const manifestUrl = new URL('../../../public/manifest.webmanifest', import.meta.url);

test('desktop PWA opts into window controls overlay with a standalone fallback', async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));

  assert.equal(manifest.display_override?.[0], 'window-controls-overlay');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
});
