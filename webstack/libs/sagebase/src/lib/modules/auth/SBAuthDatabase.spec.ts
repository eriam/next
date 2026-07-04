/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { SBAuthDatabase } from './SBAuthDatabase';

/**
 * Minimal in-memory stand-in for the slice of RedisClientType this module
 * actually uses (json.set/get/del, ft.dropIndex/create, duplicate, connect).
 * Real behavior, not a mock that just records calls — json.set/get operate
 * on a real backing Map so findOrAddAuth's find-then-add/update logic is
 * exercised against genuine read-your-own-writes semantics.
 */
function createFakeRedisClient() {
  const store = new Map<string, unknown>();
  const client = {
    duplicate: () => client,
    connect: async () => undefined,
    ft: {
      dropIndex: async () => undefined,
      create: async () => undefined,
    },
    json: {
      set: async (key: string, path: string, value: unknown) => {
        if (path === '.') {
          store.set(key, value);
        } else {
          // Only '$.role' is used for partial updates in this module.
          const existing = (store.get(key) as Record<string, unknown>) ?? {};
          const field = path.replace(/^\$\./, '');
          store.set(key, { ...existing, [field]: value });
        }
        return 'OK';
      },
      get: async (key: string) => store.get(key) ?? null,
      del: async (key: string) => (store.delete(key) ? 1 : 0),
    },
  };
  return client;
}

describe('SBAuthDatabase — role persistence', () => {
  let db: SBAuthDatabase;

  beforeEach(async () => {
    db = new SBAuthDatabase();
    await db.init(createFakeRedisClient() as any, 'test');
  });

  it('persists role when provided on creation', async () => {
    const auth = await db.addAuth('ldap', 'uid=alice', { displayName: 'Alice', email: 'alice@example.com', role: 'admin' });
    expect(auth?.role).toBe('admin');
  });

  it('omits role when not provided (backward compatible with non-LDAP providers)', async () => {
    const auth = await db.addAuth('google', 'google-id-1', { displayName: 'Bob', email: 'bob@example.com' });
    expect(auth?.role).toBeUndefined();
  });

  it('findOrAddAuth creates a new record with the resolved role on first login', async () => {
    const auth = await db.findOrAddAuth('ldap', 'uid=alice', { displayName: 'Alice', role: 'admin' });
    expect(auth?.role).toBe('admin');
  });

  it('findOrAddAuth re-syncs the persisted role when a later login resolves a different one', async () => {
    // First login: alice is in the admin group.
    await db.findOrAddAuth('ldap', 'uid=alice', { displayName: 'Alice', role: 'admin' });
    // Second login: alice has since been removed from the admin group and now
    // only matches the default role. This must take effect immediately —
    // access granted by group membership must also be revoked by it.
    const auth = await db.findOrAddAuth('ldap', 'uid=alice', { displayName: 'Alice', role: 'spectator' });
    expect(auth?.role).toBe('spectator');
  });

  it('findOrAddAuth leaves the role unchanged when the resolved role is the same', async () => {
    await db.findOrAddAuth('ldap', 'uid=bob', { displayName: 'Bob', role: 'user' });
    const auth = await db.findOrAddAuth('ldap', 'uid=bob', { displayName: 'Bob', role: 'user' });
    expect(auth?.role).toBe('user');
  });

  it('findOrAddAuth does not touch an existing role when no role is supplied (non-LDAP providers)', async () => {
    await db.addAuth('google', 'google-id-2', { displayName: 'Carol', role: 'admin' });
    // A provider that never resolves a role (e.g. google) must not silently
    // wipe out whatever role happened to be there.
    const auth = await db.findOrAddAuth('google', 'google-id-2', { displayName: 'Carol' });
    expect(auth?.role).toBe('admin');
  });

  it('a pre-existing record created before this feature (no role field at all) gets the role backfilled on next login', async () => {
    // Simulates a record persisted by an older version of addAuth that never wrote `role`.
    await db.addAuth('ldap', 'uid=dave', { displayName: 'Dave' });
    const auth = await db.findOrAddAuth('ldap', 'uid=dave', { displayName: 'Dave', role: 'user' });
    expect(auth?.role).toBe('user');
  });
});
