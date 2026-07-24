import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  authenticateLegacyAppUser,
  legacyPasswordsMatch,
} from '../legacyAppUserAuth.js';

function createSupabaseMock({ data = null, error = null } = {}) {
  return {
    from() {
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        limit() { return builder; },
        single() { return Promise.resolve({ data, error }); },
      };
      return builder;
    },
  };
}

describe('legacy app user authentication', () => {
  it('compares exact passwords without trimming meaningful spaces', async () => {
    assert.equal(await legacyPasswordsMatch(' password ', ' password '), true);
    assert.equal(await legacyPasswordsMatch(' password ', 'password'), false);
  });

  it('returns a profile without exposing the stored password', async () => {
    const profile = await authenticateLegacyAppUser({
      supabaseClient: createSupabaseMock({
        data: {
          id: 'user-1',
          username: 'staff',
          password: 'secret',
          display_name: '직원',
          role: 'user',
          permissions: {},
          is_active: true,
        },
      }),
      username: 'staff',
      password: 'secret',
    });

    assert.equal(profile.username, 'staff');
    assert.equal(Object.hasOwn(profile, 'password'), false);
  });

  it('rejects an invalid legacy password', async () => {
    await assert.rejects(
      authenticateLegacyAppUser({
        supabaseClient: createSupabaseMock({
          data: {
            id: 'user-1',
            username: 'staff',
            password: 'secret',
            is_active: true,
          },
        }),
        username: 'staff',
        password: 'wrong',
      }),
      /Invalid login credentials/
    );
  });
});
