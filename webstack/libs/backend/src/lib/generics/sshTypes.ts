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

export type ConnectResult =
  | { success: true; credentialId: string }
  | { success: false; error: 'auth_failed' | 'unreachable' | 'tmux_failed' | 'credential_unavailable' };
