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
