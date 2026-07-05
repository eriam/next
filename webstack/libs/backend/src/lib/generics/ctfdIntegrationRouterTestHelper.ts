/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 *
 * Test-only helper — see credentialsRouterTestHelper.ts's header comment
 * for why this exists (injectable db instance vs. the real module-level
 * singleton the production router in apps/homebase always uses).
 */

import * as express from 'express';
import { SBCredentialsDatabase, SBAuthSchema } from '@sage3/sagebase';

export function CtfdIntegrationRouterTestHelper(db: SBCredentialsDatabase): express.Router {
  const router = express.Router();
  router.use(express.json());

  router.post('/register', async (req, res) => {
    const user = req.user as SBAuthSchema;
    const { app_id, ctfd_url, credentialId, newCredential } = req.body;

    let secret: string;
    if (credentialId) {
      const value = await db.getDecryptedValue(credentialId, user.id);
      if (!value || value.type !== 'secretText') {
        res.status(404).json({ error: 'Credential not found' });
        return;
      }
      secret = value.secret;
    } else {
      secret = newCredential.value.secret;
    }

    let ctfdResponse: Response;
    try {
      ctfdResponse = await fetch(`${ctfd_url}/api/sage/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id, token: secret }),
      });
    } catch {
      res.status(502).json({ error: 'ctfd_unreachable' });
      return;
    }

    if (!ctfdResponse.ok) {
      res.status(ctfdResponse.status === 401 ? 401 : 502).json({ error: 'invalid_token' });
      return;
    }

    if (!credentialId && newCredential) {
      await db.createOrUpdate(user.id, 'secretText', newCredential.name, newCredential.value);
    }

    res.status(200).json({ success: true });
  });

  return router;
}
