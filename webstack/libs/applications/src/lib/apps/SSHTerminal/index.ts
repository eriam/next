/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { z } from 'zod';

export const schema = z.object({
  host: z.string(),
  port: z.number(),
  credentialId: z.string(),
  ownerId: z.string(),
  controllerId: z.string().optional(),
  connected: z.boolean(),
  executeInfo: z.object({
    executeFunc: z.string(),
    params: z.any(),
  }),
});
export type state = z.infer<typeof schema>;

export const init: Partial<state> = {
  host: '',
  port: 22,
  credentialId: '',
  ownerId: '',
  connected: false,
  executeInfo: { executeFunc: '', params: {} },
};

export const name = 'SSHTerminal';
