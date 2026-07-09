import { defineConfig, devices } from '@playwright/test';

/**
 * SAGE3 E2E config.
 *
 * Everything env-driven so the same suite runs against any deployed instance
 * (staging by default) from the shared E2E runner or from Jenkins.
 *
 *   BASE_URL          target instance (default: staging)
 *   SAGE3_USER/_PASS  LDAP login used by the tests
 *   SSH_TARGET_*      throwaway sshd target for the SSH-terminal spec (see scripts/ssh-target.sh)
 *
 * Video + screenshots are always captured so a run produces reviewable artifacts
 * (Jenkins archives test-results/ and playwright-report/).
 */
export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  fullyParallel: false, // these tests mutate shared server state; keep them serial
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: process.env.BASE_URL || 'https://sage3-staging.mediavirtuel.com',
    video: 'on',
    screenshot: 'on',
    trace: 'on-first-retry',
    ignoreHTTPSErrors: true, // origin pin / self-signed staging certs
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
    // Slow each action so the recorded video plays at a human-watchable pace.
    // Override with SLOWMO_MS=0 for a fast (headless CI) run.
    launchOptions: { slowMo: Number(process.env.SLOWMO_MS ?? 500) },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
