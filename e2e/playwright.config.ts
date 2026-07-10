import { defineConfig, devices } from '@playwright/test';

/**
 * SAGE3 E2E config.
 *
 * Everything env-driven so the same suite runs against any running SAGE3 instance
 * (local dev by default, or a deployed one).
 *
 *   BASE_URL          target instance (default: http://localhost:4200)
 *   SAGE3_AUTH        login strategy: "guest" (default) or "ldap"
 *   SAGE3_USER/_PASS  credentials (required only for SAGE3_AUTH=ldap)
 *   SSH_TARGET_*      throwaway sshd target for the SSH-terminal spec (see scripts/ssh-target.sh)
 *
 * Video + screenshots are always captured so a run produces reviewable artifacts.
 */
export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  // Sweep e2e-* rooms/credentials created during the run so the test account stays clean.
  globalTeardown: './global-teardown.ts',
  fullyParallel: false, // these tests mutate shared server state; keep them serial
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:4200',
    video: 'on',
    screenshot: 'on',
    trace: 'on-first-retry',
    ignoreHTTPSErrors: true, // tolerate self-signed certs on dev/remote instances
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
    // Slow each action so the recorded video plays at a human-watchable pace.
    // Lower SLOWMO_MS for faster CI runs, but keep it >= 120: at 0 the shared
    // fixtures race the UI's menu/dialog open animations.
    launchOptions: { slowMo: Number(process.env.SLOWMO_MS ?? 500) },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
