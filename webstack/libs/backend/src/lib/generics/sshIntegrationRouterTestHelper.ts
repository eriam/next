/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 *
 * Test-only helper — same reasoning as credentialsRouterTestHelper.ts and
 * ctfdIntegrationRouterTestHelper.ts: the real production router
 * (apps/homebase/src/api/routers/custom/integrations/ssh.ts) is written
 * against the module-level sshConnectionRegistry singleton; this helper
 * takes an injectable connect() function so the test can control its
 * result without touching the real registry or a real ssh2.Client.
 */

import * as express from 'express';
import { SBAuthSchema } from '@sage3/sagebase';
import { ConnectParams, ConnectResult } from '@sage3/backend';

export function SSHIntegrationRouterTestHelper(connect: (appId: string, params: ConnectParams) => Promise<ConnectResult>): express.Router {
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

    const result = await connect(appId, { host, port, ownerId: user.id, credentialId, newCredential });

    if (!result.success) {
      const status = result.error === 'auth_failed' ? 401 : result.error === 'credential_unavailable' ? 500 : 502;
      res.status(status).json({ error: result.error });
      return;
    }

    res.status(200).json({ success: true });
  });

  return router;
}
