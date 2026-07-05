/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 *
 * First-party integration handler: the only code path anywhere that calls
 * SBCredentialsDB.getDecryptedValue() to actually use a stored credential.
 * The request always goes to ${ctfd_url}/api/sage/register — a value the
 * caller already knows (it's the same CTFd instance they're registering
 * with), not an arbitrary plugin-declared endpoint.
 */

import * as express from 'express';
import { SBCredentialsDB, SBAuthSchema } from '@sage3/sagebase';

export function CtfdIntegrationRouter(): express.Router {
  const router = express.Router();
  // apps/homebase's global middleware already includes express.json()
  // (apps/homebase/src/web/http-server.ts:73), so this is redundant in
  // production — kept anyway so this router stays self-sufficient and
  // testable in isolation (matching CredentialsRouter's own router-level
  // parsing) without depending on the global setup never changing.
  router.use(express.json());

  router.post('/register', async (req, res) => {
    const user = req.user as SBAuthSchema;
    const { app_id, ctfd_url, credentialId, newCredential } = req.body;

    let secret: string;
    if (credentialId) {
      const value = await SBCredentialsDB.getDecryptedValue(credentialId, user.id);
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
      await SBCredentialsDB.createOrUpdate(user.id, 'secretText', newCredential.name, newCredential.value);
    }

    res.status(200).json({ success: true });
  });

  return router;
}
