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
 * terminal, not one connection per browser tab.
 *
 * This registry takes `ownerId` as an explicit parameter on every `connect()`
 * call and trusts the caller to supply the right one — it has no notion of a
 * "stored" or persistent owner of its own, and does not enforce anything
 * about where that value came from. The guarantee that a (re)connect always
 * uses the app's persisted owner — never the identity of whichever browser
 * session happens to trigger the reconnect — is enforced by the CALLER
 * (the WebSocket relay, which reads `ownerId` from the app's Redis-backed
 * state document rather than from the triggering request's session).
 *
 * On an unexpected drop (not a deliberate disconnect() call), this registry
 * automatically retries the connection a few times with backoff before
 * giving up, broadcasting a `status` update at each step — this is the
 * "reconnect using the same stored owner/credential" behavior the design
 * spec describes, distinct from the relay's own lazy "next viewer triggers
 * a fresh connect" behavior (which only matters once no connection is
 * registered at all, i.e. after these retries are exhausted).
 */

import { Client } from 'ssh2';
import { SBCredentialsDB } from '@sage3/sagebase';
import { ConnectParams, ConnectResult } from '@sage3/backend';

export type ConnectionStatus = { connected: boolean; error?: string };

const RECONNECT_MAX_ATTEMPTS = 3;
const RECONNECT_BASE_DELAY_MS = 1000;

type ResolvedCredential = { username: string; privateKey: string; passphrase?: string };

type SSHConnection = {
  client: Client;
  stream: NodeJS.ReadWriteStream & {
    setWindow: (rows: number, cols: number, height?: number, width?: number) => void;
    stderr?: NodeJS.ReadableStream;
  };
  outputListeners: Set<(data: string) => void>;
  statusListeners: Set<(status: ConnectionStatus) => void>;
  // Kept so an unexpected drop can be retried without re-decrypting or
  // re-fetching the credential — this key is already resident in process
  // memory for as long as the connection itself is open, so holding onto
  // it here for the retry window doesn't change the security posture.
  credential: ResolvedCredential;
  host: string;
  port: number;
  // Set by disconnect() before ending the client, so the stream's own
  // 'close' handler can tell a deliberate disconnect from an unexpected
  // drop and skip the retry loop for the former.
  deliberatelyClosed: boolean;
};

