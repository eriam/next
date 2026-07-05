/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 *
 * Real Express + real Redis integration test for the ctfd first-party
 * integration handler. Mocks only the true external boundary — the
 * outbound fetch() to the (fake) CTFd server — everything else (Express,
 * Redis, encryption) is real, matching this session's established
 * "integration test" bar.
 */

import * as express from 'express';
import * as request from 'supertest';
import { createClient } from 'redis';
import { SBCredentialsDatabase } from '@sage3/sagebase';
import { CtfdIntegrationRouterTestHelper } from './ctfdIntegrationRouterTestHelper';

const REDIS_URL = process.env.REDIS_TEST_URL;
const describeIfRedis = REDIS_URL ? describe : describe.skip;

function buildApp(userId: string, db: SBCredentialsDatabase) {
  const app = express();
  // Deliberately no global express.json() on this test app — even though
  // the real apps/homebase app does have one globally
  // (apps/homebase/src/web/http-server.ts:73), this test intentionally
  // doesn't rely on it, so it only passes if the router provides its own
  // parsing (a stricter check than production actually needs, kept so
  // this router stays self-sufficient/testable in isolation).
  app.use((req, _res, next) => {
    (req as express.Request & { user: { id: string } }).user = { id: userId };
    next();
  });
  app.use('/api/integrations/ctfd', CtfdIntegrationRouterTestHelper(db));
  return app;
}

describeIfRedis('ctfd integration handler — real Express + real Redis, mocked external CTFd', () => {
  let db: SBCredentialsDatabase;
  let redisClient: ReturnType<typeof createClient>;

  beforeAll(async () => {
    redisClient = createClient({ url: REDIS_URL });
    await redisClient.connect();
    db = new SBCredentialsDatabase();
    await db.init(redisClient as any, `ctfd-integration-test-${Date.now()}`, 'ctfd-test-key');
  });

  afterAll(async () => {
    await redisClient.quit();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('registers with a brand-new credential, and only persists it on success', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) } as Response);

    const app = buildApp('user-1', db);
    const res = await request(app).post('/api/integrations/ctfd/register').send({
      app_id: 'app-abc',
      ctfd_url: 'http://ctfd.test',
      newCredential: { name: 'my-ctfd-token', value: { type: 'secretText', secret: 'ctfd_realtoken' } },
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });

    const list = await db.list('user-1', 'secretText');
    expect(list.map((c) => c.name)).toEqual(['my-ctfd-token']);
  });

  it('does not persist a new credential when CTFd rejects the token', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) } as Response);

    const app = buildApp('user-2', db);
    const res = await request(app).post('/api/integrations/ctfd/register').send({
      app_id: 'app-abc',
      ctfd_url: 'http://ctfd.test',
      newCredential: { name: 'bad-token', value: { type: 'secretText', secret: 'ctfd_badtoken' } },
    });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_token');
    const list = await db.list('user-2', 'secretText');
    expect(list).toHaveLength(0);
  });

  it('registers using an existing credentialId instead of a new one', async () => {
    const created = await db.createOrUpdate('user-3', 'secretText', 'existing-token', {
      type: 'secretText',
      secret: 'ctfd_existing',
    });
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) } as Response);

    const app = buildApp('user-3', db);
    const res = await request(app).post('/api/integrations/ctfd/register').send({
      app_id: 'app-abc',
      ctfd_url: 'http://ctfd.test',
      credentialId: created.id,
    });

    expect(res.status).toBe(200);
  });

  it('returns 404 when credentialId belongs to a different user', async () => {
    const created = await db.createOrUpdate('user-4', 'secretText', 'not-yours', {
      type: 'secretText',
      secret: 'ctfd_x',
    });

    const app = buildApp('user-5', db);
    const res = await request(app).post('/api/integrations/ctfd/register').send({
      app_id: 'app-abc',
      ctfd_url: 'http://ctfd.test',
      credentialId: created.id,
    });

    expect(res.status).toBe(404);
  });

  it('returns ctfd_unreachable when the external fetch itself throws (network error)', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('network down'));

    const app = buildApp('user-6', db);
    const res = await request(app).post('/api/integrations/ctfd/register').send({
      app_id: 'app-abc',
      ctfd_url: 'http://unreachable.test',
      newCredential: { name: 'x', value: { type: 'secretText', secret: 'y' } },
    });

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('ctfd_unreachable');
  });

  it('sends app_id and the decrypted token in the request to CTFd, never sends the credentialId', async () => {
    const created = await db.createOrUpdate('user-7', 'secretText', 'token-to-check', {
      type: 'secretText',
      secret: 'ctfd_checkme',
    });
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) } as Response);

    const app = buildApp('user-7', db);
    await request(app).post('/api/integrations/ctfd/register').send({
      app_id: 'app-xyz',
      ctfd_url: 'http://ctfd.test',
      credentialId: created.id,
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://ctfd.test/api/sage/register',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ app_id: 'app-xyz', token: 'ctfd_checkme' }),
      })
    );
  });
});
