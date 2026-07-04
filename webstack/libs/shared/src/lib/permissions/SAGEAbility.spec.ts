/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { SAGE3Ability, ActionArg, ResourceArg } from './SAGEAbility';

const ALL_ACTIONS: ActionArg[] = [
  'create',
  'read',
  'update',
  'delete',
  'upload',
  'download',
  'resize',
  'move',
  'lasso',
  'execute',
  'sub',
  'unsub',
  'join',
  'pin',
  'lock',
];

const ALL_RESOURCES: ResourceArg[] = [
  'assets',
  'apps',
  'boards',
  'message',
  'plugins',
  'presence',
  'rooms',
  'users',
  'kernels',
  'insight',
  'annotations',
  'roommembers',
  'links',
];

describe('SAGE3Ability — guest role', () => {
  // Regression test for a real incident: a commit unrelated to permissions
  // (titled as a CI/Jenkins change) silently reintroduced guest write access
  // to apps, directly contradicting an already-communicated fix. This test
  // pins the guest role to content-read-only (except their own presence/user
  // records) so any future change widening it fails loudly here first.
  it('cannot create, update, resize, move, or lasso apps', () => {
    for (const action of ['create', 'update', 'delete', 'resize', 'move', 'lasso', 'lock', 'pin'] as ActionArg[]) {
      expect(SAGE3Ability.can('guest', action, 'apps')).toBe(false);
    }
  });

  it('cannot create, update, or delete boards or rooms', () => {
    for (const resource of ['boards', 'rooms'] as ResourceArg[]) {
      for (const action of ['create', 'update', 'delete'] as ActionArg[]) {
        expect(SAGE3Ability.can('guest', action, resource)).toBe(false);
      }
    }
  });

  it('cannot delete anything, on any resource', () => {
    for (const resource of ALL_RESOURCES) {
      expect(SAGE3Ability.can('guest', 'delete', resource)).toBe(false);
    }
  });

  it('can create, read, and update its own presence and user records', () => {
    for (const resource of ['presence', 'users'] as ResourceArg[]) {
      expect(SAGE3Ability.can('guest', 'create', resource)).toBe(true);
      expect(SAGE3Ability.can('guest', 'read', resource)).toBe(true);
      expect(SAGE3Ability.can('guest', 'update', resource)).toBe(true);
    }
  });

  it('can read every resource', () => {
    for (const resource of ALL_RESOURCES) {
      expect(SAGE3Ability.can('guest', 'read', resource)).toBe(true);
    }
  });

  it('can download assets', () => {
    expect(SAGE3Ability.can('guest', 'download', 'assets')).toBe(true);
  });
});

describe('SAGE3Ability — spectator role', () => {
  it('is read-only across every resource', () => {
    for (const resource of ALL_RESOURCES) {
      expect(SAGE3Ability.can('spectator', 'read', resource)).toBe(true);
      expect(SAGE3Ability.can('spectator', 'create', resource)).toBe(false);
      expect(SAGE3Ability.can('spectator', 'update', resource)).toBe(false);
      expect(SAGE3Ability.can('spectator', 'delete', resource)).toBe(false);
    }
  });

  it('can download assets', () => {
    expect(SAGE3Ability.can('spectator', 'download', 'assets')).toBe(true);
  });
});

describe('SAGE3Ability — admin and user roles', () => {
  it('admin can do everything on every resource', () => {
    for (const resource of ALL_RESOURCES) {
      for (const action of ALL_ACTIONS) {
        expect(SAGE3Ability.can('admin', action, resource)).toBe(true);
      }
    }
  });

  it('user can do everything on every resource', () => {
    for (const resource of ALL_RESOURCES) {
      for (const action of ALL_ACTIONS) {
        expect(SAGE3Ability.can('user', action, resource)).toBe(true);
      }
    }
  });
});

describe('SAGE3Ability — can()', () => {
  it('returns false when role is undefined', () => {
    expect(SAGE3Ability.can(undefined, 'read', 'apps')).toBe(false);
  });
});

describe('SAGE3Ability — canCurrentUser()', () => {
  // No test in this file calls setUser(), so the shared singleton's user
  // stays unset here — this must run before any test elsewhere sets one.
  it('returns false when no user has been set', () => {
    expect(SAGE3Ability.canCurrentUser('read', 'apps')).toBe(false);
  });
});