function tmuxSessionName(appId: string): string {
  return `sage3-${appId}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type AttemptResult =
  | { success: true; client: Client; stream: SSHConnection['stream'] }
  | { success: false; error: 'auth_failed' | 'unreachable' | 'tmux_failed' };

// Constructs the ssh2.Client and wires its 'ready'/'error'/exec handlers
// synchronously, WITHOUT calling client.connect() yet. Split out from
// attemptSSHConnection() below so the initial connect flow (doConnect) can
// create the client and register its listeners synchronously, before
// awaiting the (possibly async, e.g. Redis-backed) credential lookup — the
// same ordering the original implementation used, and one this module's
// tests rely on (they emit 'ready'/'error' on the client synchronously
// right after calling connect(), so the client and its listeners must
// already exist by then).
function createPendingAttempt(appId: string): { client: Client; promise: Promise<AttemptResult> } {
  const client = new Client();
  let hasResolved = false;
  let resolveAttempt!: (result: AttemptResult) => void;
  const promise = new Promise<AttemptResult>((resolve) => {
    resolveAttempt = resolve;
  });
  const tryResolve = (result: AttemptResult) => {
    if (!hasResolved) {
      hasResolved = true;
      resolveAttempt(result);
    }
  };

  client.on('ready', () => {
    client.exec(`tmux new -A -s ${tmuxSessionName(appId)}`, { pty: true }, (execErr, stream) => {
      if (execErr || !stream) {
        client.end();
        tryResolve({ success: false, error: 'tmux_failed' });
        return;
      }
      tryResolve({ success: true, client, stream: stream as unknown as SSHConnection['stream'] });
    });
  });

  client.on('error', (err: Error & { level?: string }) => {
    const error = err.level === 'client-authentication' ? ('auth_failed' as const) : ('unreachable' as const);
    tryResolve({ success: false, error });
  });

  return { client, promise };
}

function beginConnect(client: Client, host: string, port: number, credential: ResolvedCredential): void {
  client.connect({ host, port, username: credential.username, privateKey: credential.privateKey, passphrase: credential.passphrase });
}

// One full raw SSH+tmux connection attempt, credential already resolved —
// no registry bookkeeping. Used by the retry loop on an unexpected drop,
// where the credential is already cached on the connection and there's no
// async lookup to interleave with client creation.
function attemptSSHConnection(appId: string, host: string, port: number, credential: ResolvedCredential): Promise<AttemptResult> {
  const { client, promise } = createPendingAttempt(appId);
  beginConnect(client, host, port, credential);
  return promise;
}

export class SSHConnectionRegistry {
  private connections = new Map<string, SSHConnection>();
  // Deduplicates concurrent connect() calls for the same appId that have
  // no existing connection yet — without this, two viewers opening the
  // same brand-new app instance at once would each start their own
  // ssh2.Client, and the second to finish silently overwrites the first
  // in `connections`, orphaning (and never disconnecting) the first.
  private inFlightConnects = new Map<string, Promise<ConnectResult>>();

  public getConnection(appId: string): SSHConnection | undefined {
    return this.connections.get(appId);
  }

  public connect(appId: string, params: ConnectParams): Promise<ConnectResult> {
    const existing = this.inFlightConnects.get(appId);
    if (existing) return existing;

    const promise = this.doConnect(appId, params);
    this.inFlightConnects.set(appId, promise);
    promise.finally(() => {
      if (this.inFlightConnects.get(appId) === promise) {
        this.inFlightConnects.delete(appId);
      }
    });
    return promise;
  }

  private async doConnect(appId: string, params: ConnectParams): Promise<ConnectResult> {
    // Create the client and wire its listeners synchronously — before the
    // (possibly async) credential lookup below — so they're already in
    // place the instant a real ssh2.Client would start emitting events.
    const { client, promise } = createPendingAttempt(appId);

    let credential: ResolvedCredential;

    if (params.credentialId) {
      let value;
      try {
        value = await SBCredentialsDB.getDecryptedValue(params.credentialId, params.ownerId);
      } catch (error) {
        return { success: false, error: 'credential_unavailable' };
      }
      if (!value || value.type !== 'sshPrivateKey') {
        return { success: false, error: 'credential_unavailable' };
      }
      credential = { username: value.username, privateKey: value.privateKey, passphrase: value.passphrase };
    } else if (params.newCredential) {
      credential = {
        username: params.newCredential.value.username,
        privateKey: params.newCredential.value.privateKey,
        passphrase: params.newCredential.value.passphrase,
      };
    } else {
      return { success: false, error: 'credential_unavailable' };
    }

    beginConnect(client, params.host, params.port, credential);
    const attempt = await promise;
    if (!attempt.success) {
      return attempt;
    }

    const connection: SSHConnection = {
      client: attempt.client,
      stream: attempt.stream,
      outputListeners: new Set(),
      statusListeners: new Set(),
      credential,
      host: params.host,
      port: params.port,
      deliberatelyClosed: false,
    };
    this.connections.set(appId, connection);
    this.wireStream(appId, connection);

    if (params.newCredential && !params.credentialId) {
      try {
        await SBCredentialsDB.createOrUpdate(params.ownerId, 'sshPrivateKey', params.newCredential.name, params.newCredential.value);
      } catch (error) {
        console.error(`Failed to persist newCredential for app ${appId}:`, error);
      }
    }

    return { success: true };
  }

  // Attaches data/stderr/close handlers to a connection's current stream.
  // Called on the initial connect and again after each successful retry
  // (which replaces connection.stream with a fresh one).
  private wireStream(appId: string, connection: SSHConnection): void {
    const { stream } = connection;
    stream.on('data', (data: Buffer) => {
      connection.outputListeners.forEach((listener) => listener(data.toString('utf8')));
    });
    stream.stderr?.on('data', (data: Buffer) => {
      connection.outputListeners.forEach((listener) => listener(data.toString('utf8')));
    });
    stream.on('close', () => {
      if (connection.deliberatelyClosed) return; // disconnect() already cleaned up
      connection.statusListeners.forEach((listener) => listener({ connected: false }));
      this.retryConnection(appId, connection);
    });
  }

  private async retryConnection(appId: string, connection: SSHConnection): Promise<void> {
    for (let attemptNumber = 1; attemptNumber <= RECONNECT_MAX_ATTEMPTS; attemptNumber++) {
      await delay(RECONNECT_BASE_DELAY_MS * 2 ** (attemptNumber - 1));

      // If disconnect() or a fresh connect() elsewhere replaced/removed
      // this connection while we were waiting, stop — we're retrying a
      // connection that's no longer the active one for this appId.
      if (this.connections.get(appId) !== connection) return;

      const attempt = await attemptSSHConnection(appId, connection.host, connection.port, connection.credential);
      if (this.connections.get(appId) !== connection) return;

      if (attempt.success) {
        connection.client = attempt.client;
        connection.stream = attempt.stream;
        this.wireStream(appId, connection);
        connection.statusListeners.forEach((listener) => listener({ connected: true }));
        return;
      }
    }

    // Retry budget exhausted — give up, remove the connection, and let the
    // relay's own lazy "next viewer triggers a fresh connect" behavior take
    // over from here.
    if (this.connections.get(appId) === connection) {
      connection.statusListeners.forEach((listener) => listener({ connected: false, error: 'unreachable' }));
      this.connections.delete(appId);
    }
  }

  public disconnect(appId: string): void {
    const connection = this.connections.get(appId);
    if (!connection) return;
    connection.deliberatelyClosed = true;
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
