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
  // apps/homebase's global middleware only applies express.urlencoded(),
  // not express.json() (see apps/homebase/src/web/http-server.ts:74) — these
  // routes need a real JSON body, so parse it locally rather than changing
  // global behavior other routes might depend on.
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
