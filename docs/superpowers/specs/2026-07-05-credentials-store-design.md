# SAGE3 Credentials Store — Design Spec

## Goal

Give SAGE3 a general-purpose, per-user secrets store — inspired by Jenkins' credential store — so that a plugin or app needing a personal API credential (an API token, a username/password pair, an SSH key) never has to put that value into SAGE3's shared, broadcast app `state`, and never has to hand it to a third-party service directly from the browser.

This originated from a concrete need: the CTFd-SAGE integration plugin (a `PluginApp` running SAGE3's new declarative toolbar protocol) needs a personal CTFd API token to register a team. Today it POSTs that token directly from the browser to the external CTFd server. That's acceptable as a one-off, but it doesn't generalize — any future plugin needing a personal credential would reinvent the same pattern, and there's no way to view, rotate, or delete a previously-entered secret without re-typing it.

## Non-goals (explicitly out of scope for this spec)

- **A credentials management UI page.** Credentials are created inline, wherever a consuming feature needs one (a picker showing existing named credentials of the right type, plus "+ New"). A dedicated `/credentials` settings page is future work once real usage patterns emerge.
- **Shared/team-scoped credentials.** Every credential belongs to exactly the user who created it. No Jenkins-style folder/global scoping in this pass.
- **A generic "make a request with this credential" capability.** There is no way for a plugin to ask the backend to proxy an arbitrary request using a stored credential. Only a fixed set of first-party integration handlers, written and reviewed as part of SAGE3 itself, ever decrypt and use a credential's value.
- **Rendering the credential picker inside SAGE3's native toolbar bar.** That depends on a separate, not-yet-built extension to the PluginApp toolbar protocol (form/input controls, beyond today's fixed-patch buttons). This spec's reference implementation (the CTFd `ctfd` integration) renders its picker in-canvas, inside the plugin's own iframe, exactly like today's `SetupView`. The toolbar-rendering question is intentionally deferred to its own follow-on spec.

## Architecture

A new `SBCredentialsDatabase` (in `libs/sagebase`, alongside the existing `SBAuthDatabase`) stores per-user, named, typed credentials. Each credential's value is encrypted at rest with AES-256-GCM, using a key derived from a new, dedicated server config value (`secretsEncryptionKey`) — kept separate from `sessionSecret` so a compromise of one doesn't automatically expose the other.

