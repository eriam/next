/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 *
 * Test-only helper: the real route logic (apps/homebase/src/api/routers/
 * custom/credentials.ts) is written against the module-level SBCredentialsDB
 * singleton, which the real server always uses. This helper builds an
 * identical router against an explicitly-injected SBCredentialsDatabase
 * instance, so this integration test can point it at a fresh, isolated
 * Redis prefix per test run without touching the singleton.
 */

import * as express from 'express';
import { SBCredentialsDatabase, SBAuthSchema, CredentialType } from '@sage3/sagebase';

export function CredentialsRouter(db: SBCredentialsDatabase): express.Router {
  const router = express.Router();
  router.use(express.json());

  router.post('/', async (req, res) => {
    const user = req.user as SBAuthSchema;
    const { name, type, value } = req.body;
    const result = await db.createOrUpdate(user.id, type, name, value);
    res.status(200).json(result);
  });

  router.get('/', async (req, res) => {
    const user = req.user as SBAuthSchema;
    const type = req.query.type as CredentialType | undefined;
    const result = await db.list(user.id, type);
    res.status(200).json(result);
  });

  router.put('/:id', async (req, res) => {
    const user = req.user as SBAuthSchema;
    const result = await db.updateValue(req.params.id, user.id, req.body.value);
    if (!result) {
      res.status(404).json({ error: 'Credential not found' });
      return;
    }
    res.status(200).json(result);
  });

  router.delete('/:id', async (req, res) => {
    const user = req.user as SBAuthSchema;
    const deleted = await db.delete(req.params.id, user.id);
    if (!deleted) {
      res.status(404).json({ error: 'Credential not found' });
      return;
    }
    res.status(200).json({ success: true });
  });

  return router;
}
