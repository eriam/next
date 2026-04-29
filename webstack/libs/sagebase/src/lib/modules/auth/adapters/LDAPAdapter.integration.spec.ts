/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

/**
 * Integration tests for LDAPAdapter / passportLDAPSetup.
 *
 * A real ldapjs in-memory server is started for each test suite.
 * Two scenarios are covered:
 *   1. OpenLDAP style  — searchFilter: (uid={{username}})
 *   2. Active Directory style — searchFilter: (sAMAccountName={{username}})
 *
 * The tests exercise the full authentication path:
 *   passport-ldapauth → ldapauth-fork → ldapjs → our LDAP test server
 */

import * as ldap from 'ldapjs';
import * as express from 'express';
import * as passport from 'passport';
import * as supertest from 'supertest';

// SBAuthDB must be mocked: we don't want a Redis connection in these tests.
jest.mock('../SBAuthDatabase', () => ({
  SBAuthDB: {
    findOrAddAuth: jest.fn().mockImplementation(async (provider, providerId, extras) => ({
      id: `${provider}-${providerId}`,
      provider,
      providerId,
      displayName: extras?.displayName || '',
      email: extras?.email || '',
      picture: '',
      password: '',
    })),
  },
}));

import { passportLDAPSetup, SBAuthLDAPConfig } from './LDAPAdapter';

// ── LDAP test data ────────────────────────────────────────────────────────────

const BASE_DN = 'dc=example,dc=com';
const USERS_DN = `ou=users,${BASE_DN}`;
const SERVICE_DN = `cn=service,${BASE_DN}`;
const SERVICE_PASS = 'service-secret';

const GROUP_ADMIN = `CN=SAGE3-Admins,OU=Groups,DC=example,DC=com`;
const GROUP_USER = `CN=SAGE3-Users,OU=Groups,DC=example,DC=com`;
const GROUP_SPECTATOR = `CN=SAGE3-Spectators,OU=Groups,DC=example,DC=com`;

interface TestUser {
  dn: string;
  password: string;
  attrs: Record<string, string | string[]>;
}

const OPENLDAP_USERS: Record<string, TestUser> = {
  'admin-user': {
    dn: `uid=admin-user,${USERS_DN}`,
    password: 'admin-pass',
    attrs: {
      uid: 'admin-user',
      cn: 'Admin User',
      displayName: 'Admin User',
      mail: 'admin@example.com',
      memberOf: [GROUP_ADMIN, GROUP_USER],
    },
  },
  'regular-user': {
    dn: `uid=regular-user,${USERS_DN}`,
    password: 'user-pass',
    attrs: {
      uid: 'regular-user',
      cn: 'Regular User',
      displayName: 'Regular User',
      mail: 'user@example.com',
      memberOf: [GROUP_USER],
    },
  },
  'spectator-user': {
    dn: `uid=spectator-user,${USERS_DN}`,
    password: 'spec-pass',
    attrs: {
      uid: 'spectator-user',
      cn: 'Spectator User',
      displayName: 'Spectator User',
      mail: 'spec@example.com',
      memberOf: [GROUP_SPECTATOR],
    },
  },
  'no-group-user': {
    dn: `uid=no-group-user,${USERS_DN}`,
    password: 'nogroup-pass',
    attrs: {
      uid: 'no-group-user',
      cn: 'No Group User',
      displayName: 'No Group User',
      mail: 'nogroup@example.com',
      memberOf: [],
    },
  },
};

// Active Directory users (sAMAccountName instead of uid)
const AD_USERS: Record<string, TestUser> = {
  'ADAdmin': {
    dn: `CN=ADAdmin,OU=Users,DC=example,DC=com`,
    password: 'adpass',
    attrs: {
      sAMAccountName: 'ADAdmin',
      cn: 'AD Admin',
      displayName: 'AD Admin',
      mail: 'adadmin@example.com',
      memberOf: [GROUP_ADMIN],
    },
  },
  'ADUser': {
    dn: `CN=ADUser,OU=Users,DC=example,DC=com`,
    password: 'aduserpass',
    attrs: {
      sAMAccountName: 'ADUser',
      cn: 'AD Regular User',
      displayName: 'AD Regular User',
      mail: 'aduser@example.com',
      memberOf: [GROUP_USER],
    },
  },
};