A small REST API (scoped to `req.user.id`, the calling user's own session) lets a user create, list, update (rotate), and delete their own credentials. Critically:

- **List and create/update responses never include the plaintext value** — only `{id, name, type, createdAt, updatedAt}`.
- **There is no "read the value back" endpoint at all.** Once saved, a credential's plaintext is only ever decrypted server-side, inside a first-party integration handler.

The only way a credential's plaintext is ever used is through a small, fixed set of **first-party integration handlers** — server-side code shipped with SAGE3 itself (not plugin-supplied), each scoped to one external integration (e.g. `ctfd`). A handler takes a `credentialId` (or a brand-new `{name, value}` to save-and-use in one step), looks it up, decrypts it internally, makes whatever server-side call it needs to make, and returns only a safe, non-secret result to the client. No generic "proxy any URL" capability exists anywhere in this design — extending to a new external service means writing new first-party handler code, reviewed like any other SAGE3 feature.

This deliberately trades flexibility for safety: a compromised or careless plugin can never turn a stored credential into an SSRF probe of SAGE3's own network, because it never gets to choose what request is made with it.

## Data model

`SBCredentialSchema` (in `libs/sagebase/src/lib/modules/credentials/SBCredentialsDatabase.ts`):

```typescript
export type CredentialType = 'secretText' | 'usernamePassword' | 'sshPrivateKey';

// The plaintext shape saved for each type — never returned to the client
// after creation, only ever passed to encryptCredentialValue()/decrypted
// internally by a first-party integration handler.
export type CredentialValue =
  | { type: 'secretText'; secret: string }
  | { type: 'usernamePassword'; username: string; password: string }
  | { type: 'sshPrivateKey'; username: string; privateKey: string; passphrase?: string };

export type SBCredentialSchema = {
  id: string; // v4 uuid, the credential's own id (not tied to the encrypted blob)
  ownerId: string; // req.user.id of the creating user — every query is scoped by this
  name: string; // user-chosen label, unique per (ownerId, type)
  type: CredentialType;
  encryptedValue: string; // AES-256-GCM ciphertext (iv + authTag + ciphertext, base64)
  createdAt: number;
  updatedAt: number;
};

// What list/create/update return to the client — note the absence of encryptedValue.
export type SBCredentialMetadata = Omit<SBCredentialSchema, 'encryptedValue'>;
```

Stored the same way `SBAuthDatabase` stores auth records: direct Redis JSON documents (`RedisJSON` module) under a `${prefix}:CREDENTIALS:${id}` key, with a `RediSearch` index on `ownerId` (and `type`, for filtering the picker to "just the CTFd-token-type credentials") so listing a user's own credentials doesn't require a full key scan. This mirrors the existing, already-tested pattern in `SBAuthDatabase.ts` rather than the more generic `SBDatabase.collection<Type>()` abstraction used for boards/rooms/apps, since credential lookups need the same "by owner, by type" query shape `SBAuthDatabase` already solves for `deleteAuthByEmail`.

**Uniqueness:** `(ownerId, type, name)` must be unique — creating a credential whose name matches an existing one *of the same type* for that user is an update, not a new record (matches Jenkins' "update credential" UX and the earlier decision that rotation should overwrite in place, not require delete-then-recreate). A user can reuse the same name across different types (e.g. an SSH key and a username/password both called "GitHub") since the picker is always scoped to one type at a time anyway.

## Encryption

New file `libs/sagebase/src/lib/modules/credentials/credentialCrypto.ts`, mirroring the shape of the CTFd Python plugin's own `crypto.py` (which already solves the identical problem: encrypt a personal API token at rest, scoped to one owner) but in Node's built-in `crypto` module:

```typescript
export function encryptCredentialValue(key: Buffer, value: CredentialValue): string;
export function decryptCredentialValue(key: Buffer, encrypted: string): CredentialValue;
```

AES-256-GCM: a random 12-byte IV per encryption, authenticated (GCM's auth tag catches tampering/corruption — a flipped bit fails loudly rather than silently decrypting to garbage), IV + auth tag + ciphertext concatenated and base64-encoded into the single `encryptedValue` string stored in Redis. The encryption key itself is derived from the new `secretsEncryptionKey` config value via `crypto.scryptSync` (a KDF, so the raw config string never needs to already be exactly 32 bytes).

## REST API

New router, `apps/homebase/src/api/routers/custom/credentials.ts`, mounted at `/api/credentials`, every route behind the existing auth middleware (so `req.user` is always populated) and every query scoped to `req.user.id`:

| Method | Path | Body | Returns |
|---|---|---|---|
| `POST` | `/api/credentials` | `{name, type, value}` (value shape depends on type) | `SBCredentialMetadata` (no value) |
| `GET` | `/api/credentials?type=secretText` | — | `SBCredentialMetadata[]`, this user's own, optionally filtered by type |
| `PUT` | `/api/credentials/:id` | `{value}` | `SBCredentialMetadata` — 404 if `:id` isn't owned by `req.user.id` |
| `DELETE` | `/api/credentials/:id` | — | `{success: true}` — 404 if not owned by `req.user.id` |

`PUT`/`DELETE` both look up the credential first and compare `ownerId` against `req.user.id` before touching anything — a user can never even discover whether a given `id` exists if it isn't theirs (404, not 403, to avoid confirming existence). `PUT` only replaces `encryptedValue` (re-encrypting the new value) — renaming a credential isn't supported in this pass; rename is a delete-and-recreate today, same as the "no management UI yet" decision already puts renaming out of reach anyway.

## First-party integration: `ctfd`

New router, `apps/homebase/src/api/routers/custom/integrations/ctfd.ts`, mounted at `/api/integrations/ctfd`:

| Method | Path | Body |
|---|---|---|
| `POST` | `/api/integrations/ctfd/register` | `{app_id, ctfd_url, credentialId}` **or** `{app_id, ctfd_url, newCredential: {name, value: {type: 'secretText', secret}}}` |

Handler logic:
1. Resolve the credential: either look up `credentialId` (404 if not owned by `req.user.id`) or take the freshly-supplied value directly (not yet saved).
2. Decrypt it (only this handler ever calls `decryptCredentialValue`).
3. Make the actual `POST {ctfd_url}/api/sage/register` call server-side (SAGE3's own backend, not the browser) with `{app_id, ctfd_url, token: secret}`.
4. On success: if this was a `newCredential`, save it now (so a bad token never gets persisted); return `{success: true}`.
5. On failure: return a specific, non-secret error — `{error: 'invalid_token'}` vs `{error: 'ctfd_unreachable'}` — the frontend already distinguishes these today via `useRegistration`'s error state.

## Data flow (CTFd, end to end)

1. User is looking at the CTFd plugin's `SetupView`-equivalent registration form (in-canvas, inside the iframe — see Non-goals above).
2. A `useCredentials('secretText')` hook (new, in `libs/frontend`) has already fetched the user's existing `secretText`-type credentials via `GET /api/credentials?type=secretText`, so the form can offer "use my existing CTFd token" as well as "enter a new one."
3. Submitting calls `POST /api/integrations/ctfd/register` with either the picked `credentialId` or a fresh `newCredential`.
4. On success, the plugin's own `updateState({registered: true})` flow proceeds exactly as it does today — nothing about the plugin's own state model changes, only where the token itself lives.
5. **Rotating** an expired token: `PUT /api/credentials/:id` with a new value, then re-trigger the same registration action (step 3) referencing the same `credentialId`.

## Error handling

- `SBCredentialsDatabase`: distinguishes "not found" from "found but not yours" only at the HTTP layer (both surface as 404, per the REST API table above) — the database layer itself can tell them apart (useful for logging/audit, not for the client response).
- `credentialCrypto.decryptCredentialValue`: a GCM auth-tag failure (corrupted data, or `secretsEncryptionKey` rotated without re-encrypting existing credentials) throws a distinct `CredentialDecryptionError`; the `ctfd` handler catches this and returns a generic "credential unavailable, please re-enter" rather than a raw stack trace or a misleading "invalid token" (the token itself might be fine — the *stored, encrypted copy* is what's unreadable).
- Deleting a credential that's actively "in use" needs no cascading cleanup: the next time some integration tries to use it, it 404s exactly like a revoked API key would upstream — no special-cased "in use" tracking required.

## Testing

Mirroring the depth already established this session for `SBAuthDatabase`/`LDAPAdapter` (unit + real-dependency integration tests, not just mocks):

- `SBCredentialsDatabase.spec.ts` (unit, fake Redis client) + `.integration.spec.ts` (real Redis Stack): CRUD, `(ownerId, type, name)` uniqueness/update-in-place, same name reusable across different types, list scoped to owner, list filtered by type, cross-user isolation (user B can never list/update/delete user A's credential).
- `credentialCrypto.spec.ts`: encrypt/decrypt round-trip for all three `CredentialValue` shapes, wrong-key failure, tamper detection (flip a byte in the ciphertext, confirm decryption throws rather than silently returning garbage).
- `credentials.spec.ts` (REST route, real Express + supertest): auth-scoping (404 on another user's `id`), value never present in any list/create/update response body.
- `ctfd.spec.ts` (integration handler): successful registration end-to-end (mocked external HTTP to the CTFd URL), invalid-token rejection, credential-not-found handling, "new credential, bad token" doesn't get persisted.
- Frontend: `useCredentials` hook tests (mirroring `useDashboardData`'s existing test conventions), credential-picker component tests.
