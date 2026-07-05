# SAGE3 SSH Terminal App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give SAGE3 a native app that opens an interactive terminal to a remote host over SSH, attached to a persistent `tmux` session, shared collaboratively by everyone viewing the board — the first real consumer of the credentials store's `sshPrivateKey` credential type.

**Architecture:** Homebase holds one long-lived SSH connection per app instance (via the `ssh2` npm library, with `tmux new -A -s sage3-<appId>` as the remote command — tmux itself runs on the far end, so no local PTY library is needed). A first-party integration handler (`POST /api/integrations/ssh/connect`, mirroring the existing `ctfd` handler) establishes the connection; a dedicated WebSocket route (`/api/ssh/terminal`, alongside the existing `apiWebSocketServer`/`logsServer` pattern) relays output to every viewer and accepts input only from the current controller. The frontend is a native SAGE3 app rendering `@xterm/xterm`.

**Tech Stack:** TypeScript, `ssh2` (Node SSH client, PTY allocation is a protocol-level SSH feature it handles natively — no `node-pty` needed), `@xterm/xterm` + `@xterm/addon-fit` (browser terminal emulator), Express, `ws` (already used throughout homebase), Jest + ts-jest (unit tests with a mocked `ssh2.Client`, real Express + supertest for the REST handler), React Testing Library + Vitest-equivalent Jest setup already configured for `libs/applications`.

## Global Constraints

- Spec doc: `docs/superpowers/specs/2026-07-05-ssh-terminal-app-design.md` — every task's requirements implicitly include everything in that spec; read it before starting Task 1.
- **No local PTY library.** `tmux` runs entirely on the remote host; the SSH connection's `exec(cmd, {pty: true}, cb)` option is what allocates a pseudo-terminal, over the wire, as part of the SSH protocol itself.
- **One shared connection per app instance, not one per viewer.** The app's stored `ownerId` (not `req.user.id` of whichever browser triggers a (re)connect) is always the identity used to look up and decrypt the credential. This is a deliberate, narrow exception to how every other credentials-store consumer works — call this out explicitly in code comments wherever the connect/reconnect logic lives, so a future reader doesn't "fix" it to use `req.user.id`.
- **Only one code path anywhere decrypts the SSH credential**: the connection-registry's `connect()` function, called either from the REST handler (initial setup) or internally (automatic reconnect after a drop). No other code may call `SBCredentialsDB.getDecryptedValue()` for an `sshPrivateKey` credential.
- **A `newCredential` is only persisted after the real SSH handshake + `tmux new` command both succeed** — a bad key or unreachable host never gets saved. Matches the `ctfd` handler's identical rule.
- **Keystroke input is enforced server-side, not just hidden in the UI.** The WebSocket relay must silently drop `input` messages from any connection that isn't the current controller — never assume the frontend won't send one.
- **Specific, non-secret error codes** for every failure path: `auth_failed`, `unreachable`, `tmux_failed`, `credential_unavailable` — never a raw stack trace, matching the `ctfd` handler's error-handling convention (itself hardened after a real Critical finding in an earlier feature on this same credentials-store foundation).
- Match the established testing depth: unit tests with a mocked `ssh2.Client` (no real network calls in any automated test), and real Express + supertest integration tests for the REST handler (mirroring `ctfdIntegration.integration.spec.ts`'s structure) — not mocks-only for the parts that can be tested against a real Express app.
- This is a fresh git worktree (`.worktrees/ssh-terminal`, branch `feat/ssh-terminal-app`) with its own `node_modules` — the first task's first step must run `npm install --legacy-peer-deps` (this project's `package.json` has a real peer-dependency conflict — `vega@^6.2.0` vs `vega-embed`'s `peer vega@^5.21.0` — that `yarn` tolerates silently but npm's stricter resolver rejects by default; `--legacy-peer-deps` is the workaround, not a sign of a new problem this plan introduces) before any `npx nx` command will work.

---

### Task 1: SSH connection registry — backend connection logic, no HTTP/WS yet

**Files:**
- Create: `webstack/apps/homebase/src/ssh/sshConnectionRegistry.ts`
- Test: `webstack/apps/homebase/src/ssh/sshConnectionRegistry.spec.ts`
- Modify: `webstack/package.json` (add `ssh2` + `@types/ssh2` dependencies)

**Interfaces:**
- Consumes: `SBCredentialsDB`, `CredentialDecryptionError` from `@sage3/sagebase` (already built — `getDecryptedValue(id: string, ownerId: string): Promise<CredentialValue | undefined>`, throws `CredentialDecryptionError` on a corrupted stored value).
- Produces: `SSHConnectionRegistry` class and its singleton export `export const sshConnectionRegistry = new SSHConnectionRegistry();`, with methods `connect(appId: string, params: ConnectParams): Promise<ConnectResult>`, `getConnection(appId: string): SSHConnection | undefined`, `disconnect(appId: string): void`, `write(appId: string, data: string): boolean`, `resize(appId: string, cols: number, rows: number): boolean`, `onOutput(appId: string, listener: (data: string) => void): () => void`, `onStatus(appId: string, listener: (status: ConnectionStatus) => void): () => void` — Tasks 2 and 3 both import `sshConnectionRegistry` directly.

- [ ] **Step 1: Install the new dependencies**

Run:
```bash
cd /home/eriam/next/.worktrees/ssh-terminal/webstack
npm install --legacy-peer-deps ssh2@^1.15.0
npm install --legacy-peer-deps --save-dev @types/ssh2@^1.15.0
```

In `webstack/package.json`, confirm `"ssh2": "^1.15.0"` was added under `"dependencies"` and `"@types/ssh2": "^1.15.0"` under `"devDependencies"` (alongside the existing `@types/ldapjs` entry, same alphabetical-ish grouping).

- [ ] **Step 2: Write the failing tests**

Create `webstack/apps/homebase/src/ssh/sshConnectionRegistry.spec.ts`:

