/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { checkPermissionsWS } from './permissions';
import { SBAuthSchema } from '@sage3/sagebase';

function auth(overrides: Partial<SBAuthSchema>): SBAuthSchema {
  return { provider: 'ldap', providerId: 'uid=test', id: 'auth-1', ...overrides };
}

describe('checkPermissionsWS — role resolution', () => {
  // Regression coverage for the bug where LDAP's group→role mapping was
  // computed (LDAPAdapter.resolveRole) but never actually consulted here:
  // every LDAP login was granted the coarse, hardcoded provider→role of
  // 'user' regardless of which group it matched, so a group meant to map to
  // 'spectator' (read-only) got full read-write access instead.

  it('an LDAP user with a persisted admin role can create apps', () => {
    expect(checkPermissionsWS(auth({ role: 'admin' }), 'POST', 'APPS')).toBe(true);
  });

  it('an LDAP user with a persisted spectator role cannot create apps', () => {
    expect(checkPermissionsWS(auth({ role: 'spectator' }), 'POST', 'APPS')).toBe(false);
  });

  it('an LDAP user with a persisted spectator role can still read apps', () => {
    expect(checkPermissionsWS(auth({ role: 'spectator' }), 'GET', 'APPS')).toBe(true);
  });

  it('an LDAP auth record with no persisted role falls back to the coarse provider map (user)', () => {
    // Non-LDAP-group-mapped LDAP logins, or records created before this fix.
    expect(checkPermissionsWS(auth({ role: undefined }), 'POST', 'APPS')).toBe(true);
  });

  it('a non-LDAP provider (google) is unaffected — role field is never set for it', () => {
    expect(checkPermissionsWS(auth({ provider: 'google', role: undefined }), 'POST', 'APPS')).toBe(true);
  });

  it('a guest auth record is never elevated even if a role field were somehow present', () => {
    // Defense in depth: only providers known to resolve a role dynamically
    // (currently just 'ldap') have their persisted role field trusted at
    // all. Guest never legitimately sets extras.role — only LDAPAdapter
    // does — so this models a malformed/forged record rather than a real
    // code path, and must still resolve to the coarse 'guest' role, not
    // whatever role happens to be sitting in the field.
    expect(checkPermissionsWS(auth({ provider: 'guest', role: 'admin' }), 'DELETE', 'APPS')).toBe(false);
  });
});
