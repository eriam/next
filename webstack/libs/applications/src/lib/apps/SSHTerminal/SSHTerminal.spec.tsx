/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';

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