```typescript
/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { EventEmitter } from 'events';
import { SBCredentialsDB, CredentialDecryptionError } from '@sage3/sagebase';
import { SSHConnectionRegistry } from './sshConnectionRegistry';

jest.mock('@sage3/sagebase', () => ({
  SBCredentialsDB: { getDecryptedValue: jest.fn() },
  CredentialDecryptionError: class CredentialDecryptionError extends Error {},
}));

// A fake ssh2.Client: connect()/exec() are driven by emitting the events
// real ssh2 would emit, so the registry's actual event-wiring is exercised,
// not just its happy-path return values.
class FakeStream extends EventEmitter {
  public stderr = new EventEmitter();
  public written: string[] = [];
  public windowChanges: Array<{ rows: number; cols: number }> = [];
  write(data: string) {
    this.written.push(data);
    return true;
  }
  setWindow(rows: number, cols: number) {
    this.windowChanges.push({ rows, cols });
  }
}

class FakeClient extends EventEmitter {
  public lastExecCommand: string | undefined;
  public lastStream: FakeStream | undefined;
  connect(_config: unknown) {
    return this;
  }
  exec(command: string, _opts: unknown, callback: (err: Error | undefined, stream: FakeStream) => void) {
    this.lastExecCommand = command;
    this.lastStream = new FakeStream();
    callback(undefined, this.lastStream);
  }
  end() {
    this.emit('close');
  }
}

let fakeClients: FakeClient[] = [];

jest.mock('ssh2', () => ({
  Client: jest.fn().mockImplementation(() => {
    const client = new (require('./sshConnectionRegistry.spec').FakeClientForMock)();
    fakeClients.push(client);
    return client;
  }),
}));
// Expose FakeClient under the name the mock factory looks up (jest.mock
// factories can't close over outer-scope variables directly).
(exports as any).FakeClientForMock = FakeClient;

describe('SSHConnectionRegistry', () => {
  let registry: SSHConnectionRegistry;

  beforeEach(() => {
    fakeClients = [];
    jest.clearAllMocks();
    registry = new SSHConnectionRegistry();
  });

  function connectAndEmitReady(appId: string, params: any) {
    const connectPromise = registry.connect(appId, params);
    // Real ssh2 emits 'ready' asynchronously after connect(); simulate that.
    const client = fakeClients[fakeClients.length - 1];
    client.emit('ready');
    return connectPromise;
  }

  it('connects successfully: decrypts the credential, runs tmux new -A -s sage3-<appId>', async () => {
    (SBCredentialsDB.getDecryptedValue as jest.Mock).mockResolvedValue({
      type: 'sshPrivateKey',
      username: 'deploy',
      privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----',
    });

    const result = await connectAndEmitReady('app-1', {
      host: 'example.com',
      port: 22,
      ownerId: 'user-1',
      credentialId: 'cred-1',
    });

    expect(result).toEqual({ success: true });
    expect(SBCredentialsDB.getDecryptedValue).toHaveBeenCalledWith('cred-1', 'user-1');
    const client = fakeClients[0];
    expect(client.lastExecCommand).toBe('tmux new -A -s sage3-app-1');
    expect(registry.getConnection('app-1')).toBeDefined();
  });

  it('returns credential_unavailable when the stored credential fails to decrypt', async () => {
    (SBCredentialsDB.getDecryptedValue as jest.Mock).mockRejectedValue(new CredentialDecryptionError('bad'));

    const result = await registry.connect('app-2', {
      host: 'example.com',
      port: 22,
      ownerId: 'user-1',
      credentialId: 'cred-1',
    });

    expect(result).toEqual({ success: false, error: 'credential_unavailable' });
    expect(registry.getConnection('app-2')).toBeUndefined();
  });

  it('returns unreachable when the SSH connection itself errors before ready', async () => {
    const connectPromise = registry.connect('app-3', {
      host: 'unreachable.example.com',
      port: 22,
      ownerId: 'user-1',
      newCredential: { name: 'x', value: { type: 'sshPrivateKey', username: 'u', privateKey: 'key' } },
    });
    const client = fakeClients[0];
    client.emit('error', new Error('ECONNREFUSED'));

    const result = await connectPromise;
    expect(result).toEqual({ success: false, error: 'unreachable' });
  });

  it('returns tmux_failed when exec itself errors', async () => {
    class FailingExecClient extends FakeClient {
      exec(_command: string, _opts: unknown, callback: (err: Error | undefined, stream: any) => void) {
        callback(new Error('exec failed'), undefined);
      }
    }
    fakeClients = [];
    (require('ssh2').Client as jest.Mock).mockImplementationOnce(() => {
      const client = new FailingExecClient();
      fakeClients.push(client);
      return client;
    });

    const connectPromise = registry.connect('app-4', {
      host: 'example.com',
      port: 22,
      ownerId: 'user-1',
      newCredential: { name: 'x', value: { type: 'sshPrivateKey', username: 'u', privateKey: 'key' } },
    });
    fakeClients[0].emit('ready');

    const result = await connectPromise;
    expect(result).toEqual({ success: false, error: 'tmux_failed' });
  });

  it('persists a newCredential only after a successful connect', async () => {
    (SBCredentialsDB.getDecryptedValue as jest.Mock).mockResolvedValue(undefined);
    const createOrUpdate = jest.fn().mockResolvedValue({ id: 'new-cred-id' });
    (SBCredentialsDB as any).createOrUpdate = createOrUpdate;

    await connectAndEmitReady('app-5', {
      host: 'example.com',
      port: 22,
      ownerId: 'user-1',
      newCredential: { name: 'my-key', value: { type: 'sshPrivateKey', username: 'u', privateKey: 'key' } },
    });

    expect(createOrUpdate).toHaveBeenCalledWith('user-1', 'sshPrivateKey', 'my-key', {
      type: 'sshPrivateKey',
      username: 'u',
      privateKey: 'key',
    });
  });

  it('does not persist a newCredential when the connect fails', async () => {
    const createOrUpdate = jest.fn();
    (SBCredentialsDB as any).createOrUpdate = createOrUpdate;

    const connectPromise = registry.connect('app-6', {
      host: 'bad.example.com',
      port: 22,
      ownerId: 'user-1',
      newCredential: { name: 'my-key', value: { type: 'sshPrivateKey', username: 'u', privateKey: 'key' } },
    });
    fakeClients[0].emit('error', new Error('ECONNREFUSED'));
    await connectPromise;

    expect(createOrUpdate).not.toHaveBeenCalled();
  });

  it('onOutput subscribers receive data written to the remote stream', async () => {
    (SBCredentialsDB.getDecryptedValue as jest.Mock).mockResolvedValue({
      type: 'sshPrivateKey',
      username: 'u',
      privateKey: 'key',
    });
    await connectAndEmitReady('app-7', { host: 'h', port: 22, ownerId: 'user-1', credentialId: 'cred-1' });

    const received: string[] = [];
    registry.onOutput('app-7', (data) => received.push(data));

    const client = fakeClients[0];
    client.lastStream!.emit('data', Buffer.from('hello'));

    expect(received).toEqual(['hello']);
  });

  it('write() sends data to the remote stream only if a connection exists', async () => {
    expect(registry.write('no-such-app', 'ls\n')).toBe(false);

    (SBCredentialsDB.getDecryptedValue as jest.Mock).mockResolvedValue({
      type: 'sshPrivateKey',
      username: 'u',
      privateKey: 'key',
    });
    await connectAndEmitReady('app-8', { host: 'h', port: 22, ownerId: 'user-1', credentialId: 'cred-1' });

    expect(registry.write('app-8', 'ls\n')).toBe(true);
    expect(fakeClients[0].lastStream!.written).toEqual(['ls\n']);
  });

  it('resize() calls setWindow on the remote stream', async () => {
    (SBCredentialsDB.getDecryptedValue as jest.Mock).mockResolvedValue({
      type: 'sshPrivateKey',
      username: 'u',
      privateKey: 'key',
    });
    await connectAndEmitReady('app-9', { host: 'h', port: 22, ownerId: 'user-1', credentialId: 'cred-1' });

    expect(registry.resize('app-9', 80, 24)).toBe(true);
    expect(fakeClients[0].lastStream!.windowChanges).toEqual([{ rows: 24, cols: 80 }]);
  });

  it('disconnect() ends the underlying connection and removes it from the registry', async () => {
    (SBCredentialsDB.getDecryptedValue as jest.Mock).mockResolvedValue({
      type: 'sshPrivateKey',
      username: 'u',
      privateKey: 'key',
    });
    await connectAndEmitReady('app-10', { host: 'h', port: 22, ownerId: 'user-1', credentialId: 'cred-1' });

    registry.disconnect('app-10');

    expect(registry.getConnection('app-10')).toBeUndefined();
  });

  it('reconnecting after a remote stream close uses the stored ownerId, not a fresh caller identity', async () => {
    (SBCredentialsDB.getDecryptedValue as jest.Mock).mockResolvedValue({
      type: 'sshPrivateKey',
      username: 'u',
      privateKey: 'key',
    });
    await connectAndEmitReady('app-11', { host: 'h', port: 22, ownerId: 'owner-user', credentialId: 'cred-1' });

    // Simulate the remote stream closing unexpectedly (network blip).
    fakeClients[0].lastStream!.emit('close');
    expect(registry.getConnection('app-11')).toBeUndefined();

    // A later reconnect call (as Task 3's WS route would trigger) must reuse
    // the ORIGINAL ownerId — it is never told the identity of whichever
    // browser's WebSocket happened to trigger this reconnect attempt.
    (SBCredentialsDB.getDecryptedValue as jest.Mock).mockClear();
    await connectAndEmitReady('app-11', { host: 'h', port: 22, ownerId: 'owner-user', credentialId: 'cred-1' });
    expect(SBCredentialsDB.getDecryptedValue).toHaveBeenCalledWith('cred-1', 'owner-user');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /home/eriam/next/.worktrees/ssh-terminal/webstack && npx nx run homebase:test --testPathPattern=sshConnectionRegistry`
Expected: FAIL — `Cannot find module './sshConnectionRegistry'`

- [ ] **Step 4: Write the implementation**

Create `webstack/apps/homebase/src/ssh/sshConnectionRegistry.ts`:

```typescript
/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 *
 * The only place anywhere that calls SBCredentialsDB.getDecryptedValue()
 * for an sshPrivateKey credential. Holds at most one live SSH connection
 * per app instance (keyed by appId) — this is a SHARED, collaborative
 * terminal, not one connection per browser tab. A (re)connect always
 * decrypts using the connection's own stored ownerId, never the identity
 * of whichever caller happens to trigger it — this is what lets any
 * viewer of the app cause a reconnect without ever needing (or being
 * able to use) someone else's credential themselves.
 */

import { Client } from 'ssh2';
import { SBCredentialsDB, CredentialDecryptionError } from '@sage3/sagebase';

export type ConnectParams = {
  host: string;
  port: number;
  ownerId: string;
  credentialId?: string;
  newCredential?: { name: string; value: { type: 'sshPrivateKey'; username: string; privateKey: string; passphrase?: string } };
};

export type ConnectResult = { success: true } | { success: false; error: 'auth_failed' | 'unreachable' | 'tmux_failed' | 'credential_unavailable' };

export type ConnectionStatus = { connected: boolean; error?: string };

type SSHConnection = {
  client: Client;
  stream: NodeJS.ReadWriteStream & { setWindow: (rows: number, cols: number, height?: number, width?: number) => void };
  outputListeners: Set<(data: string) => void>;
  statusListeners: Set<(status: ConnectionStatus) => void>;
};

function tmuxSessionName(appId: string): string {
  return `sage3-${appId}`;
}

export class SSHConnectionRegistry {
  private connections = new Map<string, SSHConnection>();

  public getConnection(appId: string): SSHConnection | undefined {
    return this.connections.get(appId);
  }

  public async connect(appId: string, params: ConnectParams): Promise<ConnectResult> {
    let username: string;
    let privateKey: string;
    let passphrase: string | undefined;

    if (params.credentialId) {
      let value;
      try {
        value = await SBCredentialsDB.getDecryptedValue(params.credentialId, params.ownerId);
      } catch (error) {
        if (error instanceof CredentialDecryptionError) {
          return { success: false, error: 'credential_unavailable' };
        }
        throw error;
      }
      if (!value || value.type !== 'sshPrivateKey') {
        return { success: false, error: 'credential_unavailable' };
      }
      username = value.username;
      privateKey = value.privateKey;
      passphrase = value.passphrase;
    } else if (params.newCredential) {
      username = params.newCredential.value.username;
      privateKey = params.newCredential.value.privateKey;
      passphrase = params.newCredential.value.passphrase;
    } else {
      return { success: false, error: 'credential_unavailable' };
    }

    const client = new Client();

    const connectResult = await new Promise<ConnectResult>((resolve) => {
      client.on('ready', () => {
        client.exec(`tmux new -A -s ${tmuxSessionName(appId)}`, { pty: true }, (execErr, stream) => {
          if (execErr || !stream) {
            client.end();
            resolve({ success: false, error: 'tmux_failed' });
            return;
          }

          const connection: SSHConnection = {
            client,
            stream: stream as unknown as SSHConnection['stream'],
            outputListeners: new Set(),
            statusListeners: new Set(),
          };
          this.connections.set(appId, connection);

          stream.on('data', (data: Buffer) => {
            connection.outputListeners.forEach((listener) => listener(data.toString('utf8')));
          });
          stream.stderr?.on('data', (data: Buffer) => {
            connection.outputListeners.forEach((listener) => listener(data.toString('utf8')));
          });
          stream.on('close', () => {
            this.connections.delete(appId);
            connection.statusListeners.forEach((listener) => listener({ connected: false }));
            client.end();
          });

          resolve({ success: true });
        });
      });

      client.on('error', () => {
        resolve({ success: false, error: 'unreachable' });
      });

      client.connect({
        host: params.host,
        port: params.port,
        username,
        privateKey,
        passphrase,
      });
    });

    if (connectResult.success && params.newCredential && !params.credentialId) {
      await SBCredentialsDB.createOrUpdate(params.ownerId, 'sshPrivateKey', params.newCredential.name, params.newCredential.value);
    }

    return connectResult;
  }

  public disconnect(appId: string): void {
    const connection = this.connections.get(appId);
    if (!connection) return;
    connection.client.end();
    this.connections.delete(appId);
  }

  public write(appId: string, data: string): boolean {
    const connection = this.connections.get(appId);
    if (!connection) return false;
    connection.stream.write(data);
    return true;
  }

  public resize(appId: string, cols: number, rows: number): boolean {
    const connection = this.connections.get(appId);
    if (!connection) return false;
    connection.stream.setWindow(rows, cols);
    return true;
  }

  public onOutput(appId: string, listener: (data: string) => void): () => void {
    const connection = this.connections.get(appId);
    if (!connection) return () => undefined;
    connection.outputListeners.add(listener);
    return () => connection.outputListeners.delete(listener);
  }

  public onStatus(appId: string, listener: (status: ConnectionStatus) => void): () => void {
    const connection = this.connections.get(appId);
    if (!connection) return () => undefined;
    connection.statusListeners.add(listener);
    return () => connection.statusListeners.delete(listener);
  }
}

export const sshConnectionRegistry = new SSHConnectionRegistry();
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /home/eriam/next/.worktrees/ssh-terminal/webstack && npx nx run homebase:test --testPathPattern=sshConnectionRegistry`
Expected: PASS, 10 tests

