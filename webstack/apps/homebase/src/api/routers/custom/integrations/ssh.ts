/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 *
 * First-party integration handler. Unlike the ctfd handler, this call
 * doesn't just validate a credential — it *is* the actual connection
 * setup. On success, the resulting live connection is registered in
 * sshConnectionRegistry under appId; the frontend's own updateState()
 * call (not this handler) is what other viewers then see.
 */

import * as express from 'express';
import { SBAuthSchema } from '@sage3/sagebase';
import { sshConnectionRegistry } from '../../../../ssh/sshConnectionRegistry';

export function SSHIntegrationRouter(): express.Router {
  const router = express.Router();
  router.use(express.json());

  router.post('/connect', async (req, res) => {
    const user = req.user as SBAuthSchema;
    const { appId, host, port, credentialId, newCredential } = req.body;

    if (!appId || !host || !port || (!credentialId && !newCredential)) {
      res.status(400).json({ error: 'appId, host, port, and either credentialId or newCredential are required' });
      return;
    }
    if (newCredential && (!newCredential.name || !newCredential.value?.username || !newCredential.value?.privateKey)) {
      res.status(400).json({ error: 'newCredential.name, newCredential.value.username, and newCredential.value.privateKey are required' });
      return;
    }

    const result = await sshConnectionRegistry.connect(appId, { host, port, ownerId: user.id, credentialId, newCredential });

    if (!result.success) {
      const status = result.error === 'auth_failed' ? 401 : result.error === 'credential_unavailable' ? 500 : 502;
      res.status(status).json({ error: result.error });
      return;
    }

    res.status(200).json({ success: true });
  });

  return router;
}
