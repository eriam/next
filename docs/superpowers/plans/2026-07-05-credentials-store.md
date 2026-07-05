# SAGE3 Credentials Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give SAGE3 a per-user, typed, encrypted-at-rest credentials store, with a first-party CTFd integration handler as its reference consumer, so a plugin never has to route a personal secret through SAGE3's shared app state or hand it to a third-party service directly from the browser.

**Architecture:** A new `SBCredentialsDatabase` (mirroring the existing `SBAuthDatabase`'s direct Redis JSON + RediSearch pattern) stores credentials encrypted with AES-256-GCM. A REST API at `/api/credentials`, scoped to the calling user, handles create/list/update/delete — list/create/update never return the plaintext, and there is no read-back endpoint. A single first-party integration handler at `/api/integrations/ctfd/register` is the only code path that ever decrypts a value, and only to complete a real CTFd registration server-side.

**Tech Stack:** TypeScript, Node's built-in `crypto` module (AES-256-GCM), Redis (RedisJSON + RediSearch, via the `redis` npm client already used throughout `libs/sagebase`), Express, Jest + ts-jest (unit tests with a fake Redis client, integration tests against a real `redis/redis-stack-server` Docker container — same pattern as `SBAuthDatabase.integration.spec.ts`), supertest (real Express + HTTP integration tests for the REST routes — same pattern as `permissions.integration.spec.ts`).

## Global Constraints

- Spec doc: `docs/superpowers/specs/2026-07-05-credentials-store-design.md` — every task's requirements implicitly include everything in that spec; read it before starting Task 1.
- **No generic "proxy any request with this credential" capability may exist anywhere.** Only the fixed `ctfd` integration handler (Task 5) ever calls the decrypt function.
- **List/create/update REST responses must never include `encryptedValue` or any plaintext.** There is no "read a credential's value back" REST endpoint at all — decryption only ever happens inside a first-party integration handler, server-side.
- **Uniqueness key is `(ownerId, type, name)`** — not `(ownerId, name)`. The same name may be reused across different credential types for the same user.
- `PUT /api/credentials/:id` only replaces the value, never the name — renaming is out of scope for this plan.
- This plan spans two separate git repositories: **`/home/eriam/next`** (the SAGE3 monorepo — Tasks 1-5) and **`/home/eriam/CTFd-SAGE`** (the CTFd-SAGE plugin, a standalone Vite app with no dependency on `@sage3/frontend` — Task 6). Each task states which repo it's in; do not assume both live under the same working directory.
- Follow `libs/sagebase/src/lib/modules/auth/SBAuthDatabase.ts`'s existing pattern exactly: a plain class with a singleton export (e.g. `export const SBCredentialsDB = new SBCredentialsDatabase();`), direct `RedisClientType` JSON calls, a `RediSearch` TAG index for exact-match lookups — not the more generic `SBDatabase.collection<Type>()` abstraction used elsewhere.
- **RediSearch TAG queries must escape `@`, `.`, `-`, and `+`** in any value interpolated into a `{...}` tag filter (confirmed this session: unescaped hyphens/plus-signs in a TAG query throw a syntax error against real Redis Stack — this bit `SBAuthDatabase.deleteAuthByEmail` before it was fixed). `ownerId` values here are UUIDs containing hyphens, so this applies from the very first query you write — there is no "add escaping later" step in this plan.
- Match the session's established testing depth: every backend module gets both a unit test (fake Redis client / mocked HTTP) and a real-dependency integration test (real Redis Stack container via `REDIS_TEST_URL`, or real Express + supertest) — not mocks-only.

---

### Task 1: `credentialCrypto.ts` — AES-256-GCM encrypt/decrypt

**Files:**
- Create: `webstack/libs/sagebase/src/lib/modules/credentials/credentialCrypto.ts`
- Test: `webstack/libs/sagebase/src/lib/modules/credentials/credentialCrypto.spec.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (this is the first task).
- Produces: `CredentialType`, `CredentialValue` (the discriminated union), `CredentialDecryptionError`, `deriveEncryptionKey(secret: string): Buffer`, `encryptCredentialValue(key: Buffer, value: CredentialValue): string`, `decryptCredentialValue(key: Buffer, encrypted: string): CredentialValue` — Task 2 imports all of these.

- [ ] **Step 1: Write the failing tests**

Create `webstack/libs/sagebase/src/lib/modules/credentials/credentialCrypto.spec.ts`:

```typescript
/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import {
  deriveEncryptionKey,
  encryptCredentialValue,
  decryptCredentialValue,
  CredentialDecryptionError,
  CredentialValue,
} from './credentialCrypto';

describe('credentialCrypto', () => {
  const key = deriveEncryptionKey('test-secrets-encryption-key-not-for-real-use');

  it('round-trips a secretText value', () => {
    const value: CredentialValue = { type: 'secretText', secret: 'ctfd_abc123' };
    const encrypted = encryptCredentialValue(key, value);
    expect(decryptCredentialValue(key, encrypted)).toEqual(value);
  });

  it('round-trips a usernamePassword value', () => {
    const value: CredentialValue = { type: 'usernamePassword', username: 'svc-account', password: 'hunter2' };
    const encrypted = encryptCredentialValue(key, value);
    expect(decryptCredentialValue(key, encrypted)).toEqual(value);
  });

  it('round-trips an sshPrivateKey value, with and without a passphrase', () => {
    const withPassphrase: CredentialValue = {
      type: 'sshPrivateKey',
      username: 'deploy',
      privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----',
      passphrase: 'correct-horse-battery-staple',
    };
    expect(decryptCredentialValue(key, encryptCredentialValue(key, withPassphrase))).toEqual(withPassphrase);

    const withoutPassphrase: CredentialValue = {
      type: 'sshPrivateKey',
      username: 'deploy',
      privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----',
    };
    expect(decryptCredentialValue(key, encryptCredentialValue(key, withoutPassphrase))).toEqual(withoutPassphrase);
  });

  it('produces a different ciphertext each time (random IV), even for the same input', () => {
    const value: CredentialValue = { type: 'secretText', secret: 'same-secret' };
    const first = encryptCredentialValue(key, value);
    const second = encryptCredentialValue(key, value);
    expect(first).not.toBe(second);
    // Both still decrypt to the same plaintext.
    expect(decryptCredentialValue(key, first)).toEqual(value);
    expect(decryptCredentialValue(key, second)).toEqual(value);
  });

  it('throws CredentialDecryptionError when decrypting with the wrong key', () => {
    const value: CredentialValue = { type: 'secretText', secret: 'ctfd_abc123' };
    const encrypted = encryptCredentialValue(key, value);
    const wrongKey = deriveEncryptionKey('a-completely-different-key');
    expect(() => decryptCredentialValue(wrongKey, encrypted)).toThrow(CredentialDecryptionError);
  });

  it('throws CredentialDecryptionError when the ciphertext has been tampered with', () => {
    const value: CredentialValue = { type: 'secretText', secret: 'ctfd_abc123' };
    const encrypted = encryptCredentialValue(key, value);
    // Flip one character in the base64 payload — GCM's auth tag must catch this
    // rather than silently decrypting to garbage.
    const tampered = encrypted.slice(0, -4) + (encrypted.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA');
    expect(() => decryptCredentialValue(key, tampered)).toThrow(CredentialDecryptionError);
  });

  it('deriveEncryptionKey is deterministic for the same input secret', () => {
    const keyA = deriveEncryptionKey('some-secret');
    const keyB = deriveEncryptionKey('some-secret');
    expect(keyA.equals(keyB)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd webstack && npx nx test sagebase --testPathPattern=credentialCrypto`
Expected: FAIL — `Cannot find module './credentialCrypto'`

- [ ] **Step 3: Write the implementation**

Create `webstack/libs/sagebase/src/lib/modules/credentials/credentialCrypto.ts`:

```typescript
/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import * as crypto from 'crypto';

export type CredentialType = 'secretText' | 'usernamePassword' | 'sshPrivateKey';

// The plaintext shape saved for each type — never returned to the client
// after creation, only ever passed to encryptCredentialValue()/decrypted
// internally by a first-party integration handler.
export type CredentialValue =
  | { type: 'secretText'; secret: string }
  | { type: 'usernamePassword'; username: string; password: string }
  | { type: 'sshPrivateKey'; username: string; privateKey: string; passphrase?: string };

export class CredentialDecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialDecryptionError';
  }
}

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
// Fixed salt is intentional: the input to scrypt here (secretsEncryptionKey)
// is already a high-entropy server secret, not a low-entropy user password
// that needs per-use salting to defend against rainbow tables.
const KDF_SALT = 'sage3-credentials-store-v1';

/**
 * Derives a 32-byte AES-256 key from the server's secretsEncryptionKey
 * config value. Deterministic: the same input always yields the same key,
 * so existing encrypted credentials stay decryptable across restarts.
 */
export function deriveEncryptionKey(secret: string): Buffer {
  return crypto.scryptSync(secret, KDF_SALT, 32);
}

/**
 * Encrypts a CredentialValue into a single base64 string: a random 12-byte
 * IV, followed by the 16-byte GCM auth tag, followed by the ciphertext.
 */
export function encryptCredentialValue(key: Buffer, value: CredentialValue): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

/**
 * Decrypts a string produced by encryptCredentialValue(). Throws
 * CredentialDecryptionError (never a raw Node crypto error) if the key is
 * wrong or the ciphertext has been corrupted/tampered with — GCM's auth
 * tag check fails loudly rather than silently returning garbage.
 */
export function decryptCredentialValue(key: Buffer, encrypted: string): CredentialValue {
  try {
    const data = Buffer.from(encrypted, 'base64');
    const iv = data.subarray(0, IV_LENGTH);
    const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(plaintext.toString('utf8')) as CredentialValue;
  } catch (error) {
    throw new CredentialDecryptionError(
      `Failed to decrypt credential value: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd webstack && npx nx test sagebase --testPathPattern=credentialCrypto`
Expected: PASS, 7 tests

- [ ] **Step 5: Commit**

```bash
cd webstack
git add libs/sagebase/src/lib/modules/credentials/credentialCrypto.ts libs/sagebase/src/lib/modules/credentials/credentialCrypto.spec.ts
git commit -m "feat(credentials): add AES-256-GCM encrypt/decrypt for credential values"
```

---

### Task 2: `SBCredentialsDatabase` — CRUD, encrypted at rest, owner-scoped

**Files:**
- Create: `webstack/libs/sagebase/src/lib/modules/credentials/SBCredentialsDatabase.ts`
- Test: `webstack/libs/sagebase/src/lib/modules/credentials/SBCredentialsDatabase.spec.ts`
- Test: `webstack/libs/sagebase/src/lib/modules/credentials/SBCredentialsDatabase.integration.spec.ts`

**Interfaces:**
- Consumes: `CredentialType`, `CredentialValue`, `deriveEncryptionKey`, `encryptCredentialValue`, `decryptCredentialValue` from `./credentialCrypto` (Task 1).
- Produces: `SBCredentialSchema`, `SBCredentialMetadata`, class `SBCredentialsDatabase` with methods `init(redisClient: RedisClientType, prefix: string, encryptionKey: string): Promise<void>`, `createOrUpdate(ownerId: string, type: CredentialType, name: string, value: CredentialValue): Promise<SBCredentialMetadata>`, `updateValue(id: string, ownerId: string, value: CredentialValue): Promise<SBCredentialMetadata | undefined>`, `list(ownerId: string, type?: CredentialType): Promise<SBCredentialMetadata[]>`, `delete(id: string, ownerId: string): Promise<boolean>`, `getDecryptedValue(id: string, ownerId: string): Promise<CredentialValue | undefined>`, and the singleton export `export const SBCredentialsDB = new SBCredentialsDatabase();` — Tasks 3, 4, and 5 import `SBCredentialsDB` and these types directly.

- [ ] **Step 1: Write the failing unit tests**

Create `webstack/libs/sagebase/src/lib/modules/credentials/SBCredentialsDatabase.spec.ts`:

```typescript
/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 *
 * Fake Redis client backed by a real in-memory Map, matching only the
 * json.set/get/del and ft.dropIndex/create/search shape SBCredentialsDatabase
 * actually uses (same convention as SBAuthDatabase.spec.ts).
 */

import { SBCredentialsDatabase } from './SBCredentialsDatabase';

function createFakeRedisClient() {
  const store = new Map<string, unknown>();
  const client = {
    duplicate: () => client,
    connect: async () => undefined,
    ft: {
      dropIndex: async () => undefined,
      create: async () => 'OK',
      search: async (_index: string, query: string) => {
        // Parses the exact query shapes this module issues:
        //   @ownerId:{escaped}
        //   @ownerId:{escaped} @type:{escaped}
        const ownerMatch = query.match(/@ownerId:\{([^}]*)\}/);
        const typeMatch = query.match(/@type:\{([^}]*)\}/);
        const unescape = (s: string) => s.replace(/\\(.)/g, '$1');
        const ownerId = ownerMatch ? unescape(ownerMatch[1]) : undefined;
        const type = typeMatch ? unescape(typeMatch[1]) : undefined;

        const documents = Array.from(store.entries())
          .filter(([, value]: [string, any]) => {
            if (ownerId !== undefined && value.ownerId !== ownerId) return false;
            if (type !== undefined && value.type !== type) return false;
            return true;
          })
          .map(([key, value]) => ({ id: key, value }));
        return { total: documents.length, documents };
      },
    },
    json: {
      set: async (key: string, path: string, value: unknown) => {
        if (path === '.') store.set(key, value);
        return 'OK';
      },
      get: async (key: string) => store.get(key) ?? null,
      del: async (key: string) => (store.delete(key) ? 1 : 0),
    },
  };
  return client;
}

describe('SBCredentialsDatabase', () => {
  let db: SBCredentialsDatabase;

  beforeEach(async () => {
    db = new SBCredentialsDatabase();
    await db.init(createFakeRedisClient() as any, 'test', 'a-test-encryption-key');
  });

  it('createOrUpdate creates a new credential and never returns the value', async () => {
    const result = await db.createOrUpdate('user-1', 'secretText', 'my-ctfd-token', { type: 'secretText', secret: 'ctfd_abc' });
    expect(result).toMatchObject({ ownerId: 'user-1', type: 'secretText', name: 'my-ctfd-token' });
    expect(result.id).toBeTruthy();
    expect((result as any).encryptedValue).toBeUndefined();
    expect((result as any).secret).toBeUndefined();
  });

  it('createOrUpdate with an existing (ownerId, type, name) updates in place, keeping the same id', async () => {
    const first = await db.createOrUpdate('user-1', 'secretText', 'my-token', { type: 'secretText', secret: 'old-value' });
    const second = await db.createOrUpdate('user-1', 'secretText', 'my-token', { type: 'secretText', secret: 'new-value' });
    expect(second.id).toBe(first.id);
    expect(second.updatedAt).toBeGreaterThanOrEqual(first.updatedAt);

    const decrypted = await db.getDecryptedValue(first.id, 'user-1');
    expect(decrypted).toEqual({ type: 'secretText', secret: 'new-value' });
  });

  it('allows the same name to be reused across different types for the same user', async () => {
    const asSecret = await db.createOrUpdate('user-1', 'secretText', 'GitHub', { type: 'secretText', secret: 'tok' });
    const asUserPass = await db.createOrUpdate('user-1', 'usernamePassword', 'GitHub', {
      type: 'usernamePassword',
      username: 'me',
      password: 'pw',
    });
    expect(asSecret.id).not.toBe(asUserPass.id);

    const list = await db.list('user-1');
    expect(list).toHaveLength(2);
  });

  it('list returns only the calling owner\'s credentials, without values', async () => {
    await db.createOrUpdate('user-1', 'secretText', 'a', { type: 'secretText', secret: 's1' });
    await db.createOrUpdate('user-2', 'secretText', 'b', { type: 'secretText', secret: 's2' });

    const list = await db.list('user-1');
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('a');
    expect((list[0] as any).encryptedValue).toBeUndefined();
  });

  it('list filters by type when provided', async () => {
    await db.createOrUpdate('user-1', 'secretText', 'a', { type: 'secretText', secret: 's1' });
    await db.createOrUpdate('user-1', 'usernamePassword', 'b', { type: 'usernamePassword', username: 'u', password: 'p' });

    const secretsOnly = await db.list('user-1', 'secretText');
    expect(secretsOnly).toHaveLength(1);
    expect(secretsOnly[0].name).toBe('a');
  });

  it('updateValue replaces the value for an owned credential, keeping name/id/type', async () => {
    const created = await db.createOrUpdate('user-1', 'secretText', 'my-token', { type: 'secretText', secret: 'v1' });
    const updated = await db.updateValue(created.id, 'user-1', { type: 'secretText', secret: 'v2' });
    expect(updated).toMatchObject({ id: created.id, name: 'my-token', type: 'secretText' });

    const decrypted = await db.getDecryptedValue(created.id, 'user-1');
    expect(decrypted).toEqual({ type: 'secretText', secret: 'v2' });
  });

  it('updateValue returns undefined when the credential belongs to a different owner', async () => {
    const created = await db.createOrUpdate('user-1', 'secretText', 'my-token', { type: 'secretText', secret: 'v1' });
    const result = await db.updateValue(created.id, 'user-2', { type: 'secretText', secret: 'stolen' });
    expect(result).toBeUndefined();

    // Confirm the original value was untouched.
    const decrypted = await db.getDecryptedValue(created.id, 'user-1');
    expect(decrypted).toEqual({ type: 'secretText', secret: 'v1' });
  });

  it('updateValue returns undefined for a non-existent id', async () => {
    const result = await db.updateValue('does-not-exist', 'user-1', { type: 'secretText', secret: 'x' });
    expect(result).toBeUndefined();
  });

  it('delete removes an owned credential and returns true', async () => {
    const created = await db.createOrUpdate('user-1', 'secretText', 'my-token', { type: 'secretText', secret: 'v1' });
    expect(await db.delete(created.id, 'user-1')).toBe(true);
    expect(await db.list('user-1')).toHaveLength(0);
  });

  it('delete returns false when the credential belongs to a different owner, and does not delete it', async () => {
    const created = await db.createOrUpdate('user-1', 'secretText', 'my-token', { type: 'secretText', secret: 'v1' });
    expect(await db.delete(created.id, 'user-2')).toBe(false);
    expect(await db.list('user-1')).toHaveLength(1);
  });

  it('delete returns false for a non-existent id', async () => {
    expect(await db.delete('does-not-exist', 'user-1')).toBe(false);
  });

  it('getDecryptedValue returns undefined for a non-existent id', async () => {
    expect(await db.getDecryptedValue('does-not-exist', 'user-1')).toBeUndefined();
  });

  it('getDecryptedValue returns undefined when the credential belongs to a different owner', async () => {
    const created = await db.createOrUpdate('user-1', 'secretText', 'my-token', { type: 'secretText', secret: 'v1' });
    expect(await db.getDecryptedValue(created.id, 'user-2')).toBeUndefined();
  });

  it('correctly round-trips an ownerId containing hyphens (a real v4 UUID shape)', async () => {
    // Regression coverage: RediSearch TAG queries treat '-' as a syntax
    // character. ownerId here is always a v4 UUID (SBAuthSchema.id), which
    // always contains hyphens — this must work from the very first query.
    const ownerId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
    await db.createOrUpdate(ownerId, 'secretText', 'my-token', { type: 'secretText', secret: 'v1' });
    const list = await db.list(ownerId);
    expect(list).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd webstack && npx nx test sagebase --testPathPattern=SBCredentialsDatabase.spec`
Expected: FAIL — `Cannot find module './SBCredentialsDatabase'`

- [ ] **Step 3: Write the implementation**

Create `webstack/libs/sagebase/src/lib/modules/credentials/SBCredentialsDatabase.ts`:

```typescript
/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { RedisClientType, SchemaFieldTypes } from 'redis';
import { v4 } from 'uuid';

import {
  CredentialType,
  CredentialValue,
  deriveEncryptionKey,
  encryptCredentialValue,
  decryptCredentialValue,
} from './credentialCrypto';

export type SBCredentialSchema = {
  id: string;
  ownerId: string;
  name: string;
  type: CredentialType;
  encryptedValue: string;
  createdAt: number;
  updatedAt: number;
};

// What list/create/update return to the client — no encryptedValue, ever.
export type SBCredentialMetadata = Omit<SBCredentialSchema, 'encryptedValue'>;

function toMetadata(doc: SBCredentialSchema): SBCredentialMetadata {
  const { encryptedValue: _omitted, ...metadata } = doc;
  return metadata;
}

// RediSearch TAG queries treat '@', '.', '-', and '+' as syntax characters
// inside {...} — ownerId is always a v4 UUID (hyphens) and name is
// user-chosen (could contain any of these). Confirmed against real Redis
// Stack this session (SBAuthDatabase.deleteAuthByEmail hit the same issue).
function escapeTagValue(value: string): string {
  return value.replace(/[@.\-+]/g, '\\$&');
}

class SBCredentialsDatabase {
  private _redisClient!: RedisClientType;
  private _prefix!: string;
  private _indexName!: string;
  private _encryptionKey!: Buffer;

  public async init(redisClient: RedisClientType, prefix: string, encryptionKey: string): Promise<void> {
    this._redisClient = redisClient.duplicate();
    await this._redisClient.connect();

    this._prefix = prefix + ':CREDENTIALS';
    this._indexName = 'idx:credentials';
    this._encryptionKey = deriveEncryptionKey(encryptionKey);
    await this.createIndex();
  }

  private async createIndex(): Promise<void> {
    try {
      await this._redisClient.ft.dropIndex(this._indexName);
    } catch (error) {
      console.log('SBCredentials> Index does not exist yet, creating it now.');
    }
    await this._redisClient.ft.create(
      this._indexName,
      {
        '$.ownerId': { type: SchemaFieldTypes.TAG, AS: 'ownerId' },
        '$.type': { type: SchemaFieldTypes.TAG, AS: 'type' },
        '$.name': { type: SchemaFieldTypes.TAG, AS: 'name' },
      },
      {
        ON: 'JSON',
        PREFIX: this._prefix,
      }
    );
  }

  private async findByOwnerTypeName(ownerId: string, type: CredentialType, name: string): Promise<SBCredentialSchema | undefined> {
    const query = `@ownerId:{${escapeTagValue(ownerId)}} @type:{${escapeTagValue(type)}} @name:{${escapeTagValue(name)}}`;
    const response = await this._redisClient.ft.search(this._indexName, query);
    if (response.documents.length === 0) return undefined;
    return response.documents[0].value as unknown as SBCredentialSchema;
  }

  private async readById(id: string): Promise<SBCredentialSchema | undefined> {
    const response = await this._redisClient.json.get(`${this._prefix}:${id}`);
    return (response as SBCredentialSchema) ?? undefined;
  }

  /**
   * Creates a new credential, or — if one already exists for this
   * (ownerId, type, name) — updates its value in place, keeping the same id.
   * A benign, accepted race exists if two requests for the same brand-new
   * (ownerId, type, name) land concurrently (each would create a separate
   * document); this is a rare, low-stakes case (a user double-submitting a
   * form), not worth a distributed lock for.
   */
  public async createOrUpdate(
    ownerId: string,
    type: CredentialType,
    name: string,
    value: CredentialValue
  ): Promise<SBCredentialMetadata> {
    const existing = await this.findByOwnerTypeName(ownerId, type, name);
    const now = Date.now();
    const encryptedValue = encryptCredentialValue(this._encryptionKey, value);

    if (existing) {
      const updated: SBCredentialSchema = { ...existing, encryptedValue, updatedAt: now };
      await this._redisClient.json.set(`${this._prefix}:${existing.id}`, '.', updated);
      return toMetadata(updated);
    }

    const doc: SBCredentialSchema = {
      id: v4(),
      ownerId,
      name,
      type,
      encryptedValue,
      createdAt: now,
      updatedAt: now,
    };
    await this._redisClient.json.set(`${this._prefix}:${doc.id}`, '.', doc);
    return toMetadata(doc);
  }

  public async updateValue(id: string, ownerId: string, value: CredentialValue): Promise<SBCredentialMetadata | undefined> {
    const existing = await this.readById(id);
    if (!existing || existing.ownerId !== ownerId) return undefined;

    const updated: SBCredentialSchema = {
      ...existing,
      encryptedValue: encryptCredentialValue(this._encryptionKey, value),
      updatedAt: Date.now(),
    };
    await this._redisClient.json.set(`${this._prefix}:${id}`, '.', updated);
    return toMetadata(updated);
  }

  public async list(ownerId: string, type?: CredentialType): Promise<SBCredentialMetadata[]> {
    const query = type
      ? `@ownerId:{${escapeTagValue(ownerId)}} @type:{${escapeTagValue(type)}}`
      : `@ownerId:{${escapeTagValue(ownerId)}}`;
    const response = await this._redisClient.ft.search(this._indexName, query);
    return response.documents.map((doc) => toMetadata(doc.value as unknown as SBCredentialSchema));
  }

  public async delete(id: string, ownerId: string): Promise<boolean> {
    const existing = await this.readById(id);
    if (!existing || existing.ownerId !== ownerId) return false;
    const response = await this._redisClient.json.del(`${this._prefix}:${id}`);
    return response > 0;
  }

  /**
   * Internal-only: decrypts and returns the plaintext value. There is no
   * REST route that exposes this — only first-party integration handlers
   * (see e.g. the ctfd integration) may call it.
   */
  public async getDecryptedValue(id: string, ownerId: string): Promise<CredentialValue | undefined> {
    const existing = await this.readById(id);
    if (!existing || existing.ownerId !== ownerId) return undefined;
    return decryptCredentialValue(this._encryptionKey, existing.encryptedValue);
  }
}

export { SBCredentialsDatabase };
export const SBCredentialsDB = new SBCredentialsDatabase();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd webstack && npx nx test sagebase --testPathPattern=SBCredentialsDatabase.spec`
Expected: PASS, 14 tests

- [ ] **Step 5: Write the failing integration test**

Create `webstack/libs/sagebase/src/lib/modules/credentials/SBCredentialsDatabase.integration.spec.ts`:

```typescript
/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 *
 * Real Redis Stack integration test, gated on REDIS_TEST_URL (same
 * convention as SBAuthDatabase.integration.spec.ts). Run locally with:
 *   docker run -d --name credentials-test-redis -p 16400:6379 redis/redis-stack-server:latest
 *   REDIS_TEST_URL=redis://localhost:16400 npx nx test sagebase --testPathPattern=SBCredentialsDatabase.integration
 *   docker stop credentials-test-redis && docker rm credentials-test-redis
 */

import { createClient } from 'redis';
import { SBCredentialsDatabase } from './SBCredentialsDatabase';

const REDIS_URL = process.env.REDIS_TEST_URL;
const describeIfRedis = REDIS_URL ? describe : describe.skip;

describeIfRedis('SBCredentialsDatabase — real Redis Stack integration', () => {
  let db: SBCredentialsDatabase;
  let redisClient: ReturnType<typeof createClient>;

  beforeAll(async () => {
    redisClient = createClient({ url: REDIS_URL });
    await redisClient.connect();
    db = new SBCredentialsDatabase();
    await db.init(redisClient as any, `credentials-test-${Date.now()}`, 'integration-test-encryption-key');
  });

  afterAll(async () => {
    await redisClient.quit();
  });

  it('persists and retrieves an encrypted secretText credential across a fresh readById', async () => {
    const created = await db.createOrUpdate('real-redis-user-1', 'secretText', 'ctfd-token', {
      type: 'secretText',
      secret: 'ctfd_realredistoken',
    });
    const decrypted = await db.getDecryptedValue(created.id, 'real-redis-user-1');
    expect(decrypted).toEqual({ type: 'secretText', secret: 'ctfd_realredistoken' });
  });

  it('lists only the real Redis-persisted credentials owned by the given user', async () => {
    await db.createOrUpdate('real-redis-user-2', 'secretText', 'a', { type: 'secretText', secret: 's1' });
    await db.createOrUpdate('real-redis-user-3', 'secretText', 'b', { type: 'secretText', secret: 's2' });

    const list = await db.list('real-redis-user-2');
    expect(list.map((c) => c.name)).toEqual(['a']);
  });

  it('handles an ownerId with hyphens (real v4 UUID) against real RediSearch without a syntax error', async () => {
    const ownerId = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
    await db.createOrUpdate(ownerId, 'secretText', 'hyphen-test', { type: 'secretText', secret: 'v' });
    const list = await db.list(ownerId);
    expect(list).toHaveLength(1);
  });

  it('updateValue re-encrypts and persists the new value, readable after another getDecryptedValue call', async () => {
    const created = await db.createOrUpdate('real-redis-user-4', 'secretText', 'rotatable', {
      type: 'secretText',
      secret: 'v1',
    });
    await db.updateValue(created.id, 'real-redis-user-4', { type: 'secretText', secret: 'v2' });
    const decrypted = await db.getDecryptedValue(created.id, 'real-redis-user-4');
    expect(decrypted).toEqual({ type: 'secretText', secret: 'v2' });
  });

  it('delete actually removes the document from real Redis', async () => {
    const created = await db.createOrUpdate('real-redis-user-5', 'secretText', 'to-delete', {
      type: 'secretText',
      secret: 'v',
    });
    expect(await db.delete(created.id, 'real-redis-user-5')).toBe(true);
    expect(await db.getDecryptedValue(created.id, 'real-redis-user-5')).toBeUndefined();
  });
});
```

- [ ] **Step 6: Run the integration test against a real Redis Stack container**

Run:
```bash
docker run -d --name credentials-test-redis -p 16400:6379 redis/redis-stack-server:latest
sleep 3
cd webstack && REDIS_TEST_URL=redis://localhost:16400 npx nx test sagebase --testPathPattern=SBCredentialsDatabase.integration --skip-nx-cache
docker stop credentials-test-redis && docker rm credentials-test-redis
```
Expected: PASS, 5 tests

- [ ] **Step 7: Commit**

```bash
cd webstack
git add libs/sagebase/src/lib/modules/credentials/SBCredentialsDatabase.ts \
  libs/sagebase/src/lib/modules/credentials/SBCredentialsDatabase.spec.ts \
  libs/sagebase/src/lib/modules/credentials/SBCredentialsDatabase.integration.spec.ts
git commit -m "feat(credentials): add SBCredentialsDatabase — per-user, typed, encrypted-at-rest credential storage"
```

---

### Task 3: Wire `SBCredentialsDB` into SAGEBase's core init flow and server config

**Files:**
- Modify: `webstack/libs/sagebase/src/lib/core/SAGEBase.ts`
- Modify: `webstack/libs/shared/src/lib/types/server/serverconfig.ts`
- Modify: `webstack/apps/homebase/src/main.ts`
- Modify: `webstack/sage3-dev.hjson`

**Interfaces:**
- Consumes: `SBCredentialsDB` singleton from `./credentials/SBCredentialsDatabase` (Task 2).
- Produces: `config.secretsEncryptionKey: string` available anywhere `ServerConfiguration` is imported; `SBCredentialsDB` fully initialized (Redis-connected, index created) by the time `main.ts` starts accepting requests — Tasks 4 and 5 depend on `SBCredentialsDB` already being initialized when their routes are hit.

- [ ] **Step 1: Add `secretsEncryptionKey` to `ServerConfiguration`**

In `webstack/libs/shared/src/lib/types/server/serverconfig.ts`, find the `ServerConfiguration` interface (it has fields like `production`, `port`, `redis`, `namespace`). Add a new top-level field — this is a general security setting, not a login strategy, so it does not belong under `AuthConfiguration`:

```typescript
  // Key used to derive the AES-256 encryption key for the credentials store
  // (per-user secrets like API tokens) — kept separate from sessionSecret so
  // a compromise of one doesn't automatically expose the other.
  secretsEncryptionKey: string;

  // Namespace for signing uuid v5 keys
  namespace: string;
```

(Insert directly above the existing `namespace: string;` line, so it reads naturally as one of the top-level server settings.)

- [ ] **Step 2: Add the value to `sage3-dev.hjson`**

In `webstack/sage3-dev.hjson`, find the line `"namespace": "150e32f0-62b8-11ed-974d-1b79350be347"` near the end of the file. Add the new field just above it:

```hjson
  // Key used to derive the encryption key for the credentials store (personal
  // API tokens, SSH keys, etc). Change this to something unique per deployment.
  "secretsEncryptionKey": "CHANGE-ME-CREDENTIALS-KEY!!",

  // Namespace for signing uuid v5 keys
  "namespace": "150e32f0-62b8-11ed-974d-1b79350be347"
```

- [ ] **Step 3: Verify the hjson still parses**

Run:
```bash
cd webstack && node -e "
const hjson = require('hjson');
const fs = require('fs');
const obj = hjson.parse(fs.readFileSync('sage3-dev.hjson', 'utf8'));
console.log('VALID. secretsEncryptionKey present:', !!obj.secretsEncryptionKey);
"
```
Expected: `VALID. secretsEncryptionKey present: true`

- [ ] **Step 4: Wire `credentialsConfig` into `SAGEBaseConfig` and initialize `SBCredentialsDB`**

In `webstack/libs/sagebase/src/lib/core/SAGEBase.ts`, add the import and extend `SAGEBaseConfig`:

```typescript
import { SBCredentialsDB } from '../modules/credentials/SBCredentialsDatabase';
```

Find:
```typescript
export type SAGEBaseConfig = {
  redisUrl?: string;
  projectName: string;
  authConfig?: SBAuthConfig;
  logConfig?: SBLogConfig;
};
```
Replace with:
```typescript
export type SAGEBaseConfig = {
  redisUrl?: string;
  projectName: string;
  authConfig?: SBAuthConfig;
  logConfig?: SBLogConfig;
  // Optional so existing @sage3/sagebase consumers that don't need the
  // credentials store aren't forced to configure it.
  credentialsConfig?: { encryptionKey: string };
};
```

Find the `init()` method's body — after the existing `this._database.init(...)` call and before the `authConfig` block:
```typescript
    // Init the SAGEBase Database
    this._database = new SBDatabase();
    await this._database.init(this._client, this._redisPrefix);

    // Init the SAGEBase PubSub
```
Insert a new block right after the database init, so the full sequence reads:
```typescript
    // Init the SAGEBase Database
    this._database = new SBDatabase();
    await this._database.init(this._client, this._redisPrefix);

    // Init the Credentials store — independent of which auth strategy is
    // configured, so it's initialized unconditionally whenever a key is
    // provided (matching how _database/_pubsub are always initialized).
    if (config.credentialsConfig) {
      await SBCredentialsDB.init(this._client, this._redisPrefix, config.credentialsConfig.encryptionKey);
    } else {
      console.warn('SAGEBase> No credentialsConfig provided — the credentials store is disabled.');
    }

    // Init the SAGEBase PubSub
```

- [ ] **Step 5: Pass the config through from `main.ts`**

In `webstack/apps/homebase/src/main.ts`, find:
```typescript
  const sbConfig: SAGEBaseConfig = {
    projectName: 'SAGE3',
    redisUrl: config.redis.url || 'redis://localhost:6379',
    authConfig: {
      ...config.auth,
      production: config.production,
    },
    logConfig: sbLogConfig,
  };
```
Replace with:
```typescript
  const sbConfig: SAGEBaseConfig = {
    projectName: 'SAGE3',
    redisUrl: config.redis.url || 'redis://localhost:6379',
    authConfig: {
      ...config.auth,
      production: config.production,
    },
    credentialsConfig: {
      encryptionKey: config.secretsEncryptionKey,
    },
    logConfig: sbLogConfig,
  };
```

- [ ] **Step 6: Rebuild homebase and confirm it starts cleanly**

Run:
```bash
cd webstack && npx nx run homebase:build
```
Expected: `webpack compiled successfully`

- [ ] **Step 7: Commit**

```bash
cd webstack
git add libs/sagebase/src/lib/core/SAGEBase.ts libs/shared/src/lib/types/server/serverconfig.ts \
  apps/homebase/src/main.ts sage3-dev.hjson
git commit -m "feat(credentials): wire SBCredentialsDB into SAGEBase's core init flow"
```

---

### Task 4: REST API — `/api/credentials`

**Files:**
- Create: `webstack/apps/homebase/src/api/routers/custom/credentials.ts`
- Modify: `webstack/apps/homebase/src/api/routers/custom/index.ts`
- Modify: `webstack/apps/homebase/src/api/routers/httpRouter.ts`
- Test: `webstack/libs/backend/src/lib/generics/credentialsRoute.integration.spec.ts`

**Interfaces:**
- Consumes: `SBCredentialsDB`, `CredentialType`, `CredentialValue` (Task 2); `SBAuthSchema` from `@sage3/sagebase` (for `req.user` typing, same pattern as `apps/homebase/src/api/collections/users.ts:12`).
- Produces: `CredentialsRouter(): express.Router`, mounted at `/api/credentials` — this is a leaf task, nothing later in this plan imports from it directly (Task 5's `ctfd` integration handler talks to `SBCredentialsDB` directly, not through this REST router).

- [ ] **Step 1: Write the failing integration test**

This test lives in `libs/backend` (not `libs/sagebase`) to mirror where `permissions.integration.spec.ts` already tests real Express + supertest REST behavior for this codebase. Create `webstack/libs/backend/src/lib/generics/credentialsRoute.integration.spec.ts`:

```typescript
/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 *
 * Real Express + supertest integration test for the /api/credentials REST
 * routes, against a real Redis Stack instance (gated on REDIS_TEST_URL,
 * same convention as SBAuthDatabase.integration.spec.ts and
 * permissions.integration.spec.ts).
 */

import * as express from 'express';
import * as request from 'supertest';
import { createClient } from 'redis';
import { SBCredentialsDatabase } from '@sage3/sagebase';
import { CredentialsRouter } from './credentialsRouterTestHelper';

const REDIS_URL = process.env.REDIS_TEST_URL;
const describeIfRedis = REDIS_URL ? describe : describe.skip;

function buildApp(userId: string, db: SBCredentialsDatabase) {
  const app = express();
  // Deliberately no global express.json() here — the real apps/homebase
  // app only has express.urlencoded() globally (see
  // apps/homebase/src/web/http-server.ts:74), so this test only passes if
  // the router itself parses its own JSON body, exactly like production.
  app.use((req, _res, next) => {
    (req as express.Request & { user: { id: string } }).user = { id: userId };
    next();
  });
  app.use('/api/credentials', CredentialsRouter(db));
  return app;
}

describeIfRedis('CredentialsRouter — real Express + real Redis integration', () => {
  let db: SBCredentialsDatabase;
  let redisClient: ReturnType<typeof createClient>;

  beforeAll(async () => {
    redisClient = createClient({ url: REDIS_URL });
    await redisClient.connect();
    db = new SBCredentialsDatabase();
    await db.init(redisClient as any, `credentials-route-test-${Date.now()}`, 'route-test-key');
  });

  afterAll(async () => {
    await redisClient.quit();
  });

  it('POST creates a credential and never returns the value', async () => {
    const app = buildApp('user-a', db);
    const res = await request(app)
      .post('/api/credentials')
      .send({ name: 'ctfd-token', type: 'secretText', value: { type: 'secretText', secret: 'ctfd_abc' } });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'ctfd-token', type: 'secretText', ownerId: 'user-a' });
    expect(res.body.encryptedValue).toBeUndefined();
    expect(res.body.value).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('ctfd_abc');
  });

  it('GET lists only the calling user\'s own credentials', async () => {
    const appA = buildApp('user-b', db);
    const appC = buildApp('user-c', db);
    await request(appA).post('/api/credentials').send({ name: 'x', type: 'secretText', value: { type: 'secretText', secret: 's1' } });
    await request(appC).post('/api/credentials').send({ name: 'y', type: 'secretText', value: { type: 'secretText', secret: 's2' } });

    const res = await request(appA).get('/api/credentials');
    expect(res.status).toBe(200);
    expect(res.body.map((c: any) => c.name)).toEqual(['x']);
  });

  it('GET ?type= filters by credential type', async () => {
    const app = buildApp('user-d', db);
    await request(app).post('/api/credentials').send({ name: 'a', type: 'secretText', value: { type: 'secretText', secret: 's' } });
    await request(app)
      .post('/api/credentials')
      .send({ name: 'b', type: 'usernamePassword', value: { type: 'usernamePassword', username: 'u', password: 'p' } });

    const res = await request(app).get('/api/credentials?type=secretText');
    expect(res.body.map((c: any) => c.name)).toEqual(['a']);
  });

  it('PUT rotates the value for an owned credential', async () => {
    const app = buildApp('user-e', db);
    const createRes = await request(app)
      .post('/api/credentials')
      .send({ name: 'rotatable', type: 'secretText', value: { type: 'secretText', secret: 'v1' } });

    const putRes = await request(app)
      .put(`/api/credentials/${createRes.body.id}`)
      .send({ value: { type: 'secretText', secret: 'v2' } });
    expect(putRes.status).toBe(200);
    expect(putRes.body.id).toBe(createRes.body.id);
  });

  it('PUT returns 404 when the credential belongs to a different user', async () => {
    const owner = buildApp('user-f', db);
    const attacker = buildApp('user-g', db);
    const createRes = await request(owner)
      .post('/api/credentials')
      .send({ name: 'mine', type: 'secretText', value: { type: 'secretText', secret: 'v1' } });

    const res = await request(attacker)
      .put(`/api/credentials/${createRes.body.id}`)
      .send({ value: { type: 'secretText', secret: 'stolen' } });
    expect(res.status).toBe(404);
  });

  it('DELETE removes an owned credential', async () => {
    const app = buildApp('user-h', db);
    const createRes = await request(app)
      .post('/api/credentials')
      .send({ name: 'to-delete', type: 'secretText', value: { type: 'secretText', secret: 'v' } });

    const deleteRes = await request(app).delete(`/api/credentials/${createRes.body.id}`);
    expect(deleteRes.status).toBe(200);

    const listRes = await request(app).get('/api/credentials');
    expect(listRes.body).toHaveLength(0);
  });

  it('DELETE returns 404 when the credential belongs to a different user, and does not delete it', async () => {
    const owner = buildApp('user-i', db);
    const attacker = buildApp('user-j', db);
    const createRes = await request(owner)
      .post('/api/credentials')
      .send({ name: 'mine', type: 'secretText', value: { type: 'secretText', secret: 'v' } });

    const deleteRes = await request(attacker).delete(`/api/credentials/${createRes.body.id}`);
    expect(deleteRes.status).toBe(404);

    const listRes = await request(owner).get('/api/credentials');
    expect(listRes.body).toHaveLength(1);
  });
});
```

Create the test-only helper `webstack/libs/backend/src/lib/generics/credentialsRouterTestHelper.ts` — this re-exports the real router-building logic from Task's implementation file in a form this test can call with an injected `db` instance (the real router in `apps/homebase` uses the module-level `SBCredentialsDB` singleton directly, which isn't practical to re-point at a per-test Redis prefix from inside `libs/backend`):

```typescript
/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 *
 * Test-only helper: the real route logic (apps/homebase/src/api/routers/
 * custom/credentials.ts) is written against the module-level SBCredentialsDB
 * singleton, which the real server always uses. This helper builds an
 * identical router against an explicitly-injected SBCredentialsDatabase
 * instance, so this integration test can point it at a fresh, isolated
 * Redis prefix per test run without touching the singleton.
 */

import * as express from 'express';
import { SBCredentialsDatabase, SBAuthSchema, CredentialType } from '@sage3/sagebase';

export function CredentialsRouter(db: SBCredentialsDatabase): express.Router {
  const router = express.Router();
  router.use(express.json());

  router.post('/', async (req, res) => {
    const user = req.user as SBAuthSchema;
    const { name, type, value } = req.body;
    const result = await db.createOrUpdate(user.id, type, name, value);
    res.status(200).json(result);
  });

  router.get('/', async (req, res) => {
    const user = req.user as SBAuthSchema;
    const type = req.query.type as CredentialType | undefined;
    const result = await db.list(user.id, type);
    res.status(200).json(result);
  });

  router.put('/:id', async (req, res) => {
    const user = req.user as SBAuthSchema;
    const result = await db.updateValue(req.params.id, user.id, req.body.value);
    if (!result) {
      res.status(404).json({ error: 'Credential not found' });
      return;
    }
    res.status(200).json(result);
  });

  router.delete('/:id', async (req, res) => {
    const user = req.user as SBAuthSchema;
    const deleted = await db.delete(req.params.id, user.id);
    if (!deleted) {
      res.status(404).json({ error: 'Credential not found' });
      return;
    }
    res.status(200).json({ success: true });
  });

  return router;
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
docker run -d --name credentials-route-test-redis -p 16401:6379 redis/redis-stack-server:latest
sleep 3
cd webstack && REDIS_TEST_URL=redis://localhost:16401 npx nx test backend --testPathPattern=credentialsRoute --skip-nx-cache
```
Expected: FAIL — `SBCredentialsDatabase` is not yet exported from `@sage3/sagebase`'s public barrel (only used internally so far)

- [ ] **Step 3: Export `SBCredentialsDatabase`, `SBCredentialsDB`, and the crypto types from `@sage3/sagebase`**

In `webstack/libs/sagebase/src/lib/modules/index.ts`, add both lines (`SBCredentialsDatabase.ts` imports `CredentialType`/`CredentialValue` from `credentialCrypto.ts` for its own internal use but does not re-export them, so `credentialCrypto` needs its own barrel line for `CredentialType` to be usable from `@sage3/sagebase` in Task 4/5's route handlers):
```typescript
export * from './credentials/credentialCrypto';
export * from './credentials/SBCredentialsDatabase';
```
(alongside the existing `export * from './auth/SBAuthDatabase';` line)

- [ ] **Step 4: Re-run the test to verify it fails for the real, expected reason**

Run the same command as Step 2.
Expected: FAIL — `Cannot find module './credentialsRouterTestHelper'`

- [ ] **Step 5: Write the production router (`apps/homebase`)**

Create `webstack/apps/homebase/src/api/routers/custom/credentials.ts`:

```typescript
/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import * as express from 'express';
import { SBCredentialsDB, SBAuthSchema, CredentialType } from '@sage3/sagebase';

export function CredentialsRouter(): express.Router {
  const router = express.Router();
  // apps/homebase's global middleware only applies express.urlencoded(),
  // not express.json() (see apps/homebase/src/web/http-server.ts:74) — these
  // routes need a real JSON body, so parse it locally rather than changing
  // global behavior other routes might depend on.
  router.use(express.json());

  router.post('/', async (req, res) => {
    const user = req.user as SBAuthSchema;
    const { name, type, value } = req.body;
    const result = await SBCredentialsDB.createOrUpdate(user.id, type, name, value);
    res.status(200).json(result);
  });

  router.get('/', async (req, res) => {
    const user = req.user as SBAuthSchema;
    const type = req.query.type as CredentialType | undefined;
    const result = await SBCredentialsDB.list(user.id, type);
    res.status(200).json(result);
  });

  router.put('/:id', async (req, res) => {
    const user = req.user as SBAuthSchema;
    const result = await SBCredentialsDB.updateValue(req.params.id, user.id, req.body.value);
    if (!result) {
      res.status(404).json({ error: 'Credential not found' });
      return;
    }
    res.status(200).json(result);
  });

  router.delete('/:id', async (req, res) => {
    const user = req.user as SBAuthSchema;
    const deleted = await SBCredentialsDB.delete(req.params.id, user.id);
    if (!deleted) {
      res.status(404).json({ error: 'Credential not found' });
      return;
    }
    res.status(200).json({ success: true });
  });

  return router;
}
```

Add the export in `webstack/apps/homebase/src/api/routers/custom/index.ts`:
```typescript
export * from './credentials';
```

Mount it in `webstack/apps/homebase/src/api/routers/httpRouter.ts` — add the import to the existing custom-routes import line, and mount after the auth middleware alongside the other collections:
```typescript
import { ConfigRouter, InfoRouter, TimeRouter, NLPRouter, LogsRouter, KernelsRouter, PresenceThrottle, AgentRouter, CredentialsRouter } from './custom';
```
```typescript
  router.use('/links', LinkCollection.router());

  // Credentials store
  router.use('/credentials', CredentialsRouter());

  // Check to see if plugins module is enabled.
```

- [ ] **Step 6: Run test to verify it passes**

Run the same command as Step 2.
Expected: PASS, 7 tests

- [ ] **Step 7: Confirm homebase still builds**

Run: `cd webstack && npx nx run homebase:build`
Expected: `webpack compiled successfully`

- [ ] **Step 8: Clean up the test container and commit**

```bash
docker stop credentials-route-test-redis && docker rm credentials-route-test-redis
cd webstack
git add libs/sagebase/src/lib/modules/index.ts \
  libs/backend/src/lib/generics/credentialsRoute.integration.spec.ts \
  libs/backend/src/lib/generics/credentialsRouterTestHelper.ts \
  apps/homebase/src/api/routers/custom/credentials.ts \
  apps/homebase/src/api/routers/custom/index.ts \
  apps/homebase/src/api/routers/httpRouter.ts
git commit -m "feat(credentials): add /api/credentials REST routes (create/list/update/delete, owner-scoped)"
```

---

### Task 5: First-party integration — `POST /api/integrations/ctfd/register`

**Files:**
- Create: `webstack/apps/homebase/src/api/routers/custom/integrations/ctfd.ts`
- Modify: `webstack/apps/homebase/src/api/routers/custom/index.ts`
- Modify: `webstack/apps/homebase/src/api/routers/httpRouter.ts`
- Test: `webstack/libs/backend/src/lib/generics/ctfdIntegration.integration.spec.ts`

**Interfaces:**
- Consumes: `SBCredentialsDB`, `CredentialValue` (Task 2); `SBAuthSchema` (Task 4's pattern).
- Produces: `CtfdIntegrationRouter(): express.Router`, mounted at `/api/integrations/ctfd` — this is the last backend task; Task 6 (frontend, separate repo) calls this endpoint over HTTP.

- [ ] **Step 1: Write the failing integration test**

This test mocks the *external* CTFd server's HTTP response (not SAGE3's own backend, which is real) — same "mock only the true external boundary" principle as the rest of this session's integration tests. Create `webstack/libs/backend/src/lib/generics/ctfdIntegration.integration.spec.ts`:

```typescript
/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 *
 * Real Express + real Redis integration test for the ctfd first-party
 * integration handler. Mocks only the true external boundary — the
 * outbound fetch() to the (fake) CTFd server — everything else (Express,
 * Redis, encryption) is real, matching this session's established
 * "integration test" bar.
 */

import * as express from 'express';
import * as request from 'supertest';
import { createClient } from 'redis';
import { SBCredentialsDatabase } from '@sage3/sagebase';
import { CtfdIntegrationRouterTestHelper } from './ctfdIntegrationRouterTestHelper';

const REDIS_URL = process.env.REDIS_TEST_URL;
const describeIfRedis = REDIS_URL ? describe : describe.skip;

function buildApp(userId: string, db: SBCredentialsDatabase) {
  const app = express();
  // Deliberately no global express.json() here — the real apps/homebase
  // app only has express.urlencoded() globally (see
  // apps/homebase/src/web/http-server.ts:74), so this test only passes if
  // the router itself parses its own JSON body, exactly like production.
  app.use((req, _res, next) => {
    (req as express.Request & { user: { id: string } }).user = { id: userId };
    next();
  });
  app.use('/api/integrations/ctfd', CtfdIntegrationRouterTestHelper(db));
  return app;
}

describeIfRedis('ctfd integration handler — real Express + real Redis, mocked external CTFd', () => {
  let db: SBCredentialsDatabase;
  let redisClient: ReturnType<typeof createClient>;

  beforeAll(async () => {
    redisClient = createClient({ url: REDIS_URL });
    await redisClient.connect();
    db = new SBCredentialsDatabase();
    await db.init(redisClient as any, `ctfd-integration-test-${Date.now()}`, 'ctfd-test-key');
  });

  afterAll(async () => {
    await redisClient.quit();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('registers with a brand-new credential, and only persists it on success', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) } as Response);

    const app = buildApp('user-1', db);
    const res = await request(app).post('/api/integrations/ctfd/register').send({
      app_id: 'app-abc',
      ctfd_url: 'http://ctfd.test',
      newCredential: { name: 'my-ctfd-token', value: { type: 'secretText', secret: 'ctfd_realtoken' } },
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });

    const list = await db.list('user-1', 'secretText');
    expect(list.map((c) => c.name)).toEqual(['my-ctfd-token']);
  });

  it('does not persist a new credential when CTFd rejects the token', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) } as Response);

    const app = buildApp('user-2', db);
    const res = await request(app).post('/api/integrations/ctfd/register').send({
      app_id: 'app-abc',
      ctfd_url: 'http://ctfd.test',
      newCredential: { name: 'bad-token', value: { type: 'secretText', secret: 'ctfd_badtoken' } },
    });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_token');
    const list = await db.list('user-2', 'secretText');
    expect(list).toHaveLength(0);
  });

  it('registers using an existing credentialId instead of a new one', async () => {
    const created = await db.createOrUpdate('user-3', 'secretText', 'existing-token', {
      type: 'secretText',
      secret: 'ctfd_existing',
    });
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) } as Response);

    const app = buildApp('user-3', db);
    const res = await request(app).post('/api/integrations/ctfd/register').send({
      app_id: 'app-abc',
      ctfd_url: 'http://ctfd.test',
      credentialId: created.id,
    });

    expect(res.status).toBe(200);
  });

  it('returns 404 when credentialId belongs to a different user', async () => {
    const created = await db.createOrUpdate('user-4', 'secretText', 'not-yours', {
      type: 'secretText',
      secret: 'ctfd_x',
    });

    const app = buildApp('user-5', db);
    const res = await request(app).post('/api/integrations/ctfd/register').send({
      app_id: 'app-abc',
      ctfd_url: 'http://ctfd.test',
      credentialId: created.id,
    });

    expect(res.status).toBe(404);
  });

  it('returns ctfd_unreachable when the external fetch itself throws (network error)', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('network down'));

    const app = buildApp('user-6', db);
    const res = await request(app).post('/api/integrations/ctfd/register').send({
      app_id: 'app-abc',
      ctfd_url: 'http://unreachable.test',
      newCredential: { name: 'x', value: { type: 'secretText', secret: 'y' } },
    });

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('ctfd_unreachable');
  });

  it('sends app_id and the decrypted token in the request to CTFd, never sends the credentialId', async () => {
    const created = await db.createOrUpdate('user-7', 'secretText', 'token-to-check', {
      type: 'secretText',
      secret: 'ctfd_checkme',
    });
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) } as Response);

    const app = buildApp('user-7', db);
    await request(app).post('/api/integrations/ctfd/register').send({
      app_id: 'app-xyz',
      ctfd_url: 'http://ctfd.test',
      credentialId: created.id,
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://ctfd.test/api/sage/register',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ app_id: 'app-xyz', token: 'ctfd_checkme' }),
      })
    );
  });
});
```

Create the test helper `webstack/libs/backend/src/lib/generics/ctfdIntegrationRouterTestHelper.ts` — same injection pattern as Task 4's helper:

```typescript
/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 *
 * Test-only helper — see credentialsRouterTestHelper.ts's header comment
 * for why this exists (injectable db instance vs. the real module-level
 * singleton the production router in apps/homebase always uses).
 */

import * as express from 'express';
import { SBCredentialsDatabase, SBAuthSchema } from '@sage3/sagebase';

export function CtfdIntegrationRouterTestHelper(db: SBCredentialsDatabase): express.Router {
  const router = express.Router();
  router.use(express.json());

  router.post('/register', async (req, res) => {
    const user = req.user as SBAuthSchema;
    const { app_id, ctfd_url, credentialId, newCredential } = req.body;

    let secret: string;
    if (credentialId) {
      const value = await db.getDecryptedValue(credentialId, user.id);
      if (!value || value.type !== 'secretText') {
        res.status(404).json({ error: 'Credential not found' });
        return;
      }
      secret = value.secret;
    } else {
      secret = newCredential.value.secret;
    }

    let ctfdResponse: Response;
    try {
      ctfdResponse = await fetch(`${ctfd_url}/api/sage/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id, token: secret }),
      });
    } catch {
      res.status(502).json({ error: 'ctfd_unreachable' });
      return;
    }

    if (!ctfdResponse.ok) {
      res.status(ctfdResponse.status === 401 ? 401 : 502).json({ error: 'invalid_token' });
      return;
    }

    if (!credentialId && newCredential) {
      await db.createOrUpdate(user.id, 'secretText', newCredential.name, newCredential.value);
    }

    res.status(200).json({ success: true });
  });

  return router;
}
```

- [ ] **Step 2: Run test to verify it passes**

Step 1 above includes both the test file and its helper (`ctfdIntegrationRouterTestHelper.ts`) together, so this should pass on the first run — there's no separate "watch it fail" step here since, unlike Tasks 1-4, the helper isn't a later step.

Run:
```bash
docker run -d --name ctfd-integration-test-redis -p 16402:6379 redis/redis-stack-server:latest
sleep 3
cd webstack && REDIS_TEST_URL=redis://localhost:16402 npx nx test backend --testPathPattern=ctfdIntegration --skip-nx-cache
```
Expected: PASS, 6 tests

- [ ] **Step 3: Write the production router (`apps/homebase`)**

Create `webstack/apps/homebase/src/api/routers/custom/integrations/ctfd.ts`:

```typescript
/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 *
 * First-party integration handler: the only code path anywhere that calls
 * SBCredentialsDB.getDecryptedValue() to actually use a stored credential.
 * The request always goes to ${ctfd_url}/api/sage/register — a value the
 * caller already knows (it's the same CTFd instance they're registering
 * with), not an arbitrary plugin-declared endpoint.
 */

import * as express from 'express';
import { SBCredentialsDB, SBAuthSchema } from '@sage3/sagebase';

export function CtfdIntegrationRouter(): express.Router {
  const router = express.Router();
  // Same reason as CredentialsRouter: apps/homebase has no global
  // express.json() (only express.urlencoded()), so parse it locally.
  router.use(express.json());

  router.post('/register', async (req, res) => {
    const user = req.user as SBAuthSchema;
    const { app_id, ctfd_url, credentialId, newCredential } = req.body;

    let secret: string;
    if (credentialId) {
      const value = await SBCredentialsDB.getDecryptedValue(credentialId, user.id);
      if (!value || value.type !== 'secretText') {
        res.status(404).json({ error: 'Credential not found' });
        return;
      }
      secret = value.secret;
    } else {
      secret = newCredential.value.secret;
    }

    let ctfdResponse: Response;
    try {
      ctfdResponse = await fetch(`${ctfd_url}/api/sage/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id, token: secret }),
      });
    } catch {
      res.status(502).json({ error: 'ctfd_unreachable' });
      return;
    }

    if (!ctfdResponse.ok) {
      res.status(ctfdResponse.status === 401 ? 401 : 502).json({ error: 'invalid_token' });
      return;
    }

    if (!credentialId && newCredential) {
      await SBCredentialsDB.createOrUpdate(user.id, 'secretText', newCredential.name, newCredential.value);
    }

    res.status(200).json({ success: true });
  });

  return router;
}
```

Add the export in `webstack/apps/homebase/src/api/routers/custom/index.ts`:
```typescript
export * from './integrations/ctfd';
```

Mount it in `webstack/apps/homebase/src/api/routers/httpRouter.ts`, next to the credentials mount added in Task 4:
```typescript
  // Credentials store
  router.use('/credentials', CredentialsRouter());

  // First-party integration handlers
  router.use('/integrations/ctfd', CtfdIntegrationRouter());

  // Check to see if plugins module is enabled.
```
(and add `CtfdIntegrationRouter` to the same custom-routes import line updated in Task 4)

- [ ] **Step 4: Confirm homebase still builds**

Run: `cd webstack && npx nx run homebase:build`
Expected: `webpack compiled successfully`

- [ ] **Step 5: Clean up the test container and commit**

```bash
docker stop ctfd-integration-test-redis && docker rm ctfd-integration-test-redis
cd webstack
git add libs/backend/src/lib/generics/ctfdIntegration.integration.spec.ts \
  libs/backend/src/lib/generics/ctfdIntegrationRouterTestHelper.ts \
  apps/homebase/src/api/routers/custom/integrations/ctfd.ts \
  apps/homebase/src/api/routers/custom/index.ts \
  apps/homebase/src/api/routers/httpRouter.ts
git commit -m "feat(credentials): add first-party ctfd integration handler (POST /api/integrations/ctfd/register)"
```

---

### Task 6: Wire the CTFd-SAGE plugin's registration flow to the new backend

**Repo:** this task is entirely in **`/home/eriam/CTFd-SAGE`** — a separate git repository from `next`, a standalone Vite app with no dependency on `@sage3/frontend`. Do not look for these files under `/home/eriam/next`.

**Files:**
- Create: `sage_app/src/hooks/useCredentials.ts`
- Modify: `sage_app/src/hooks/useRegistration.ts`
- Test: `sage_app/src/hooks/useCredentials.test.ts`
- Test: `sage_app/src/hooks/useRegistration.test.ts` (update existing)

**Interfaces:**
- Consumes: nothing from Tasks 1-5 directly (calls the new REST API over `fetch()`, same as every other hook in this plugin) — assumes `POST /api/credentials`, `GET /api/credentials?type=`, and `POST /api/integrations/ctfd/register` behave exactly as specified in Tasks 4 and 5.
- Produces: `useCredentials(type: 'secretText'): {credentials, loading, refetch}`, and an updated `useRegistration` whose `register()` now calls the new integration endpoint instead of POSTing the token directly to the external CTFd server. This is the last task in this plan.

- [ ] **Step 1: Write the failing test for the new hook**

Create `sage_app/src/hooks/useCredentials.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useCredentials } from "./useCredentials";

describe("useCredentials", () => {
  beforeEach(() => { vi.stubGlobal("fetch", vi.fn()); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("fetches credentials of the given type on mount", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: "c1", name: "my-token", type: "secretText", ownerId: "u1", createdAt: 1, updatedAt: 1 }],
    } as Response);

    const { result } = renderHook(() => useCredentials("secretText"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.credentials).toEqual([
      { id: "c1", name: "my-token", type: "secretText", ownerId: "u1", createdAt: 1, updatedAt: 1 },
    ]);
    expect(fetch).toHaveBeenCalledWith("/api/credentials?type=secretText", expect.anything());
  });

  it("starts with an empty list and loading=true before the fetch resolves", () => {
    vi.mocked(fetch).mockReturnValue(new Promise(() => {})); // never resolves
    const { result } = renderHook(() => useCredentials("secretText"));
    expect(result.current.loading).toBe(true);
    expect(result.current.credentials).toEqual([]);
  });

  it("refetch() re-queries the list", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => [] } as Response);
    const { result } = renderHook(() => useCredentials("secretText"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    result.current.refetch();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/eriam/CTFd-SAGE/sage_app && npx vitest run src/hooks/useCredentials.test.ts`
Expected: FAIL — `Cannot find module './useCredentials'`

- [ ] **Step 3: Write the implementation**

Create `sage_app/src/hooks/useCredentials.ts`:

```typescript
import { useState, useEffect, useCallback } from "react";

export interface CredentialMetadata {
  id: string;
  ownerId: string;
  name: string;
  type: "secretText" | "usernamePassword" | "sshPrivateKey";
  createdAt: number;
  updatedAt: number;
}

interface UseCredentialsResult {
  credentials: CredentialMetadata[];
  loading: boolean;
  refetch: () => void;
}

/**
 * Lists the current user's own credentials of the given type, via SAGE3's
 * own /api/credentials — same-origin as this plugin's iframe, so the
 * existing session cookie authenticates it automatically. Never receives
 * (and SAGE3 never sends) a credential's plaintext value.
 */
export function useCredentials(type: CredentialMetadata["type"]): UseCredentialsResult {
  const [credentials, setCredentials] = useState<CredentialMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [refetchNonce, setRefetchNonce] = useState(0);

  const refetch = useCallback(() => setRefetchNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const resp = await fetch(`/api/credentials?type=${type}`, { headers: { "Content-Type": "application/json" } });
        if (!resp.ok) return;
        const json = (await resp.json()) as CredentialMetadata[];
        if (!cancelled) setCredentials(json);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [type, refetchNonce]);

  return { credentials, loading, refetch };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/eriam/CTFd-SAGE/sage_app && npx vitest run src/hooks/useCredentials.test.ts`
Expected: PASS, 3 tests

- [ ] **Step 5: Update `useRegistration` to use the new integration endpoint**

Read the current `sage_app/src/hooks/useRegistration.ts` and its test file `sage_app/src/hooks/useRegistration.test.ts` before editing — this replaces the direct-to-CTFd POST with a call to SAGE3's own backend.

Replace the body of `register()` in `sage_app/src/hooks/useRegistration.ts` — find:
```typescript
  const register = useCallback(async ({ appId, ctfdUrl, token }: RegisterParams): Promise<boolean> => {
    setRegistering(true);
    setError(null);
    try {
      const baseUrl = ctfdUrl.replace(/\/+$/, "");
      const resp = await fetch(`${baseUrl}/api/sage/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app_id: appId, ctfd_url: ctfdUrl, token }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setError(data.error || "Registration failed");
        return false;
      }
      return true;
    } catch {
      setError("Network error contacting CTFd");
      return false;
    } finally {
      setRegistering(false);
    }
  }, []);
```
Replace with:
```typescript
  const register = useCallback(async ({ appId, ctfdUrl, token }: RegisterParams): Promise<boolean> => {
    setRegistering(true);
    setError(null);
    try {
      // Goes to SAGE3's own backend, not directly to CTFd — the token never
      // leaves this request; SAGE3 makes the actual CTFd call server-side
      // and, on success, stores the token encrypted, scoped to this user.
      const resp = await fetch("/api/integrations/ctfd/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          app_id: appId,
          ctfd_url: ctfdUrl,
          newCredential: { name: "CTFd token", value: { type: "secretText", secret: token } },
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setError(data.error === "invalid_token" ? "Invalid CTFd token" : "Registration failed");
        return false;
      }
      return true;
    } catch {
      setError("Network error contacting SAGE3");
      return false;
    } finally {
      setRegistering(false);
    }
  }, []);
```

- [ ] **Step 6: Update the existing `useRegistration` test to match**

Read `sage_app/src/hooks/useRegistration.test.ts` in full first. Update every `fetch` assertion that currently expects a call to `${baseUrl}/api/sage/register` with the token in the body — change the expected URL to `/api/integrations/ctfd/register` and the expected body shape to `{app_id, ctfd_url, newCredential: {name: "CTFd token", value: {type: "secretText", secret: token}}}`. Update any assertion checking the error-message text for a rejected token to expect `"Invalid CTFd token"` (matching the new `data.error === "invalid_token"` branch) instead of whatever the old direct-to-CTFd error text was.

- [ ] **Step 7: Run the full test suite to verify everything passes**

Run: `cd /home/eriam/CTFd-SAGE/sage_app && npx vitest run`
Expected: all test files pass

- [ ] **Step 8: Type-check and build**

Run:
```bash
cd /home/eriam/CTFd-SAGE/sage_app
npx tsc --noEmit
npx vite build
```
Expected: no type errors, `✓ built in ...`

- [ ] **Step 9: Commit**

```bash
cd /home/eriam/CTFd-SAGE
git add sage_app/src/hooks/useCredentials.ts sage_app/src/hooks/useCredentials.test.ts \
  sage_app/src/hooks/useRegistration.ts sage_app/src/hooks/useRegistration.test.ts
git commit -m "feat: register CTFd tokens through SAGE3's credentials store instead of posting directly to CTFd"
```

---

## Self-Review

**Spec coverage:**
- `SBCredentialsDatabase` (per-user, typed, encrypted) → Task 2. ✓
- AES-256-GCM crypto → Task 1. ✓
- `secretsEncryptionKey` config, separate from `sessionSecret` → Task 3. ✓
- `/api/credentials` REST API, no read-back endpoint, values never in list/create/update responses → Task 4. ✓
- First-party `ctfd` integration handler, only code path that decrypts → Task 5. ✓
- `(ownerId, type, name)` uniqueness, same name reusable across types → Task 2, tested explicitly. ✓
- Frontend consumption wired into the real CTFd plugin → Task 6. ✓
- Non-goal: no management UI page → not built anywhere in this plan. ✓
- Non-goal: no shared/team credentials → every method takes/checks `ownerId`, no shared scope exists. ✓
- Non-goal: no generic proxy capability → only Task 5's `ctfd` handler ever calls `getDecryptedValue`. ✓
- Non-goal: toolbar-rendering deferred → Task 6 renders in-canvas via the existing `SetupView`-equivalent flow, not the toolbar. ✓

**Type consistency check:** `CredentialType`/`CredentialValue` (Task 1) → `SBCredentialSchema`/`SBCredentialMetadata` (Task 2) → REST body shapes (Task 4/5) → frontend `CredentialMetadata` (Task 6) all agree on field names (`id`, `ownerId`, `name`, `type`, `createdAt`, `updatedAt`) and the three type-string literals (`secretText`/`usernamePassword`/`sshPrivateKey`) throughout.

**Known gap, deliberately left for a human decision rather than guessed at:** Task 5's handler only handles the `secretText` credential type (CTFd only ever needs a bare token) — `usernamePassword`/`sshPrivateKey` types are fully implemented in Tasks 1-4 (storage, crypto, REST CRUD) but have no first-party integration consuming them yet, since none exists in this codebase today. That's expected and fine per the spec's own framing (this is the reference integration, not the only one that will ever exist) — flagging it here so it's not mistaken for an oversight.