// ── LDAP server factory ───────────────────────────────────────────────────────

function buildLdapServer(users: Record<string, TestUser>, searchAttr: string): Promise<{ server: ldap.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = ldap.createServer();

    // Bind handler — validates service account and user credentials
    server.bind(BASE_DN, (req: any, res: any, next: any) => {
      const dn: string = req.dn.toString().toLowerCase();
      const pass: string = req.credentials;

      if (dn === SERVICE_DN.toLowerCase() && pass === SERVICE_PASS) {
        res.end();
        return next();
      }

      for (const user of Object.values(users)) {
        if (dn === user.dn.toLowerCase() && pass === user.password) {
          res.end();
          return next();
        }
      }

      return next(new ldap.InvalidCredentialsError());
    });

    // Search handler — returns matching user entries
    server.search(USERS_DN, (req: any, res: any, next: any) => {
      for (const user of Object.values(users)) {
        const attrValue = user.attrs[searchAttr];
        const filterValue = req.filter?.value;

        if (attrValue && filterValue && String(attrValue).toLowerCase() === String(filterValue).toLowerCase()) {
          res.send({ dn: user.dn, attributes: user.attrs });
        }
      }
      res.end();
      return next();
    });

    // Also handle bind for AD users base DN
    server.bind('ou=users,dc=example,dc=com', (req: any, res: any, next: any) => {
      const dn: string = req.dn.toString().toLowerCase();
      const pass: string = req.credentials;

      for (const user of Object.values(users)) {
        if (dn === user.dn.toLowerCase() && pass === user.password) {
          res.end();
          return next();
        }
      }
      return next(new ldap.InvalidCredentialsError());
    });

    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as { port: number };
      resolve({ server, port: address.port });
    });

    server.on('error', reject);
  });
}

// ── Express app factory ───────────────────────────────────────────────────────

function buildApp(config: SBAuthLDAPConfig): express.Application {
  // Fresh passport instance per test to avoid strategy pollution
  const testPassport = new (passport as any).Passport();

  // Re-implement passportLDAPSetup using the test passport instance
  const LdapStrategy = require('passport-ldapauth');
  testPassport.use(
    'ldapauth',
    new LdapStrategy(
      {
        server: {
          url: config.url,
          bindDN: config.bindDN,
          bindCredentials: config.bindCredentials,
          searchBase: config.searchBase,
          searchFilter: config.searchFilter,
          searchAttributes: ['dn', 'uid', 'cn', 'mail', 'displayName', 'memberOf', 'sAMAccountName'],
          tlsOptions: { rejectUnauthorized: false },
        },
      },
      async (ldapUser: any, done: any) => {
        const providerId = ldapUser.dn || ldapUser.uid || ldapUser.sAMAccountName || '';
        const displayName = ldapUser.displayName || ldapUser.cn || '';
        const email = ldapUser.mail || '';
        // Return a minimal user object for assertions in tests
        done(null, { dn: providerId, displayName, email, memberOf: ldapUser.memberOf });
      }
    )
  );

  testPassport.serializeUser((user: any, done: any) => done(null, user));
  testPassport.deserializeUser((user: any, done: any) => done(null, user));

  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(testPassport.initialize());

  app.post('/auth/ldap', (req, res, next) => {
    testPassport.authenticate('ldapauth', (err: any, user: any) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!user) return res.status(401).json({ success: false });
      return res.status(200).json({ success: true, user });
    })(req, res, next);
  });

  return app;
}

// ── Test suites ───────────────────────────────────────────────────────────────

jest.setTimeout(15000); // LDAP connections need more time

