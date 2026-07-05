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
  // Every viewer of the same appId shares a single SSH connection and must
  // all receive the same output/status broadcast. Track the connected
  // sockets per appId here (module-level to this attach() call) rather than
  // subscribing to registry.onOutput/onStatus once per socket — that would
  // register a separate listener closed over just that one socket, so a
  // second viewer's output would never reach the first viewer's socket.
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

    // Only the first viewer of an appId subscribes to the registry — every
    // subsequent viewer just gets added to the `viewers` Set above and rides
    // along on that single subscription's broadcast.
    if (!unsubscribeByApp.has(appId)) {
      const unsubscribeOutput = registry.onOutput(appId, (data) => {
        viewersByApp.get(appId)?.forEach((viewerSocket) => send(viewerSocket, { type: 'output', data }));
      });
      const unsubscribeStatus = registry.onStatus(appId, (status) => {
        viewersByApp
          .get(appId)
          ?.forEach((viewerSocket) => send(viewerSocket, { type: 'status', connected: status.connected, error: status.error }));
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
      viewers?.delete(socket);
      if (viewers && viewers.size === 0) {
        viewersByApp.delete(appId);
        unsubscribeByApp.get(appId)?.();
        unsubscribeByApp.delete(appId);
      }
    });
  });
}
