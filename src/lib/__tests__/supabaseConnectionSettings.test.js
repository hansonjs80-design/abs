import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SUPABASE_CONNECTION_STORAGE_KEY,
  clearSupabaseConnectionSettings,
  loadSupabaseConnectionSettings,
  saveSupabaseConnectionSettings,
  validateSupabaseConnection,
} from '../supabaseConnectionSettings.js';

const DEFAULT_CONNECTION = {
  url: 'https://default-project.supabase.co',
  anonKey: 'default-public-anon-key-1234567890',
};

const createMemoryStorage = (initialValue = null) => {
  const values = new Map();
  if (initialValue !== null) {
    values.set(SUPABASE_CONNECTION_STORAGE_KEY, initialValue);
  }
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
};

describe('Supabase connection settings', () => {
  it('uses the build connection when this device has no override', () => {
    const result = loadSupabaseConnectionSettings({
      storage: createMemoryStorage(),
      defaults: DEFAULT_CONNECTION,
    });

    assert.deepEqual(result.connection, DEFAULT_CONNECTION);
    assert.equal(result.source, 'build');
    assert.equal(result.hasStoredOverride, false);
  });

  it('loads a valid device override and normalizes a trailing slash', () => {
    const storage = createMemoryStorage(JSON.stringify({
      url: 'https://next-project.supabase.co/',
      anonKey: 'next-public-anon-key-1234567890',
    }));
    const result = loadSupabaseConnectionSettings({
      storage,
      defaults: DEFAULT_CONNECTION,
    });

    assert.deepEqual(result.connection, {
      url: 'https://next-project.supabase.co',
      anonKey: 'next-public-anon-key-1234567890',
    });
    assert.equal(result.source, 'device');
    assert.equal(result.storedOverrideValid, true);
  });

  it('falls back to the build connection when stored JSON is damaged', () => {
    const result = loadSupabaseConnectionSettings({
      storage: createMemoryStorage('{not-json'),
      defaults: DEFAULT_CONNECTION,
    });

    assert.deepEqual(result.connection, DEFAULT_CONNECTION);
    assert.equal(result.source, 'build');
    assert.equal(result.hasStoredOverride, true);
    assert.equal(result.storedOverrideValid, false);
  });

  it('rejects service-role and secret keys', () => {
    const serviceRole = validateSupabaseConnection({
      url: 'https://example.supabase.co',
      anonKey: 'service_role_key_that_must_not_be_stored',
    });
    const secret = validateSupabaseConnection({
      url: 'https://example.supabase.co',
      anonKey: 'sb_secret_12345678901234567890',
    });
    const serviceRoleJwt = validateSupabaseConnection({
      url: 'https://example.supabase.co',
      anonKey: 'e30.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature-that-is-long-enough',
    });

    assert.equal(serviceRole.valid, false);
    assert.match(serviceRole.errors.anonKey, /공개용/);
    assert.equal(secret.valid, false);
    assert.match(secret.errors.anonKey, /공개용/);
    assert.equal(serviceRoleJwt.valid, false);
    assert.match(serviceRoleJwt.errors.anonKey, /공개용/);
  });

  it('allows https and local development URLs but rejects external http URLs', () => {
    assert.equal(validateSupabaseConnection({
      url: 'https://example.supabase.co',
      anonKey: 'public-anon-key-1234567890',
    }).valid, true);
    assert.equal(validateSupabaseConnection({
      url: 'http://localhost:54321',
      anonKey: 'public-anon-key-1234567890',
    }).valid, true);
    assert.equal(validateSupabaseConnection({
      url: 'http://example.supabase.co',
      anonKey: 'public-anon-key-1234567890',
    }).valid, false);
  });

  it('saves and clears only the device override', () => {
    const storage = createMemoryStorage();
    saveSupabaseConnectionSettings({
      url: 'https://next-project.supabase.co/',
      anonKey: 'next-public-anon-key-1234567890',
    }, storage);

    assert.equal(
      loadSupabaseConnectionSettings({ storage, defaults: DEFAULT_CONNECTION }).source,
      'device',
    );

    clearSupabaseConnectionSettings(storage);
    assert.equal(
      loadSupabaseConnectionSettings({ storage, defaults: DEFAULT_CONNECTION }).source,
      'build',
    );
  });
});
