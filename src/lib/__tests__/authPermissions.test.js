import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  canAccessTab,
  isAdminUser,
  normalizePermissions,
} from '../authPermissions.js';

describe('auth permissions', () => {
  it('does not grant admin rights from a username alone', () => {
    assert.equal(isAdminUser({ username: 'admin' }), false);
  });

  it('recognizes trusted Supabase Auth app metadata roles', () => {
    assert.equal(isAdminUser({
      email: 'owner@example.com',
      app_metadata: { role: 'admin' },
    }), true);
  });

  it('uses Supabase Auth app metadata permissions for normal users', () => {
    const user = {
      email: 'staff@example.com',
      app_metadata: {
        permissions: {
          shockwave: true,
          shockwave_stats: false,
        },
      },
    };

    assert.equal(canAccessTab(user, 'shockwave'), true);
    assert.equal(canAccessTab(user, 'shockwave_stats'), false);
    assert.equal(normalizePermissions(undefined, user).shockwave_stats, false);
  });
});