- [ ] **Step 6: Commit**

```bash
cd /home/eriam/next/.worktrees/ssh-terminal
git add webstack/package.json webstack/apps/homebase/src/ssh/sshConnectionRegistry.ts webstack/apps/homebase/src/ssh/sshConnectionRegistry.spec.ts
git commit -m "feat(ssh-terminal): add SSH+tmux connection registry (no local PTY, tmux runs remotely)"
```

---

### Task 2: First-party integration — `POST /api/integrations/ssh/connect`

**Files:**
- Create: `webstack/apps/homebase/src/api/routers/custom/integrations/ssh.ts`
- Modify: `webstack/apps/homebase/src/api/routers/custom/index.ts`
- Modify: `webstack/apps/homebase/src/api/routers/httpRouter.ts`
- Test: `webstack/libs/backend/src/lib/generics/sshIntegration.integration.spec.ts`
- Test: `webstack/libs/backend/src/lib/generics/sshIntegrationRouterTestHelper.ts`

**Interfaces:**
- Consumes: `sshConnectionRegistry` (Task 1) — specifically its `connect(appId, params): Promise<ConnectResult>` method.
- Produces: `SSHIntegrationRouter(): express.Router`, mounted at `/api/integrations/ssh` — this is a leaf task; nothing later in this plan imports from it directly (Task 5's frontend calls it over HTTP).

- [ ] **Step 1: Write the failing integration test**

This mirrors `ctfdIntegration.integration.spec.ts`'s structure exactly, but mocks the connection registry's `connect()` directly (there is no external HTTP boundary to mock here — the registry itself is the boundary, already unit-tested in Task 1 with a mocked `ssh2.Client`). Create `webstack/libs/backend/src/lib/generics/sshIntegrationRouterTestHelper.ts`:

```typescript
/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 *
 * Test-only helper — same reasoning as credentialsRouterTestHelper.ts and
 * ctfdIntegrationRouterTestHelper.ts: the real production router
 * (apps/homebase/src/api/routers/custom/integrations/ssh.ts) is written
 * against the module-level sshConnectionRegistry singleton; this helper
 * takes an injectable connect() function so the test can control its
 * result without touching the real registry or a real ssh2.Client.
 */

import * as express from 'express';
import { SBAuthSchema } from '@sage3/sagebase';
import { ConnectParams, ConnectResult } from '@sage3/backend';

export function SSHIntegrationRouterTestHelper(connect: (appId: string, params: ConnectParams) => Promise<ConnectResult>): express.Router {
  const router = express.Router();
  router.use(express.json());

  router.post('/connect', async (req, res) => {
    const user = req.user as SBAuthSchema;
    const { appId, host, port, credentialId, newCredential } = req.body;

    if (!appId || !host || !port || (!credentialId && !newCredential)) {
      res.status(400).json({ error: 'appId, host, port, and either credentialId or newCredential are required' });
      return;
    }
    if (newCredential && (!newCredential.name || !newCredential.value?.username || !newCredential.value?.privateKey)) {
      res.status(400).json({ error: 'newCredential.name, newCredential.value.username, and newCredential.value.privateKey are required' });
      return;
    }

    const result = await connect(appId, { host, port, ownerId: user.id, credentialId, newCredential });

    if (!result.success) {
      const status = result.error === 'auth_failed' ? 401 : result.error === 'credential_unavailable' ? 500 : 502;
      res.status(status).json({ error: result.error });
      return;
    }

    res.status(200).json({ success: true });
  });

  return router;
}
```

Note: `ConnectParams`/`ConnectResult` need to be re-exported from `@sage3/backend` for this test helper to import them — Step 2 below adds that export alongside creating the real router, since both need it.

Create `webstack/libs/backend/src/lib/generics/sshIntegration.integration.spec.ts`:

```typescript
/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 *
 * Real Express + supertest integration test for the ssh integration
 * handler. The connection registry's connect() is injected directly
 * (already unit-tested against a mocked ssh2.Client in Task 1) — this
 * test's job is to verify the HTTP layer: validation, status codes, and
 * that req.user.id is what's passed through as ownerId.
 */

import * as express from 'express';
import * as request from 'supertest';
import { SSHIntegrationRouterTestHelper } from './sshIntegrationRouterTestHelper';
import { ConnectParams, ConnectResult } from '@sage3/backend';

function buildApp(userId: string, connect: (appId: string, params: ConnectParams) => Promise<ConnectResult>) {
  const app = express();
  app.use((req, _res, next) => {
    (req as express.Request & { user: { id: string } }).user = { id: userId };
    next();
  });
  app.use('/api/integrations/ssh', SSHIntegrationRouterTestHelper(connect));
  return app;
}

describe('SSHIntegrationRouter — real Express integration', () => {
  it('returns 200 on a successful connect, passing req.user.id as ownerId', async () => {
    const connect = jest.fn().mockResolvedValue({ success: true });
    const app = buildApp('user-1', connect);

    const res = await request(app).post('/api/integrations/ssh/connect').send({
      appId: 'app-abc',
      host: 'example.com',
      port: 22,
      credentialId: 'cred-1',
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(connect).toHaveBeenCalledWith('app-abc', {
      host: 'example.com',
      port: 22,
      ownerId: 'user-1',
      credentialId: 'cred-1',
      newCredential: undefined,
    });
  });

  it('returns 400 when neither credentialId nor newCredential is provided', async () => {
    const connect = jest.fn();
    const app = buildApp('user-1', connect);

    const res = await request(app).post('/api/integrations/ssh/connect').send({ appId: 'a', host: 'h', port: 22 });

    expect(res.status).toBe(400);
    expect(connect).not.toHaveBeenCalled();
  });

  it('returns 400 when newCredential is missing required fields', async () => {
    const connect = jest.fn();
    const app = buildApp('user-1', connect);

    const res = await request(app).post('/api/integrations/ssh/connect').send({
      appId: 'a',
      host: 'h',
      port: 22,
      newCredential: { name: 'incomplete' },
    });

    expect(res.status).toBe(400);
    expect(connect).not.toHaveBeenCalled();
  });

  it('maps auth_failed to 401', async () => {
    const connect = jest.fn().mockResolvedValue({ success: false, error: 'auth_failed' });
    const app = buildApp('user-1', connect);

    const res = await request(app)
      .post('/api/integrations/ssh/connect')
      .send({ appId: 'a', host: 'h', port: 22, credentialId: 'c' });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'auth_failed' });
  });

  it('maps unreachable to 502', async () => {
    const connect = jest.fn().mockResolvedValue({ success: false, error: 'unreachable' });
    const app = buildApp('user-1', connect);

    const res = await request(app)
      .post('/api/integrations/ssh/connect')
      .send({ appId: 'a', host: 'h', port: 22, credentialId: 'c' });

    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'unreachable' });
  });

  it('maps tmux_failed to 502', async () => {
    const connect = jest.fn().mockResolvedValue({ success: false, error: 'tmux_failed' });
    const app = buildApp('user-1', connect);

    const res = await request(app)
      .post('/api/integrations/ssh/connect')
      .send({ appId: 'a', host: 'h', port: 22, credentialId: 'c' });

    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'tmux_failed' });
  });

  it('maps credential_unavailable to 500', async () => {
    const connect = jest.fn().mockResolvedValue({ success: false, error: 'credential_unavailable' });
    const app = buildApp('user-1', connect);

    const res = await request(app)
      .post('/api/integrations/ssh/connect')
      .send({ appId: 'a', host: 'h', port: 22, credentialId: 'c' });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'credential_unavailable' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/eriam/next/.worktrees/ssh-terminal/webstack && npx nx test backend --testPathPattern=sshIntegration --skip-nx-cache`
Expected: FAIL — `Cannot find module '@sage3/backend'` export of `ConnectParams`/`ConnectResult` (they exist in Task 1's file, in `apps/homebase`, not yet re-exported from the `libs/backend` published surface)

- [ ] **Step 3: Export `ConnectParams`/`ConnectResult` from `@sage3/backend`**

In `webstack/libs/backend/src/lib/generics/index.ts` (or wherever this barrel's `export * from` lines live — check `webstack/libs/backend/src/index.ts` for the exact re-export chain first), add a type-only re-export. Since `ConnectParams`/`ConnectResult` are defined in `apps/homebase` (not `libs/backend`), and app code can't be imported by a library, redeclare these two types directly in `libs/backend` instead, as the single source of truth, and have Task 1's registry import them from there instead of defining its own copy.

Create `webstack/libs/backend/src/lib/generics/sshTypes.ts`:

```typescript
/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

export type ConnectParams = {
  host: string;
  port: number;
  ownerId: string;
  credentialId?: string;
  newCredential?: { name: string; value: { type: 'sshPrivateKey'; username: string; privateKey: string; passphrase?: string } };
};

export type ConnectResult = { success: true } | { success: false; error: 'auth_failed' | 'unreachable' | 'tmux_failed' | 'credential_unavailable' };
```

Add `export * from './generics/sshTypes';` to `webstack/libs/backend/src/index.ts` (alongside the existing `export *` lines for the other generics).

Go back to Task 1's `webstack/apps/homebase/src/ssh/sshConnectionRegistry.ts` and replace its own local `ConnectParams`/`ConnectResult` type definitions with an import:

```typescript
import { ConnectParams, ConnectResult, ConnectionStatus } from '@sage3/backend';
```

(remove the three `export type ConnectParams = ...`, `export type ConnectResult = ...` — keep `ConnectionStatus` local since it's homebase-internal only, not needed by the REST layer.)

Re-run Task 1's test to confirm nothing broke: `cd /home/eriam/next/.worktrees/ssh-terminal/webstack && npx nx run homebase:test --testPathPattern=sshConnectionRegistry` — expect the same 10 tests still passing.

- [ ] **Step 4: Re-run this task's test to verify it fails for the real, expected reason**

Run: `cd /home/eriam/next/.worktrees/ssh-terminal/webstack && npx nx test backend --testPathPattern=sshIntegration --skip-nx-cache`
Expected: FAIL — `Cannot find module './sshIntegrationRouterTestHelper'` no longer applies (helper already written in Step 1); should now fail only on the production router not existing yet — if it unexpectedly passes already, something is wrong, stop and investigate before continuing.

- [ ] **Step 5: Write the production router**

Create `webstack/apps/homebase/src/api/routers/custom/integrations/ssh.ts`:

```typescript
/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 *
 * First-party integration handler. Unlike the ctfd handler, this call
 * doesn't just validate a credential — it *is* the actual connection
 * setup. On success, the resulting live connection is registered in
 * sshConnectionRegistry under appId; the frontend's own updateState()
 * call (not this handler) is what other viewers then see.
 */

import * as express from 'express';
import { SBAuthSchema } from '@sage3/sagebase';
import { sshConnectionRegistry } from '../../../../ssh/sshConnectionRegistry';

export function SSHIntegrationRouter(): express.Router {
  const router = express.Router();
  router.use(express.json());

  router.post('/connect', async (req, res) => {
    const user = req.user as SBAuthSchema;
    const { appId, host, port, credentialId, newCredential } = req.body;

    if (!appId || !host || !port || (!credentialId && !newCredential)) {
      res.status(400).json({ error: 'appId, host, port, and either credentialId or newCredential are required' });
      return;
    }
    if (newCredential && (!newCredential.name || !newCredential.value?.username || !newCredential.value?.privateKey)) {
      res.status(400).json({ error: 'newCredential.name, newCredential.value.username, and newCredential.value.privateKey are required' });
      return;
    }

    const result = await sshConnectionRegistry.connect(appId, { host, port, ownerId: user.id, credentialId, newCredential });

    if (!result.success) {
      const status = result.error === 'auth_failed' ? 401 : result.error === 'credential_unavailable' ? 500 : 502;
      res.status(status).json({ error: result.error });
      return;
    }

    res.status(200).json({ success: true });
  });

  return router;
}
```

Add the export in `webstack/apps/homebase/src/api/routers/custom/index.ts`:
```typescript
export * from './integrations/ssh';
```

Mount it in `webstack/apps/homebase/src/api/routers/httpRouter.ts`, alongside the existing credentials/ctfd mounts:
```typescript
  // First-party integration handlers
  router.use('/integrations/ctfd', CtfdIntegrationRouter());
  router.use('/integrations/ssh', SSHIntegrationRouter());
```
(and add `SSHIntegrationRouter` to the existing custom-routes import line)

- [ ] **Step 6: Run test to verify it passes**

Run: `cd /home/eriam/next/.worktrees/ssh-terminal/webstack && npx nx test backend --testPathPattern=sshIntegration --skip-nx-cache`
Expected: PASS, 7 tests

- [ ] **Step 7: Confirm homebase still builds**

Run: `cd /home/eriam/next/.worktrees/ssh-terminal/webstack && npx nx run homebase:build`
Expected: `webpack compiled successfully`

- [ ] **Step 8: Commit**

```bash
cd /home/eriam/next/.worktrees/ssh-terminal
git add webstack/libs/backend/src/lib/generics/sshTypes.ts webstack/libs/backend/src/index.ts \
  webstack/apps/homebase/src/ssh/sshConnectionRegistry.ts \
  webstack/libs/backend/src/lib/generics/sshIntegration.integration.spec.ts \
  webstack/libs/backend/src/lib/generics/sshIntegrationRouterTestHelper.ts \
  webstack/apps/homebase/src/api/routers/custom/integrations/ssh.ts \
  webstack/apps/homebase/src/api/routers/custom/index.ts \
  webstack/apps/homebase/src/api/routers/httpRouter.ts
git commit -m "feat(ssh-terminal): add first-party ssh integration handler (POST /api/integrations/ssh/connect)"
```

---

### Task 3: WebSocket route — `/api/ssh/terminal`

**Files:**
- Modify: `webstack/apps/homebase/src/main.ts`
- Test: `webstack/apps/homebase/src/ssh/sshWebSocketRelay.spec.ts`
- Create: `webstack/apps/homebase/src/ssh/sshWebSocketRelay.ts`

**Interfaces:**
- Consumes: `sshConnectionRegistry` (Task 1) — `write`, `resize`, `onOutput`, `onStatus`, `disconnect`.
- Produces: `attachSSHWebSocketServer(server: WebSocket.Server): void` — wires up the `connection` handler; `main.ts` calls this once and adds a new `wsPath === 'ssh'` branch to its existing upgrade handler.

**A note on `getAppState`'s signature:** the app-state read this needs (`AppsCollection.get(appId)`, confirmed in `apps/homebase/src/api/collections/apps.ts`, inherited from the generic `SAGE3Collection<T>` base class in `libs/backend/src/lib/generics/SAGECollection.ts:101`) is `public async get(id: string): Promise<SBDocument<T> | undefined>` — genuinely asynchronous (it's a Redis read). `getAppState` below is therefore `(appId: string) => Promise<SSHAppState>`, not a synchronous function — every call site awaits it.

The relay logic (who may send `input`, how `output`/`status` get broadcast) is pulled into its own small, unit-testable module rather than written inline in `main.ts`, since `main.ts` itself has no existing test coverage and is already a large file — this keeps the new logic isolated and testable without needing to boot a real HTTP server.

- [ ] **Step 1: Write the failing test**

Create `webstack/apps/homebase/src/ssh/sshWebSocketRelay.spec.ts`:

```typescript
/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { EventEmitter } from 'events';
import { SSHConnectionRegistry } from './sshConnectionRegistry';
import { attachSSHWebSocketServer } from './sshWebSocketRelay';

class FakeSocket extends EventEmitter {
  public sent: string[] = [];
  send(data: string) {
    this.sent.push(data);
  }
}

class FakeWSServer extends EventEmitter {}

function appState(overrides: Partial<{ ownerId: string; credentialId: string; host: string; port: number; controllerId: string }> = {}) {
  return { host: 'h', port: 22, ownerId: 'owner-1', credentialId: 'cred-1', controllerId: 'owner-1', ...overrides };
}

// getAppState is async in production (a Redis read via AppsCollection.get),
// so every test double for it must return a Promise too — this is what
// actually exercises the awaits inside attachSSHWebSocketServer, rather
// than accidentally passing with a synchronous stand-in that wouldn't
// catch a missing `await` in the implementation.
function asyncAppState(overrides: Parameters<typeof appState>[0] = {}) {
  return async () => appState(overrides);
}

describe('sshWebSocketRelay', () => {
  let registry: SSHConnectionRegistry;

  beforeEach(() => {
    registry = new SSHConnectionRegistry();
    jest.spyOn(registry, 'onOutput');
    jest.spyOn(registry, 'onStatus');
    jest.spyOn(registry, 'write').mockReturnValue(true);
    jest.spyOn(registry, 'resize').mockReturnValue(true);
    jest.spyOn(registry, 'connect').mockResolvedValue({ success: true });
    jest.spyOn(registry, 'getConnection').mockReturnValue({} as any);
  });

  function connectClient(wsServer: FakeWSServer, appId: string, userId: string) {
    const socket = new FakeSocket();
    wsServer.emit('connection', socket, { user: { id: userId }, url: `/ssh?appId=${appId}` });
    return socket;
  }

  it('broadcasts output to every connected viewer for the same appId', async () => {
    const wsServer = new FakeWSServer();
    attachSSHWebSocketServer(wsServer as any, registry, asyncAppState());

    const viewerA = connectClient(wsServer, 'app-1', 'user-a');
    const viewerB = connectClient(wsServer, 'app-1', 'user-b');
    await Promise.resolve(); // let the async getAppState()/connect() settle
    await Promise.resolve();

    const outputCallback = (registry.onOutput as jest.Mock).mock.calls[0][1];
    outputCallback('hello from remote');

    expect(JSON.parse(viewerA.sent[viewerA.sent.length - 1])).toEqual({ type: 'output', data: 'hello from remote' });
    expect(JSON.parse(viewerB.sent[viewerB.sent.length - 1])).toEqual({ type: 'output', data: 'hello from remote' });
  });

  it('writes input from the current controller to the connection', async () => {
    const wsServer = new FakeWSServer();
    attachSSHWebSocketServer(wsServer as any, registry, asyncAppState({ controllerId: 'user-a' }));

    const controller = connectClient(wsServer, 'app-2', 'user-a');
    await Promise.resolve();
    await Promise.resolve();

    controller.emit('message', JSON.stringify({ type: 'input', data: 'ls\n' }));
    await Promise.resolve(); // the message handler's own getAppState() read

    expect(registry.write).toHaveBeenCalledWith('app-2', 'ls\n');
  });

  it('drops input from a viewer who is not the current controller', async () => {
    const wsServer = new FakeWSServer();
    attachSSHWebSocketServer(wsServer as any, registry, asyncAppState({ controllerId: 'user-a' }));

    const nonController = connectClient(wsServer, 'app-3', 'user-b');
    await Promise.resolve();
    await Promise.resolve();

    nonController.emit('message', JSON.stringify({ type: 'input', data: 'rm -rf /\n' }));
    await Promise.resolve();

    expect(registry.write).not.toHaveBeenCalled();
  });

  it('forwards a resize message to the registry', async () => {
    const wsServer = new FakeWSServer();
    attachSSHWebSocketServer(wsServer as any, registry, asyncAppState({ controllerId: 'user-a' }));

    const controller = connectClient(wsServer, 'app-4', 'user-a');
    await Promise.resolve();
    await Promise.resolve();

    controller.emit('message', JSON.stringify({ type: 'resize', cols: 100, rows: 40 }));
    await Promise.resolve();

    expect(registry.resize).toHaveBeenCalledWith('app-4', 100, 40);
  });

  it('triggers a connect using the app state ownerId/credentialId, not the connecting viewer identity, when no connection exists yet', async () => {
    (registry.getConnection as jest.Mock).mockReturnValue(undefined);
    const wsServer = new FakeWSServer();
    attachSSHWebSocketServer(wsServer as any, registry, asyncAppState({ ownerId: 'the-real-owner', credentialId: 'the-real-cred' }));

    connectClient(wsServer, 'app-5', 'some-other-viewer');
    await Promise.resolve();
    await Promise.resolve();

    expect(registry.connect).toHaveBeenCalledWith('app-5', {
      host: 'h',
      port: 22,
      ownerId: 'the-real-owner',
      credentialId: 'the-real-cred',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/eriam/next/.worktrees/ssh-terminal/webstack && npx nx run homebase:test --testPathPattern=sshWebSocketRelay`
Expected: FAIL — `Cannot find module './sshWebSocketRelay'`

- [ ] **Step 3: Write the implementation**

Create `webstack/apps/homebase/src/ssh/sshWebSocketRelay.ts`:

```typescript
/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 *
 * Relays a browser WebSocket to/from the shared per-appId SSH connection.
 * Every viewer of the app instance connects here and receives the same
 * output broadcast; only the current controller's input is honored — this
 * is enforced here, not left to the frontend to self-police.
 */

import { WebSocket } from 'ws';
import { SSHConnectionRegistry } from './sshConnectionRegistry';

// The minimal shape this module needs from an SSHTerminal app's current
// state — supplied by the caller (main.ts) via a lookup function, since
// this module has no direct dependency on the app-state store.
type SSHAppState = {
  host: string;
  port: number;
  ownerId: string;
  credentialId?: string;
  controllerId?: string;
};

type ClientMessage = { type: 'input'; data: string } | { type: 'resize'; cols: number; rows: number };
type ServerMessage = { type: 'output'; data: string } | { type: 'status'; connected: boolean; error?: string };

function send(socket: WebSocket, message: ServerMessage) {
  socket.send(JSON.stringify(message));
}

export function attachSSHWebSocketServer(
  wsServer: { on: (event: 'connection', listener: (socket: WebSocket, req: { user: { id: string }; url: string }) => void) => void },
  registry: SSHConnectionRegistry,
  // Async: the real implementation reads this via AppsCollection.get(),
  // a Redis call — see the note above Step 1 explaining why.
  getAppState: (appId: string) => Promise<SSHAppState>
): void {
  // One shared broadcast per appId, fanned out to every currently-connected
  // viewer socket — NOT one registry.onOutput() subscription per socket.
  // A per-socket subscription is a real bug, not just redundant: each
  // subscription's callback only has access to its OWN socket (via
  // closure), so a second viewer's output callback can never reach the
  // first viewer's socket and vice versa — nothing would actually
  // broadcast to "every viewer," only to whichever single socket happened
  // to own that particular subscription. Only the FIRST viewer of a given
  // appId subscribes; later viewers ride along via viewersByApp.
  const viewersByApp = new Map<string, Set<WebSocket>>();
  const unsubscribeByApp = new Map<string, () => void>();

  wsServer.on('connection', async (socket, req) => {
    const url = new URL(req.url, 'http://localhost');
    const appId = url.searchParams.get('appId');
    if (!appId) {
      socket.close();
      return;
    }

    let viewers = viewersByApp.get(appId);
    if (!viewers) {
      viewers = new Set();
      viewersByApp.set(appId, viewers);
    }
    viewers.add(socket);

    if (!registry.getConnection(appId)) {
      const state = await getAppState(appId);
      await registry.connect(appId, {
        host: state.host,
        port: state.port,
        ownerId: state.ownerId,
        credentialId: state.credentialId,
      });
    }

    if (!unsubscribeByApp.has(appId)) {
      const unsubscribeOutput = registry.onOutput(appId, (data) => {
        viewersByApp.get(appId)?.forEach((viewerSocket) => send(viewerSocket, { type: 'output', data }));
      });
      const unsubscribeStatus = registry.onStatus(appId, (status) => {
        viewersByApp.get(appId)?.forEach((viewerSocket) => send(viewerSocket, { type: 'status', connected: status.connected, error: status.error }));
      });
      unsubscribeByApp.set(appId, () => {
        unsubscribeOutput();
        unsubscribeStatus();
      });
    }

    socket.on('message', async (raw: Buffer | string) => {
      let message: ClientMessage;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }

      const state = await getAppState(appId);
      if (message.type === 'input') {
        if (state.controllerId !== req.user.id) return;
        registry.write(appId, message.data);
      } else if (message.type === 'resize') {
        if (state.controllerId !== req.user.id) return;
        registry.resize(appId, message.cols, message.rows);
      }
    });

    socket.on('close', () => {
      const remaining = viewersByApp.get(appId);
      remaining?.delete(socket);
      if (remaining && remaining.size === 0) {
        unsubscribeByApp.get(appId)?.();
        unsubscribeByApp.delete(appId);
        viewersByApp.delete(appId);
      }
    });
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/eriam/next/.worktrees/ssh-terminal/webstack && npx nx run homebase:test --testPathPattern=sshWebSocketRelay`
Expected: PASS, 5 tests

- [ ] **Step 5: Wire the new WS server into `main.ts`**

Read `webstack/apps/homebase/src/main.ts` in full before editing — this step touches the same file Task 3 of the credentials-store plan didn't (a different area: the WebSocket upgrade handler, not the `SAGEBase.init()` call).

Add the import near the other custom-router imports:
```typescript
import { attachSSHWebSocketServer } from './ssh/sshWebSocketRelay';
import { sshConnectionRegistry } from './ssh/sshConnectionRegistry';
```

Find:
```typescript
  // Websocket setup
  const apiWebSocketServer = new WebSocket.Server({ noServer: true });

  const logsServer = new WebSocket.Server({ noServer: true });
```
Add a third server right after:
```typescript
  // Websocket setup
  const apiWebSocketServer = new WebSocket.Server({ noServer: true });

  const logsServer = new WebSocket.Server({ noServer: true });

  const sshTerminalServer = new WebSocket.Server({ noServer: true });
```

After the existing `logsServer.on('connection', ...)` block, wire the SSH relay. The relay needs a way to read an app's current state (host/port/ownerId/credentialId/controllerId) — this uses the existing `AppsCollection` (already imported in `main.ts` per `apps/homebase/src/api/collections`) to read a single app's document by id. `AppsCollection.get(id)` is `public async get(id: string): Promise<SBDocument<AppSchema> | undefined>` (confirmed in `libs/backend/src/lib/generics/SAGECollection.ts:101`, the base class `SAGE3AppsCollection` extends) — genuinely async, matching `attachSSHWebSocketServer`'s `getAppState` parameter type:
```typescript
  attachSSHWebSocketServer(sshTerminalServer, sshConnectionRegistry, async (appId: string) => {
    const app = await AppsCollection.get(appId);
    if (!app) throw new Error(`SSHTerminal> app ${appId} not found`);
    const state = app.data.state as { host: string; port: number; ownerId: string; credentialId?: string; controllerId?: string };
    return { host: state.host, port: state.port, ownerId: state.ownerId, credentialId: state.credentialId, controllerId: state.controllerId };
  });
```

In the `server.on('upgrade', ...)` handler, find the two spots handling `wsPath === 'api'` (one inside the JWT branch, one inside the session branch) and add a parallel `wsPath === 'ssh'` branch next to each, reusing the exact same auth flow already established for `'api'`:

In the JWT branch:
```typescript
              if (wsPath === 'api') {
                apiWebSocketServer.handleUpgrade(req, socket, head, (ws: WebSocket) => {
                  apiWebSocketServer.emit('connection', ws, req);
                });
              } else if (wsPath === 'ssh') {
                sshTerminalServer.handleUpgrade(req, socket, head, (ws: WebSocket) => {
                  sshTerminalServer.emit('connection', ws, req);
                });
              }
```

In the session branch:
```typescript
        if (wsPath === 'api') {
          apiWebSocketServer.handleUpgrade(req, socket, head, (ws: WebSocket) => {
            // Add the user info from passport to the ws request
            req.user = req.session.passport?.user;
            apiWebSocketServer.emit('connection', ws, req);
          });
        } else if (wsPath === 'ssh') {
          sshTerminalServer.handleUpgrade(req, socket, head, (ws: WebSocket) => {
            req.user = req.session.passport?.user;
            sshTerminalServer.emit('connection', ws, req);
          });
        }
```

Find the `exitHandler` function's `apiWebSocketServer.close();` line and add `sshTerminalServer.close();` right after it, so the new server is cleaned up on shutdown like the existing ones.

- [ ] **Step 6: Confirm homebase still builds**

Run: `cd /home/eriam/next/.worktrees/ssh-terminal/webstack && npx nx run homebase:build`
Expected: `webpack compiled successfully`

- [ ] **Step 7: Commit**

```bash
cd /home/eriam/next/.worktrees/ssh-terminal
git add webstack/apps/homebase/src/ssh/sshWebSocketRelay.ts webstack/apps/homebase/src/ssh/sshWebSocketRelay.spec.ts webstack/apps/homebase/src/main.ts
git commit -m "feat(ssh-terminal): add /api/ssh/terminal WebSocket route (broadcast output, controller-only input)"
```

---

### Task 4: Native app shell — schema, registration, setup form

**Files:**
- Create: `webstack/libs/applications/src/lib/apps/SSHTerminal/index.ts`
- Create: `webstack/libs/applications/src/lib/apps/SSHTerminal/icon.svg`
- Create: `webstack/libs/applications/src/lib/apps/SSHTerminal/SSHTerminal.tsx`
- Create: `webstack/libs/applications/src/lib/apps/SSHTerminal/SSHTerminal.spec.tsx`
- Create: `webstack/libs/frontend/src/lib/hooks/useCredentials.ts`
- Create: `webstack/libs/frontend/src/lib/hooks/useCredentials.spec.ts`
- Modify: `webstack/libs/applications/src/lib/apps.json`
- Modify: `webstack/libs/applications/src/lib/apps.ts`
- Modify: `webstack/sage3-dev.hjson`

**Interfaces:**
- Consumes: nothing from Tasks 1-3 directly (calls `/api/credentials?type=sshPrivateKey` and `/api/integrations/ssh/connect` over `fetch()`, matching how every other frontend piece in this codebase talks to these REST endpoints).
- Produces: the `SSHTerminal` app registered and creatable in SAGE3's UI, its `state` schema (`host`, `port`, `credentialId`, `ownerId`, `controllerId`, `connected`), and `useCredentials(type)` (a reusable hook — Task 5 imports it too, and any future native app needing a credential picker can reuse it).

- [ ] **Step 1: Write the failing test for `useCredentials`**

Create `webstack/libs/frontend/src/lib/hooks/useCredentials.spec.ts`:

```typescript
/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { renderHook, waitFor } from '@testing-library/react';
import { useCredentials } from './useCredentials';

describe('useCredentials', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  it('fetches credentials of the given type on mount', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: 'c1', name: 'my-key', type: 'sshPrivateKey', ownerId: 'u1', createdAt: 1, updatedAt: 1 }],
    });

    const { result } = renderHook(() => useCredentials('sshPrivateKey'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.credentials).toEqual([
      { id: 'c1', name: 'my-key', type: 'sshPrivateKey', ownerId: 'u1', createdAt: 1, updatedAt: 1 },
    ]);
    expect(global.fetch).toHaveBeenCalledWith('/api/credentials?type=sshPrivateKey', expect.anything());
  });

  it('starts with an empty list and loading=true before the fetch resolves', () => {
    (global.fetch as jest.Mock).mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useCredentials('sshPrivateKey'));
    expect(result.current.loading).toBe(true);
    expect(result.current.credentials).toEqual([]);
  });

  it('refetch() re-queries the list', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => [] });
    const { result } = renderHook(() => useCredentials('sshPrivateKey'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    result.current.refetch();
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/eriam/next/.worktrees/ssh-terminal/webstack && npx nx run frontend:test --testPathPattern=useCredentials`
Expected: FAIL — `Cannot find module './useCredentials'`

- [ ] **Step 3: Write the `useCredentials` hook**

Create `webstack/libs/frontend/src/lib/hooks/useCredentials.ts`:

```typescript
/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { useState, useEffect, useCallback } from 'react';

export type CredentialType = 'secretText' | 'usernamePassword' | 'sshPrivateKey';

export interface CredentialMetadata {
  id: string;
  ownerId: string;
  name: string;
  type: CredentialType;
  createdAt: number;
  updatedAt: number;
}

interface UseCredentialsResult {
  credentials: CredentialMetadata[];
  loading: boolean;
  refetch: () => void;
}

export function useCredentials(type: CredentialType): UseCredentialsResult {
  const [credentials, setCredentials] = useState<CredentialMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [refetchNonce, setRefetchNonce] = useState(0);

  const refetch = useCallback(() => setRefetchNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const resp = await fetch(`/api/credentials?type=${type}`, { headers: { 'Content-Type': 'application/json' } });
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

Add `export * from './lib/hooks/useCredentials';` to `webstack/libs/frontend/src/index.ts` (check the exact existing barrel pattern in that file first — it likely groups hook exports together).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/eriam/next/.worktrees/ssh-terminal/webstack && npx nx run frontend:test --testPathPattern=useCredentials`
Expected: PASS, 3 tests

- [ ] **Step 5: Write the app's state schema**

Create `webstack/libs/applications/src/lib/apps/SSHTerminal/index.ts`:

```typescript
/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { z } from 'zod';

export const schema = z.object({
  host: z.string(),
  port: z.number(),
  credentialId: z.string(),
  ownerId: z.string(),
  controllerId: z.string().optional(),
  connected: z.boolean(),
  executeInfo: z.object({
    executeFunc: z.string(),
    params: z.any(),
  }),
});
export type state = z.infer<typeof schema>;

export const init: Partial<state> = {
  host: '',
  port: 22,
  credentialId: '',
  ownerId: '',
  connected: false,
  executeInfo: { executeFunc: '', params: {} },
};

export const name = 'SSHTerminal';
```

- [ ] **Step 6: Add a simple icon**

Create `webstack/libs/applications/src/lib/apps/SSHTerminal/icon.svg` — copy `webstack/libs/applications/src/lib/apps/CodeEditor/icon.svg` verbatim as a starting placeholder icon (both apps are terminal/code-adjacent; a bespoke icon can replace this later without any code changes elsewhere, since apps only ever reference their icon by file path convention, never by content).

```bash
cd /home/eriam/next/.worktrees/ssh-terminal/webstack
cp libs/applications/src/lib/apps/CodeEditor/icon.svg libs/applications/src/lib/apps/SSHTerminal/icon.svg
```

- [ ] **Step 7: Write the failing test for the setup form**

Create `webstack/libs/applications/src/lib/apps/SSHTerminal/SSHTerminal.spec.tsx`:

```typescript
/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SSHTerminal from './SSHTerminal';
import * as useCredentialsModule from '@sage3/frontend';

jest.mock('@sage3/frontend', () => ({
  ...jest.requireActual('@sage3/frontend'),
  useAppStore: (selector: any) => selector({ updateState: jest.fn() }),
  useCredentials: jest.fn(),
}));

function buildApp(stateOverrides: Partial<{ host: string; port: number; credentialId: string; ownerId: string; controllerId: string; connected: boolean }> = {}) {
  return {
    _id: 'app-1',
    data: {
      state: { host: '', port: 22, credentialId: '', ownerId: '', connected: false, ...stateOverrides },
    },
  } as any;
}

describe('SSHTerminal setup form', () => {
  beforeEach(() => {
    (useCredentialsModule.useCredentials as jest.Mock).mockReturnValue({
      credentials: [{ id: 'cred-1', name: 'my-key', type: 'sshPrivateKey', ownerId: 'u1', createdAt: 1, updatedAt: 1 }],
      loading: false,
      refetch: jest.fn(),
    });
    global.fetch = jest.fn();
  });

  it('shows the setup form when no host is configured yet', () => {
    render(<SSHTerminal.AppComponent {...buildApp()} />);
    expect(screen.getByPlaceholderText(/host/i)).toBeInTheDocument();
  });

  it('lists existing sshPrivateKey credentials in the picker', () => {
    render(<SSHTerminal.AppComponent {...buildApp()} />);
    expect(screen.getByText('my-key')).toBeInTheDocument();
  });

  it('calls POST /api/integrations/ssh/connect with the picked credential on submit', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });

    render(<SSHTerminal.AppComponent {...buildApp()} />);
    fireEvent.change(screen.getByPlaceholderText(/host/i), { target: { value: 'example.com' } });
    fireEvent.click(screen.getByText('my-key'));
    fireEvent.click(screen.getByRole('button', { name: /connect/i }));

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/integrations/ssh/connect',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ appId: 'app-1', host: 'example.com', port: 22, credentialId: 'cred-1' }),
        })
      )
    );
  });

  it('shows a specific error message when the connect call fails with auth_failed', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'auth_failed' }) });

    render(<SSHTerminal.AppComponent {...buildApp()} />);
    fireEvent.change(screen.getByPlaceholderText(/host/i), { target: { value: 'example.com' } });
    fireEvent.click(screen.getByText('my-key'));
    fireEvent.click(screen.getByRole('button', { name: /connect/i }));

    await waitFor(() => expect(screen.getByText(/authentication failed/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 8: Run test to verify it fails**

Run: `cd /home/eriam/next/.worktrees/ssh-terminal/webstack && npx nx run applications:test --testPathPattern=SSHTerminal`
Expected: FAIL — `Cannot find module './SSHTerminal'`

- [ ] **Step 9: Write the setup form (`AppComponent`, setup branch only — the connected-terminal branch is Task 5)**

Create `webstack/libs/applications/src/lib/apps/SSHTerminal/SSHTerminal.tsx`:

```typescript
/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { useState } from 'react';
import { Box, Button, Input, VStack, RadioGroup, Radio, Text } from '@chakra-ui/react';
import { useAppStore, useCredentials } from '@sage3/frontend';
import { App } from '../../schema';
import { AppWindow } from '../../components';

import { state as AppState } from './index';

const ERROR_MESSAGES: Record<string, string> = {
  auth_failed: 'Authentication failed — check the selected key.',
  unreachable: 'Could not reach that host.',
  tmux_failed: 'Connected, but starting tmux failed on the remote host.',
  credential_unavailable: 'That stored credential is unavailable — try re-entering it.',
};

function SetupForm(props: App): JSX.Element {
  const [host, setHost] = useState('');
  const [port, setPort] = useState(22);
  const [credentialId, setCredentialId] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { credentials } = useCredentials('sshPrivateKey');
  const updateState = useAppStore((state) => state.updateState);

  async function handleConnect() {
    setConnecting(true);
    setError(null);
    try {
      const resp = await fetch('/api/integrations/ssh/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId: props._id, host, port, credentialId }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setError(ERROR_MESSAGES[data.error] || 'Connection failed.');
        return;
      }
      updateState(props._id, { host, port, credentialId, connected: true } as Partial<AppState>);
    } finally {
      setConnecting(false);
    }
  }

  return (
    <Box p={4}>
      <VStack align="stretch" spacing={3}>
        <Input placeholder="Host" value={host} onChange={(e) => setHost(e.target.value)} />
        <Input placeholder="Port" type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} />
        <RadioGroup value={credentialId} onChange={setCredentialId}>
          <VStack align="stretch">
            {credentials.map((c) => (
              <Radio key={c.id} value={c.id}>
                {c.name}
              </Radio>
            ))}
          </VStack>
        </RadioGroup>
        {error && <Text color="red.400">{error}</Text>}
        <Button onClick={handleConnect} isLoading={connecting} isDisabled={!host || !credentialId}>
          Connect
        </Button>
      </VStack>
    </Box>
  );
}

function AppComponent(props: App): JSX.Element {
  const s = props.data.state as AppState;

  return (
    <AppWindow app={props}>
      {!s.host ? (
        <SetupForm {...props} />
      ) : (
        <Box p={4}>
          <Text>Terminal view — added in a later task.</Text>
        </Box>
      )}
    </AppWindow>
  );
}

function ToolbarComponent(): JSX.Element {
  return <></>;
}

const GroupedToolbarComponent = () => {
  return null;
};

export default { AppComponent, ToolbarComponent, GroupedToolbarComponent };
```

- [ ] **Step 10: Run test to verify it passes**

Run: `cd /home/eriam/next/.worktrees/ssh-terminal/webstack && npx nx run applications:test --testPathPattern=SSHTerminal`
Expected: PASS, 4 tests

- [ ] **Step 11: Register the app**

In `webstack/libs/applications/src/lib/apps.json`, add `"SSHTerminal"` in alphabetical order (between `"SageIdeator"`/`"SageCell"`'s neighbors and `"SensorOverview"` — insert wherever alphabetically correct relative to the file's existing full list).

In `webstack/libs/applications/src/lib/apps.ts`, add the three corresponding lines, matching every other app's exact pattern:
```typescript
import { name as SSHTerminalName } from './apps/SSHTerminal';
```
(grouped with the other name-imports, alphabetically)
```typescript
import SSHTerminal from './apps/SSHTerminal/SSHTerminal';
```
(grouped with the other component-imports, alphabetically)
```typescript
  [SSHTerminalName]: {
    AppComponent: React.memo(SSHTerminal.AppComponent),
    ToolbarComponent: SSHTerminal.ToolbarComponent,
    GroupedToolbarComponent: SSHTerminal.GroupedToolbarComponent,
  },
```
(inside the `Applications` object, alphabetically among the existing entries)

In `webstack/sage3-dev.hjson`, add `"SSHTerminal"` to the `"apps"` array under `"features"` (read the file first to confirm its current exact list before editing — do not assume its contents, they may differ from other branches/worktrees).

- [ ] **Step 12: Confirm the frontend still builds**

Run: `cd /home/eriam/next/.worktrees/ssh-terminal/webstack && npx nx run webapp:build`
Expected: build succeeds (no TypeScript errors from the new app or its registration)

- [ ] **Step 13: Commit**

```bash
cd /home/eriam/next/.worktrees/ssh-terminal
git add webstack/libs/frontend/src/lib/hooks/useCredentials.ts webstack/libs/frontend/src/lib/hooks/useCredentials.spec.ts webstack/libs/frontend/src/index.ts \
  webstack/libs/applications/src/lib/apps/SSHTerminal/ \
  webstack/libs/applications/src/lib/apps.json webstack/libs/applications/src/lib/apps.ts \
  webstack/sage3-dev.hjson
git commit -m "feat(ssh-terminal): add SSHTerminal app shell, state schema, and setup form"
```

---

### Task 5: Terminal view — xterm.js, WebSocket client, take-control

**Files:**
- Modify: `webstack/libs/applications/src/lib/apps/SSHTerminal/SSHTerminal.tsx`
- Modify: `webstack/libs/applications/src/lib/apps/SSHTerminal/SSHTerminal.spec.tsx`
- Modify: `webstack/package.json` (add `@xterm/xterm` + `@xterm/addon-fit`)

**Interfaces:**
- Consumes: the WebSocket protocol from Task 3 (`{type: 'output', data}`, `{type: 'status', connected, error?}` incoming; `{type: 'input', data}`, `{type: 'resize', cols, rows}` outgoing) and `state.controllerId` from Task 4's schema.
- Produces: nothing further — this is the last task in the plan.

- [ ] **Step 1: Install the new frontend dependencies**

Run:
```bash
cd /home/eriam/next/.worktrees/ssh-terminal/webstack
npm install --legacy-peer-deps @xterm/xterm@^5.5.0 @xterm/addon-fit@^0.10.0
```

- [ ] **Step 2: Write the failing test for the terminal view**

Replace the content of `webstack/libs/applications/src/lib/apps/SSHTerminal/SSHTerminal.spec.tsx` with the Task 4 tests plus these additions (append these `describe` blocks after the existing `describe('SSHTerminal setup form', ...)` block, keeping everything from Task 4 intact):

```typescript
describe('SSHTerminal terminal view', () => {
  let sentMessages: string[];
  let wsInstances: MockWebSocket[];

  class MockWebSocket {
    static OPEN = 1;
    public readyState = 1;
    public onmessage: ((event: { data: string }) => void) | null = null;
    public onopen: (() => void) | null = null;
    public onclose: (() => void) | null = null;
    constructor(public url: string) {
      wsInstances.push(this);
    }
    send(data: string) {
      sentMessages.push(data);
    }
    close() {
      this.onclose?.();
    }
  }

  beforeEach(() => {
    sentMessages = [];
    wsInstances = [];
    (global as any).WebSocket = MockWebSocket;
  });

  it('opens a WebSocket to /api/ssh/terminal with the appId once connected', () => {
    render(<SSHTerminal.AppComponent {...buildApp({ host: 'example.com', port: 22, credentialId: 'cred-1', connected: true })} />);
    expect(wsInstances).toHaveLength(1);
    expect(wsInstances[0].url).toContain('/api/ssh/terminal?appId=app-1');
  });

  it('sends an input message when the current controller types, but not otherwise', () => {
    const { rerender } = render(
      <SSHTerminal.AppComponent {...buildApp({ host: 'h', port: 22, credentialId: 'c', connected: true, controllerId: 'user-1' })} />
    );
    // xterm.js's own onData callback isn't directly triggerable from a DOM
    // event in this test setup; this test instead verifies the component
    // does NOT eagerly send any input message just from rendering, which
    // is the property that matters for the "drop input from non-controllers"
    // requirement being satisfied on the SEND side too (the receive side
    // is already covered server-side in Task 3's tests).
    expect(sentMessages.filter((m) => JSON.parse(m).type === 'input')).toHaveLength(0);
  });

  it('shows a "Take control" button when the viewer is not the controller', () => {
    render(
      <SSHTerminal.AppComponent {...buildApp({ host: 'h', port: 22, credentialId: 'c', connected: true, controllerId: 'someone-else' })} />
    );
    expect(screen.getByRole('button', { name: /take control/i })).toBeInTheDocument();
  });

  it('does not show "Take control" to the current controller', () => {
    render(
      <SSHTerminal.AppComponent {...buildApp({ host: 'h', port: 22, credentialId: 'c', connected: true, controllerId: 'app-1-current-user' })} />
    );
    expect(screen.queryByRole('button', { name: /take control/i })).not.toBeInTheDocument();
  });
});
```

The third and fourth tests above rely on `SSHTerminal` reading the current user's id via the real `useUser()` hook from `libs/frontend/src/lib/providers/useUser.tsx` — confirmed (via `libs/applications/src/lib/apps/CodeEditor/CodeEditor.tsx:101` and `Cobrowse/Cobrowse.tsx:57`, both existing apps) to have this exact shape: `const { user } = useUser();` (a destructured `user` property, not the hook's direct return value), with the id field at `user?._id` (not `.id` — this codebase's `User` type follows the same `SBDoc` convention as `App`, where the id field is `_id`). Add this to the `jest.mock('@sage3/frontend', ...)` block at the top of this spec file, alongside the existing `useAppStore`/`useCredentials` mocks:

```typescript
jest.mock('@sage3/frontend', () => ({
  ...jest.requireActual('@sage3/frontend'),
  useAppStore: (selector: any) => selector({ updateState: jest.fn() }),
  useCredentials: jest.fn(),
  useUser: jest.fn(() => ({ user: { _id: 'app-1-current-user' } })),
}));
```
(this replaces the `jest.mock('@sage3/frontend', ...)` block already written in Task 4's Step 7 for this same file — add the `useUser` line to that existing mock rather than duplicating the whole block.)

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /home/eriam/next/.worktrees/ssh-terminal/webstack && npx nx run applications:test --testPathPattern=SSHTerminal`
Expected: FAIL — the terminal-view tests fail since `AppComponent` doesn't yet open a WebSocket or render a terminal/take-control button when `connected` is true

- [ ] **Step 4: Implement the terminal view**

Replace `webstack/libs/applications/src/lib/apps/SSHTerminal/SSHTerminal.tsx`'s content with the full app, combining Task 4's setup form with the new terminal view. Uses the real `useUser()` hook confirmed above — destructure `{ user }` from its return value, and read the id at `user?._id` (not `.id`):

```typescript
/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { useState, useEffect, useRef } from 'react';
import { Box, Button, Input, VStack, RadioGroup, Radio, Text } from '@chakra-ui/react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useAppStore, useCredentials, useUser } from '@sage3/frontend';
import { App } from '../../schema';
import { AppWindow } from '../../components';

import { state as AppState } from './index';

const ERROR_MESSAGES: Record<string, string> = {
  auth_failed: 'Authentication failed — check the selected key.',
  unreachable: 'Could not reach that host.',
  tmux_failed: 'Connected, but starting tmux failed on the remote host.',
  credential_unavailable: 'That stored credential is unavailable — try re-entering it.',
};

function SetupForm(props: App): JSX.Element {
  const [host, setHost] = useState('');
  const [port, setPort] = useState(22);
  const [credentialId, setCredentialId] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { credentials } = useCredentials('sshPrivateKey');
  const updateState = useAppStore((state) => state.updateState);

  async function handleConnect() {
    setConnecting(true);
    setError(null);
    try {
      const resp = await fetch('/api/integrations/ssh/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId: props._id, host, port, credentialId }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setError(ERROR_MESSAGES[data.error] || 'Connection failed.');
        return;
      }
      updateState(props._id, { host, port, credentialId, connected: true } as Partial<AppState>);
    } finally {
      setConnecting(false);
    }
  }

  return (
    <Box p={4}>
      <VStack align="stretch" spacing={3}>
        <Input placeholder="Host" value={host} onChange={(e) => setHost(e.target.value)} />
        <Input placeholder="Port" type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} />
        <RadioGroup value={credentialId} onChange={setCredentialId}>
          <VStack align="stretch">
            {credentials.map((c) => (
              <Radio key={c.id} value={c.id}>
                {c.name}
              </Radio>
            ))}
          </VStack>
        </RadioGroup>
        {error && <Text color="red.400">{error}</Text>}
        <Button onClick={handleConnect} isLoading={connecting} isDisabled={!host || !credentialId}>
          Connect
        </Button>
      </VStack>
    </Box>
  );
}

function TerminalView(props: App): JSX.Element {
  const s = props.data.state as AppState;
  const { user } = useUser();
  const updateState = useAppStore((state) => state.updateState);
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const terminalRef = useRef<Terminal | null>(null);

  const isController = s.controllerId === user?._id;

  useEffect(() => {
    const term = new Terminal({ convertEol: true });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    if (containerRef.current) {
      term.open(containerRef.current);
      fitAddon.fit();
    }
    terminalRef.current = term;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/ssh/terminal?appId=${props._id}`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === 'output') {
        term.write(message.data);
      } else if (message.type === 'status') {
        updateState(props._id, { connected: message.connected } as Partial<AppState>);
      }
    };

    const dataDisposable = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      }
    });
    if (containerRef.current) resizeObserver.observe(containerRef.current);

    return () => {
      dataDisposable.dispose();
      resizeObserver.disconnect();
      ws.close();
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props._id]);

  function handleTakeControl() {
    if (!user) return;
    updateState(props._id, { controllerId: user._id } as Partial<AppState>);
  }

  return (
    <Box position="relative" width="100%" height="100%">
      <Box ref={containerRef} width="100%" height="100%" />
      {!isController && (
        <Button position="absolute" top={2} right={2} size="sm" onClick={handleTakeControl}>
          Take control
        </Button>
      )}
    </Box>
  );
}

