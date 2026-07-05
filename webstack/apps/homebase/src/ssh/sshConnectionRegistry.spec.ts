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

// The installed jest version (28) doesn't have the async fake-timer helpers
// (advanceTimersByTimeAsync etc. arrived in jest 29) — advanceTimersByTime()
// itself is synchronous and only runs due timer callbacks, it doesn't also
// drain the microtask queue that the resulting promise continuations queue
// up onto. So every advance is followed by a few plain microtask flushes to
// let those continuations (which are themselves synchronous up to the next
// await) actually run before assertions.
async function flushMicrotasks(times = 5) {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

let fakeClients: FakeClient[] = [];

jest.mock('ssh2', () => ({
  Client: jest.fn().mockImplementation(() => {
    const client = new FakeClient();
    fakeClients.push(client);
    return client;
  }),
}));

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

  it('resolves with credential_unavailable (never hangs/throws) when credential resolution fails with an unexpected error', async () => {
    (SBCredentialsDB.getDecryptedValue as jest.Mock).mockRejectedValue(new Error('Redis connection lost'));

    const result = await registry.connect('app-2b', {
      host: 'example.com',
      port: 22,
      ownerId: 'user-1',
      credentialId: 'cred-1',
    });

    expect(result).toEqual({ success: false, error: 'credential_unavailable' });
    expect(registry.getConnection('app-2b')).toBeUndefined();
  });

  it('returns unreachable when the SSH connection itself errors before ready with no distinguishing level', async () => {
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

  it("returns auth_failed when the ssh2 error carries level: 'client-authentication'", async () => {
    const connectPromise = registry.connect('app-3b', {
      host: 'example.com',
      port: 22,
      ownerId: 'user-1',
      newCredential: { name: 'x', value: { type: 'sshPrivateKey', username: 'u', privateKey: 'key' } },
    });
    const client = fakeClients[0];
    client.emit('error', Object.assign(new Error('All configured authentication methods failed'), { level: 'client-authentication' }));

    const result = await connectPromise;
    expect(result).toEqual({ success: false, error: 'auth_failed' });
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

  it('reconnecting after retries are exhausted passes through whatever ownerId parameter connect() is given, consistently across calls', async () => {
    // This is a correctness/passthrough test, not a security-boundary test:
    // it proves connect() forwards its `ownerId` parameter to
    // SBCredentialsDB.getDecryptedValue unchanged on repeated calls. It does
    // NOT prove anything about which identity a caller is allowed to supply —
    // this registry has no "stored" ownerId of its own and enforces nothing
    // about where that value comes from (see class doc comment). The actual
    // guarantee that a reconnect uses the app's persisted owner rather than a
    // triggering browser session's identity is enforced by the caller
    // (the WebSocket relay), not by this module.
    //
    // Updated for Finding 4 (automatic reconnect with a retry budget): a
    // stream close no longer removes the connection immediately — it now
    // stays registered (in a "retrying" state) until the retry budget is
    // exhausted. So this test drives the retry loop to exhaustion first,
    // then exercises the ownerId passthrough on the manual reconnect that
    // follows, same as before.
    jest.useFakeTimers({ doNotFake: ['performance'] });
    try {
      (SBCredentialsDB.getDecryptedValue as jest.Mock).mockResolvedValue({
        type: 'sshPrivateKey',
        username: 'u',
        privateKey: 'key',
      });
      await connectAndEmitReady('app-11', { host: 'h', port: 22, ownerId: 'owner-user', credentialId: 'cred-1' });

      // Simulate the remote stream closing unexpectedly (network blip), and
      // drive the automatic retry loop through every attempt failing until
      // the retry budget is exhausted and the connection is removed.
      fakeClients[0].lastStream!.emit('close');
      for (const backoffMs of [1000, 2000, 4000]) {
        jest.advanceTimersByTime(backoffMs);
        await flushMicrotasks();
        fakeClients[fakeClients.length - 1].emit('error', new Error('ECONNREFUSED'));
        await flushMicrotasks();
      }
      expect(registry.getConnection('app-11')).toBeUndefined();

      // A later reconnect call with the same ownerId parameter must pass it
      // through to SBCredentialsDB.getDecryptedValue unchanged.
      (SBCredentialsDB.getDecryptedValue as jest.Mock).mockClear();
      await connectAndEmitReady('app-11', { host: 'h', port: 22, ownerId: 'owner-user', credentialId: 'cred-1' });
      expect(SBCredentialsDB.getDecryptedValue).toHaveBeenCalledWith('cred-1', 'owner-user');
    } finally {
      jest.useRealTimers();
    }
  });

  it('dedups concurrent connect() calls for the same not-yet-connected appId into a single ssh2.Client', async () => {
    (SBCredentialsDB.getDecryptedValue as jest.Mock).mockResolvedValue({
      type: 'sshPrivateKey',
      username: 'u',
      privateKey: 'key',
    });

    const params = { host: 'h', port: 22, ownerId: 'user-1', credentialId: 'cred-1' };
    // Two viewers racing to connect the same brand-new appId — neither
    // await is resolved before the second call starts.
    const firstPromise = registry.connect('app-12', params);
    const secondPromise = registry.connect('app-12', params);

    // Only one FakeClient should have been constructed for this appId.
    expect(fakeClients.length).toBe(1);

    fakeClients[0].emit('ready');

    const [firstResult, secondResult] = await Promise.all([firstPromise, secondPromise]);
    expect(firstResult).toEqual({ success: true });
    expect(secondResult).toEqual({ success: true });
    expect(fakeClients.length).toBe(1);
    expect(registry.getConnection('app-12')).toBeDefined();
  });

  describe('automatic reconnect on an unexpected drop', () => {
    beforeEach(() => {
      // doNotFake: ['performance'] works around a @sinonjs/fake-timers
      // incompatibility with newer Node versions, where `performance` is a
      // non-configurable global and hijacking it throws
      // "Cannot assign to read only property 'performance'" /
      // "Can't install fake timers twice on the same global object." This
      // repo's tests don't otherwise use fake timers, so there's no
      // existing convention to match here.
      jest.useFakeTimers({ doNotFake: ['performance'] });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('broadcasts {connected: false} immediately, then retries and broadcasts {connected: true} on success', async () => {
      (SBCredentialsDB.getDecryptedValue as jest.Mock).mockResolvedValue({
        type: 'sshPrivateKey',
        username: 'u',
        privateKey: 'key',
      });

      const connectPromise = registry.connect('app-13', { host: 'h', port: 22, ownerId: 'user-1', credentialId: 'cred-1' });
      fakeClients[0].emit('ready');
      await connectPromise;

      const statuses: Array<{ connected: boolean; error?: string }> = [];
      registry.onStatus('app-13', (status) => statuses.push(status));

      // Simulate an unexpected drop (not a disconnect() call).
      fakeClients[0].lastStream!.emit('close');

      expect(statuses).toEqual([{ connected: false }]);
      expect(fakeClients.length).toBe(1); // no retry attempt yet — still waiting on backoff

      // Advance through the first backoff delay so the retry attempt fires.
      jest.advanceTimersByTime(1000);
      await flushMicrotasks();
      expect(fakeClients.length).toBe(2);

      fakeClients[1].emit('ready');
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(statuses).toEqual([{ connected: false }, { connected: true }]);
      expect(registry.getConnection('app-13')).toBeDefined();
    });

    it('gives up after exhausting the retry budget and broadcasts a final failure status', async () => {
      (SBCredentialsDB.getDecryptedValue as jest.Mock).mockResolvedValue({
        type: 'sshPrivateKey',
        username: 'u',
        privateKey: 'key',
      });

      const connectPromise = registry.connect('app-14', { host: 'h', port: 22, ownerId: 'user-1', credentialId: 'cred-1' });
      fakeClients[0].emit('ready');
      await connectPromise;

      const statuses: Array<{ connected: boolean; error?: string }> = [];
      registry.onStatus('app-14', (status) => statuses.push(status));

      fakeClients[0].lastStream!.emit('close');
      expect(statuses).toEqual([{ connected: false }]);

      // Attempt 1: fails after 1000ms backoff.
      jest.advanceTimersByTime(1000);
      await flushMicrotasks();
      expect(fakeClients.length).toBe(2);
      fakeClients[1].emit('error', new Error('ECONNREFUSED'));
      await Promise.resolve();
      await Promise.resolve();

      // Attempt 2: fails after 2000ms backoff.
      jest.advanceTimersByTime(2000);
      await flushMicrotasks();
      expect(fakeClients.length).toBe(3);
      fakeClients[2].emit('error', new Error('ECONNREFUSED'));
      await Promise.resolve();
      await Promise.resolve();

      // Attempt 3: fails after 4000ms backoff — retry budget now exhausted.
      jest.advanceTimersByTime(4000);
      await flushMicrotasks();
      expect(fakeClients.length).toBe(4);
      fakeClients[3].emit('error', new Error('ECONNREFUSED'));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(statuses).toEqual([{ connected: false }, { connected: false, error: 'unreachable' }]);
      expect(registry.getConnection('app-14')).toBeUndefined();
    });

    it('does not retry after a deliberate disconnect()', async () => {
      (SBCredentialsDB.getDecryptedValue as jest.Mock).mockResolvedValue({
        type: 'sshPrivateKey',
        username: 'u',
        privateKey: 'key',
      });

      const connectPromise = registry.connect('app-15', { host: 'h', port: 22, ownerId: 'user-1', credentialId: 'cred-1' });
      fakeClients[0].emit('ready');
      await connectPromise;

      expect(fakeClients.length).toBe(1);
      const stream = fakeClients[0].lastStream!;

      registry.disconnect('app-15');
      expect(registry.getConnection('app-15')).toBeUndefined();

      // In real ssh2, ending the client eventually causes its stream to
      // emit 'close' too — simulate that here to exercise the
      // deliberatelyClosed guard in wireStream's own 'close' handler
      // (rather than trivially passing just because FakeClient.end()
      // happens not to touch the stream).
      stream.emit('close');

      // Advance well past every possible backoff delay — no retry should
      // ever fire because the deliberate-close path skips the retry loop.
      jest.advanceTimersByTime(10000);
      await flushMicrotasks();

      expect(fakeClients.length).toBe(1);
      expect(registry.getConnection('app-15')).toBeUndefined();
    });
  });
});
