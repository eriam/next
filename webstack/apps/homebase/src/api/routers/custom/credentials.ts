/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import * as express from 'express';
import { SBCredentialsDB, SBAuthSchema, CredentialType } from '@sage3/sagebase';

export function CredentialsRouter(): express.Router {
  const router = express.Router();
  // apps/homebase's global middleware already includes express.json()
  // (apps/homebase/src/web/http-server.ts:73), so this is redundant in
  // production — kept anyway so this router stays self-sufficient and
  // testable in isolation without depending on the global setup never
  // changing.
  router.use(express.json());

  router.post('/', async (req, res) => {
    const user = req.user as SBAuthSchema;
    const { name, type, value } = req.body;
    const result = await SBCredentialsDB.createOrUpdate(user.id, type, name, value);
    res.status(200).json(result);
  });

  router.get('/', async (req, res) => {
    const user = req.user as SBAuthSchema;
    const type = req.query.type as CredentialType | undefined;
    const result = await SBCredentialsDB.list(user.id, type);
    res.status(200).json(result);
  });

  router.put('/:id', async (req, res) => {
    const user = req.user as SBAuthSchema;
    const result = await SBCredentialsDB.updateValue(req.params.id, user.id, req.body.value);
    if (!result) {
      res.status(404).json({ error: 'Credential not found' });
      return;
    }
    res.status(200).json(result);
  });

  router.delete('/:id', async (req, res) => {
    const user = req.user as SBAuthSchema;
    const deleted = await SBCredentialsDB.delete(req.params.id, user.id);
    if (!deleted) {
      res.status(404).json({ error: 'Credential not found' });
      return;
    }
    res.status(200).json({ success: true });
  });

  return router;
}
