import { chromium, FullConfig } from '@playwright/test';
import { deleteAllE2ERooms, deleteAllE2ECredentials } from './fixtures/sage3';

/**
 * After the whole run, sweep every room AND stored credential the suite created
 * (names start with "e2e-") so repeated runs don't pile up state on the shared test
 * account. Best-effort — a cleanup failure is logged, not fatal.
 */
export default async function globalTeardown(_config: FullConfig): Promise<void> {
  if (!process.env.SAGE3_USER || !process.env.SAGE3_PASS) return;
  const baseURL = process.env.BASE_URL || 'http://localhost:4200';
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL, ignoreHTTPSErrors: true });
    const page = await context.newPage();
    // deleteAllE2ERooms logs in; the credential sweep then reuses that session.
    const n = await deleteAllE2ERooms(page);
    const c = await deleteAllE2ECredentials(page);
    console.log(`[global-teardown] deleted ${n} e2e room(s), ${c} e2e credential(s)`);
  } catch (err) {
    console.error('[global-teardown] cleanup error:', err);
  } finally {
    await browser.close();
  }
}
