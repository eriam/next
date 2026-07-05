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
  public closed = false;
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
  }
}

class FakeWSServer extends EventEmitter {}

// Flushes several microtask turns — used where a test needs the connection
// handler's execution to proceed PAST the `await registry.connect(...)`
// line (not just past `await getAppState(...)`, which is all the simpler
// existing tests below need two `await Promise.resolve()` for).
async function flushMicrotasks(times = 8) {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

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
    jest.spyOn(registry, 'disconnect').mockImplementation(() => undefined);
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

  it('reports a failed connect via a status message and does not poison the appId subscription for a later successful viewer', async () => {
    (registry.getConnection as jest.Mock).mockReturnValue(undefined);
    (registry.connect as jest.Mock).mockResolvedValueOnce({ success: false, error: 'unreachable' });

    const wsServer = new FakeWSServer();
    attachSSHWebSocketServer(wsServer as any, registry, asyncAppState());

    const viewerA = connectClient(wsServer, 'app-6', 'user-a');
    await flushMicrotasks();

    expect(JSON.parse(viewerA.sent[viewerA.sent.length - 1])).toEqual({
      type: 'status',
      connected: false,
      error: 'unreachable',
    });
    // A failed connect must not leave a bogus entry in the relay's internal
    // unsubscribeByApp map — otherwise a later successful viewer for the
    // same appId would silently ride along on a subscription that was
    // never actually made against a real connection.
    expect(registry.onOutput).not.toHaveBeenCalled();
    expect(registry.onStatus).not.toHaveBeenCalled();

    // Now a second viewer connects, and this time the connect succeeds.
    (registry.connect as jest.Mock).mockResolvedValueOnce({ success: true });
    (registry.getConnection as jest.Mock).mockReturnValue(undefined);

    const viewerB = connectClient(wsServer, 'app-6', 'user-b');
    await flushMicrotasks();

    expect(registry.onOutput).toHaveBeenCalledWith('app-6', expect.any(Function));
    expect(registry.onStatus).toHaveBeenCalledWith('app-6', expect.any(Function));
  });

  it('calls registry.disconnect(appId) when the last viewer for an appId disconnects', async () => {
    const wsServer = new FakeWSServer();
    attachSSHWebSocketServer(wsServer as any, registry, asyncAppState());

    const socket = connectClient(wsServer, 'app-7', 'user-a');
    await Promise.resolve();
    await Promise.resolve();

    socket.emit('close');

    expect(registry.disconnect).toHaveBeenCalledWith('app-7');
  });
});