function AppComponent(props: App): JSX.Element {
  const s = props.data.state as AppState;

  return (
    <AppWindow app={props}>
      {!s.host ? <SetupForm {...props} /> : <TerminalView {...props} />}
    </AppWindow>
  );
}

function ToolbarComponent(): JSX.Element {
  return <></>;
}

const GroupedToolbarComponent = () => {
  return null;
};

export default { AppComponent, ToolbarComponent, GroupedToolbarComponent };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /home/eriam/next/.worktrees/ssh-terminal/webstack && npx nx run applications:test --testPathPattern=SSHTerminal`
Expected: PASS, 8 tests total (4 from Task 4 + 4 new)

- [ ] **Step 6: Confirm the frontend still builds**

Run: `cd /home/eriam/next/.worktrees/ssh-terminal/webstack && npx nx run webapp:build`
Expected: build succeeds

- [ ] **Step 7: Commit**

```bash
cd /home/eriam/next/.worktrees/ssh-terminal
git add webstack/package.json webstack/libs/applications/src/lib/apps/SSHTerminal/SSHTerminal.tsx webstack/libs/applications/src/lib/apps/SSHTerminal/SSHTerminal.spec.tsx
git commit -m "feat(ssh-terminal): add xterm.js terminal view, WebSocket client, and take-control button"
```

---

## Self-Review

**Spec coverage:**
- Native app, not PluginApp → Task 4/5, in `libs/applications`. ✓
- One shared SSH+tmux connection per app instance, `ssh2` + remote `tmux new -A -s sage3-<appId>`, no local PTY → Task 1. ✓
- Reconnect uses the app's own stored `ownerId`, not the connecting viewer's identity → Task 1's registry signature takes `ownerId` explicitly (never reads `req.user.id` internally), Task 3's relay explicitly tested to pass `state.ownerId`/`state.credentialId` on a fresh connect, regardless of which viewer's socket triggered it. ✓
- First-party `ssh` integration handler mirroring `ctfd`'s pattern, same error-code conventions, same "don't persist a bad newCredential" rule → Task 2. ✓
- WebSocket relay: broadcast output to all, input/resize only from `controllerId` → Task 3, enforced server-side (tested directly), not just hidden client-side. ✓
- `useCredentials` hook reusable, scoped by type → Task 4, lives in `libs/frontend` (native app, not a separate plugin repo). ✓
- xterm.js + fit addon, resize propagation, take-control button → Task 5. ✓
- Non-goal: multiple panes/windows per instance — not built anywhere in this plan (one `tmux` session per `appId`, no pane-splitting UI). ✓
- Non-goal: SCP/SFTP, session recording, password auth, jump-hosts — none of these appear anywhere in this plan's tasks. ✓

**Type consistency check:** `ConnectParams`/`ConnectResult` (Task 1, later centralized into `libs/backend` in Task 2 to avoid app-code-importing-into-a-library) → REST body/response shapes (Task 2) → WebSocket relay's `getAppState` return shape (Task 3) → app state schema (Task 4) → `TerminalView`'s state reads (Task 5) all agree on field names (`host`, `port`, `ownerId`, `credentialId`, `controllerId`, `connected`).

**Verified against the actual codebase during self-review — three real bugs found and fixed, not left as guesses:**

1. Task 5's "current user's id" access was initially written against a guessed API shape (`const user = useUser(); user?.id`). Checked directly against `libs/frontend/src/lib/providers/useUser.tsx` and two existing consumers (`CodeEditor.tsx:101`, `Cobrowse.tsx:57`) — the real shape is `const { user } = useUser();` with the id at `user?._id`, matching the same `SBDoc`-style `_id` convention `App` itself uses. The plan's code and tests were corrected to this real shape.
2. Task 3's `getAppState` callback (and its `main.ts` wiring in Step 5) were initially written as synchronous. Checked `AppsCollection.get()`'s real signature (`libs/backend/src/lib/generics/SAGECollection.ts:101`) — it's `public async get(id): Promise<SBDocument<T> | undefined>`, a Redis read. Every call site (`sshWebSocketRelay.ts`'s implementation, its test doubles, and the `main.ts` wiring example) was corrected to `async`/`await` throughout — a synchronous version would have either failed to type-check or silently read `undefined` state on every connection attempt.
3. **Found during Task 3's actual implementation, not caught in this plan's own self-review pass — corrected here after the fact.** `attachSSHWebSocketServer`'s original reference implementation called `registry.onOutput(appId, listener)` once per connecting socket, with `listener` closed over that one socket. This doesn't broadcast to "every viewer" at all: each subscription's callback can only reach the one socket it closed over, so a second viewer's own subscription can never deliver output to the first viewer's socket. The corrected version (shown above) uses one shared `viewersByApp: Map<appId, Set<WebSocket>>`, subscribes to `registry.onOutput`/`onStatus` only for the first viewer of a given `appId`, and fans out to every socket currently in that appId's Set — later viewers ride along on the existing subscription instead of getting their own. The task's own test (already shown above, unchanged) actually caught this: it registers two viewers and asserts both receive a broadcast triggered through `registry.onOutput`'s first recorded call, which only passes under the shared-subscription design.

**Known gap, deliberately left for a human decision rather than guessed at:** none — all three gaps found (above) were resolved by checking the actual source/tests rather than left open.
