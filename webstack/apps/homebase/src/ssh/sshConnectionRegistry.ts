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
 */

import { Client } from 'ssh2';
import { SBCredentialsDB } from '@sage3/sagebase';
import { ConnectParams, ConnectResult } from '@sage3/backend';

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

  public connect(appId: string, params: ConnectParams): Promise<ConnectResult> {
    // Create the client synchronously so tests can access it immediately
    const client = new Client();

    // Set up the promise and event handlers synchronously, so they're ready
    // before the test emits 'ready' or 'error' events.
    // connect()'s contract is to always resolve, never reject/hang, so there
    // is no reject function here.
    let resolveConnect: ((result: ConnectResult) => void) | undefined;
    const connectPromise = new Promise<ConnectResult>((resolve) => {
      resolveConnect = resolve;
    });

    let hasResolved = false;
    const tryResolve = (result: ConnectResult) => {
      if (!hasResolved) {
        hasResolved = true;
        resolveConnect!(result);
      }
    };

    let resultForPersist: ConnectResult | undefined;

    client.on('ready', () => {
      client.exec(`tmux new -A -s ${tmuxSessionName(appId)}`, { pty: true }, (execErr, stream) => {
        if (execErr || !stream) {
          client.end();
          const result = { success: false, error: 'tmux_failed' as const };
          resultForPersist = result;
          tryResolve(result);
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

        const result = { success: true as const };
        resultForPersist = result;
        tryResolve(result);
      });
    });

    client.on('error', (err: Error & { level?: string }) => {
      const error = err.level === 'client-authentication' ? ('auth_failed' as const) : ('unreachable' as const);
      const result = { success: false, error };
      resultForPersist = result;
      tryResolve(result);
    });

    // Handle async credential fetching and client connection
    this.performConnect(appId, params, client, tryResolve, connectPromise);

    return connectPromise;
  }

  private async performConnect(
    appId: string,
    params: ConnectParams,
    client: Client,
    tryResolve: (result: ConnectResult) => void,
    connectPromise: Promise<ConnectResult>
  ): Promise<void> {
    let username: string;
    let privateKey: string;
    let passphrase: string | undefined;

    if (params.credentialId) {
      let value;
      try {
        value = await SBCredentialsDB.getDecryptedValue(params.credentialId, params.ownerId);
      } catch (error) {
        // Any failure resolving the credential — a CredentialDecryptionError,
        // a Redis error from SBCredentialsDB, or anything else thrown from
        // this credential-fetching code — is reported as credential_unavailable.
        // connect()'s contract is to always resolve, never hang or reject, so
        // this must not rethrow.
        tryResolve({ success: false, error: 'credential_unavailable' });
        return;
      }
      if (!value || value.type !== 'sshPrivateKey') {
        tryResolve({ success: false, error: 'credential_unavailable' });
        return;
      }
      username = value.username;
      privateKey = value.privateKey;
      passphrase = value.passphrase;
    } else if (params.newCredential) {
      username = params.newCredential.value.username;
      privateKey = params.newCredential.value.privateKey;
      passphrase = params.newCredential.value.passphrase;
    } else {
      tryResolve({ success: false, error: 'credential_unavailable' });
      return;
    }

    client.connect({
      host: params.host,
      port: params.port,
      username,
      privateKey,
      passphrase,
    });

    // Wait for the connection to resolve
    const connectResult = await connectPromise;

    if (connectResult.success && params.newCredential && !params.credentialId) {
      try {
        await SBCredentialsDB.createOrUpdate(params.ownerId, 'sshPrivateKey', params.newCredential.name, params.newCredential.value);
      } catch (error) {
        // The SSH/tmux connection itself already succeeded — don't change the
        // result we already resolved with just because persisting the
        // credential for next time failed. Log and move on so this doesn't
        // become an unhandled promise rejection.
        console.error(`Failed to persist newCredential for app ${appId}:`, error);
      }
    }
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