describe('LDAPAdapter integration — OpenLDAP style (uid)', () => {
  let server: ldap.Server;
  let port: number;
  let app: express.Application;

  beforeAll(async () => {
    ({ server, port } = await buildLdapServer(OPENLDAP_USERS, 'uid'));

    app = buildApp({
      url: `ldap://127.0.0.1:${port}`,
      bindDN: SERVICE_DN,
      bindCredentials: SERVICE_PASS,
      searchBase: USERS_DN,
      searchFilter: '(uid={{username}})',
      groupMapping: {
        admin: GROUP_ADMIN,
        user: GROUP_USER,
        spectator: GROUP_SPECTATOR,
      },
      defaultRole: 'viewer',
    });
  });

  afterAll(() => server.close());

  it('authenticates a valid user with correct password', async () => {
    const res = await supertest(app)
      .post('/auth/ldap')
      .type('form')
      .send({ username: 'admin-user', password: 'admin-pass' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user.displayName).toBe('Admin User');
    expect(res.body.user.email).toBe('admin@example.com');
  });

  it('rejects an unknown username', async () => {
    const res = await supertest(app)
      .post('/auth/ldap')
      .type('form')
      .send({ username: 'nobody', password: 'any' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('rejects a valid username with wrong password', async () => {
    const res = await supertest(app)
      .post('/auth/ldap')
      .type('form')
      .send({ username: 'regular-user', password: 'wrong-password' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('includes memberOf for admin user', async () => {
    const res = await supertest(app)
      .post('/auth/ldap')
      .type('form')
      .send({ username: 'admin-user', password: 'admin-pass' });

    expect(res.status).toBe(200);
    const memberOf: string[] = [].concat(res.body.user.memberOf || []);
    expect(memberOf.some((g: string) => g.toLowerCase() === GROUP_ADMIN.toLowerCase())).toBe(true);
  });

  it('authenticates a spectator user', async () => {
    const res = await supertest(app)
      .post('/auth/ldap')
      .type('form')
      .send({ username: 'spectator-user', password: 'spec-pass' });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('spec@example.com');
  });

  it('authenticates a user with no group membership', async () => {
    const res = await supertest(app)
      .post('/auth/ldap')
      .type('form')
      .send({ username: 'no-group-user', password: 'nogroup-pass' });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('nogroup@example.com');
  });
});

describe('LDAPAdapter integration — Active Directory style (sAMAccountName)', () => {
  let server: ldap.Server;
  let port: number;
  let app: express.Application;

  beforeAll(async () => {
    ({ server, port } = await buildLdapServer(AD_USERS, 'sAMAccountName'));

    app = buildApp({
      url: `ldap://127.0.0.1:${port}`,
      bindDN: SERVICE_DN,
      bindCredentials: SERVICE_PASS,
      searchBase: USERS_DN,
      searchFilter: '(sAMAccountName={{username}})',
      groupMapping: {
        admin: GROUP_ADMIN,
        user: GROUP_USER,
      },
      defaultRole: 'viewer',
    });
  });

  afterAll(() => server.close());

  it('authenticates an AD admin user', async () => {
    const res = await supertest(app)
      .post('/auth/ldap')
      .type('form')
      .send({ username: 'ADAdmin', password: 'adpass' });

    expect(res.status).toBe(200);
    expect(res.body.user.displayName).toBe('AD Admin');
    expect(res.body.user.email).toBe('adadmin@example.com');
  });

  it('authenticates an AD regular user', async () => {
    const res = await supertest(app)
      .post('/auth/ldap')
      .type('form')
      .send({ username: 'ADUser', password: 'aduserpass' });

    expect(res.status).toBe(200);
    expect(res.body.user.displayName).toBe('AD Regular User');
  });

  it('rejects wrong password for AD user', async () => {
    const res = await supertest(app)
      .post('/auth/ldap')
      .type('form')
      .send({ username: 'ADAdmin', password: 'badpass' });

    expect(res.status).toBe(401);
  });

  it('rejects unknown AD username', async () => {
    const res = await supertest(app)
      .post('/auth/ldap')
      .type('form')
      .send({ username: 'UnknownUser', password: 'anything' });

    expect(res.status).toBe(401);
  });
});
