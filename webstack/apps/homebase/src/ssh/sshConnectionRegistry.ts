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

  public connect(appId: string, params: ConnectParams): Promise<ConnectResult> {
    // Create the client synchronously so tests can access it immediately
    const client = new Client();

    // Set up the promise and event handlers synchronously, so they're ready
    // before the test emits 'ready' or 'error' events
    let resolveConnect: ((result: ConnectResult) => void) | undefined;
    let rejectConnect: ((error: Error) => void) | undefined;
    const connectPromise = new Promise<ConnectResult>((resolve, reject) => {
      resolveConnect = resolve;
      rejectConnect = reject;
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

    client.on('error', () => {
      const result = { success: false, error: 'unreachable' as const };
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
        if (error instanceof CredentialDecryptionError) {
          tryResolve({ success: false, error: 'credential_unavailable' });
          return;
        }
        throw error;
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
      await SBCredentialsDB.createOrUpdate(params.ownerId, 'sshPrivateKey', params.newCredential.name, params.newCredential.value);
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
