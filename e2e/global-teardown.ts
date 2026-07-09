import { chromium, FullConfig } from '@playwright/test';
import { deleteAllE2ERooms } from './fixtures/sage3';

/**
 * After the whole run, sweep every room the suite created (names start with
 * "e2e-") so repeated runs don't pile up rooms on the shared test account.
 * Best-effort — a cleanup failure is logged, not fatal.
 */
export default async function globalTeardown(_config: FullConfig): Promise<void> {
  if (!process.env.SAGE3_USER || !process.env.SAGE3_PASS) return;
  const baseURL = process.env.BASE_URL || 'https://sage3-staging.mediavirtuel.com';
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL, ignoreHTTPSErrors: true });
    const page = await context.newPage();
    const n = await deleteAllE2ERooms(page);
    console.log(`[global-teardown] deleted ${n} e2e room(s)`);
  } catch (err) {
    console.error('[global-teardown] cleanup error:', err);
  } finally {
    await browser.close();
  }
}
