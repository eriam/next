/**
 * Copyright (c) SAGE3 Development Team
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 *
 */

/**
 * SAGE3 application: VideoViewer
 * created by: SAGE3 Team
 */

import { z } from 'zod';

export const schema = z.object({
  play: z.boolean(),
  currentTime: z.number(),
  vid: z.string()
});
export type state = z.infer<typeof schema>;

export const init: state = {
  play: false,
  currentTime: 0,
  vid: ''
};

export const name = 'VideoViewer';
