/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Terminal } from '@xterm/xterm';

const capturedTerminalInstances: any[] = [];

jest.mock('@xterm/xterm', () => ({
  Terminal: jest.fn().mockImplementation(() => {
    const instance = {
      loadAddon: jest.fn(),
      open: jest.fn(),
      write: jest.fn(),
      onData: jest.fn(() => ({ dispose: jest.fn() })),
      dispose: jest.fn(),
      cols: 80,
      rows: 24,
    };
    capturedTerminalInstances.push(instance);
    return instance;
  }),
}));

jest.mock('@xterm/addon-fit', () => ({
  FitAddon: jest.fn().mockImplementation(() => ({
    fit: jest.fn(),
  })),
}));

// Mock ResizeObserver which is not available in jsdom
global.ResizeObserver = jest.fn().mockImplementation(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn(),
}));

const mockUpdateState = jest.fn();
const mockUseCredentials = jest.fn();

const mockUIState = {
  scale: 1,
  zIndex: 0,
  boardDragging: false,
  appDragging: false,
  setAppDragging: jest.fn(),
  incZ: jest.fn(),
  viewport: { position: { x: 0, y: 0 }, size: { width: 1000, height: 1000 } },
  selectedTag: null,
  deltaLocalMove: {},
  setDeltaLocalMove: jest.fn(),
  setSelectedApp: jest.fn(),
  clearSelectedApps: jest.fn(),
  addSelectedApp: jest.fn(),
  removeSelectedApp: jest.fn(),
  selectedAppId: null,
  selectedAppsIds: [],
  lassoMode: false,
  focusedAppId: null,
  subscribe: jest.fn(),
};
const mockUseUIStore = jest.fn((selector: any) => {
  return selector ? selector(mockUIState) : mockUIState;
}) as any;
mockUseUIStore.getState = () => mockUIState;
mockUseUIStore.subscribe = jest.fn();

jest.mock(
  '@sage3/frontend',
  () => ({
    useAppStore: (selector: any) => selector({ updateState: mockUpdateState, bringForward: jest.fn() }),
    useCredentials: mockUseCredentials,
    useUser: jest.fn(() => ({ user: { _id: 'app-1-current-user' } })),
    useUserSettings: () => ({ settings: { uiVisible: true }, toggleShowUI: jest.fn() }),
    useAbility: () => true,
    useUIStore: mockUseUIStore,
    useInsightStore: (selector?: any) => {
      const state = { showInsight: false, insights: [] };
      return selector ? selector(state) : state;
    },
    useHexColor: () => '#fff',
    useCursorBoardPosition: () => ({ x: 0, y: 0 }),
  }),
  { virtual: true }
);

import SSHTerminal from './SSHTerminal';

function buildApp(stateOverrides: Partial<{ host: string; port: number; credentialId: string; ownerId: string; controllerId: string; connected: boolean }> = {}) {
  return {
    _id: 'app-1',
    _createdAt: 0,
    _updatedAt: 0,
    _updatedBy: 'user-1',
    _createdBy: 'user-1',
    data: {
      title: 'SSH Terminal',
      roomId: 'room-1',
      boardId: 'board-1',
      position: { x: 0, y: 0, z: 0 },
      size: { width: 400, height: 300, depth: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      type: 'SSHTerminal',
      state: { host: '', port: 22, credentialId: '', ownerId: '', connected: false, ...stateOverrides },
      raised: false,
      dragging: false,
      pinned: false,
    },
  } as any;
}

describe('SSHTerminal setup form', () => {
  beforeEach(() => {
    mockUseCredentials.mockReturnValue({
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
    capturedTerminalInstances.length = 0;
    (global as any).WebSocket = MockWebSocket;
  });

  it('opens a WebSocket to /ssh with the appId once connected', () => {
    render(<SSHTerminal.AppComponent {...buildApp({ host: 'example.com', port: 22, credentialId: 'cred-1', connected: true })} />);
    expect(wsInstances).toHaveLength(1);
    expect(wsInstances[0].url).toContain('/ssh?appId=app-1');
  });

  it('sends an input message when the current controller types', () => {
    render(
      <SSHTerminal.AppComponent {...buildApp({ host: 'h', port: 22, credentialId: 'c', connected: true, controllerId: 'app-1-current-user' })} />
    );
    const terminalInstance = capturedTerminalInstances[0];
    const onDataCallback = terminalInstance.onData.mock.calls[0][0];
    onDataCallback('ls\n');

    const inputMessages = sentMessages.filter((m) => JSON.parse(m).type === 'input');
    expect(inputMessages).toEqual([JSON.stringify({ type: 'input', data: 'ls\n' })]);
  });

  it('does not send an input message when a non-controller "types"', () => {
    render(
      <SSHTerminal.AppComponent {...buildApp({ host: 'h', port: 22, credentialId: 'c', connected: true, controllerId: 'someone-else' })} />
    );
    const terminalInstance = capturedTerminalInstances[0];
    const onDataCallback = terminalInstance.onData.mock.calls[0][0];
    onDataCallback('rm -rf /\n');

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
