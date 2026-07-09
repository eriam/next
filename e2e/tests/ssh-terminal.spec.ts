import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { loginLdap, enterAnyBoard } from '../fixtures/sage3';

/**
 * SSHTerminal app — real end-to-end: place the app, connect (server-side dials a real sshd),
 * run a command, and see real output.
 *
 * Requires a reachable sshd target — bring one up with `scripts/ssh-target.sh up`, which prints
 * SSH_TARGET_HOST/PORT/USER and writes a private key. IMPORTANT: the target must be reachable
 * from the app-under-test's *backend* (homebase), not just from this runner, since homebase makes
 * the SSH connection. On the shared runner, expose it on the reserved 2200-2299 range.
 *
 * Setup-form selectors are verbatim from SSHTerminal.tsx (Host/Port inputs, new-credential link,
 * Username / "Private key (paste the full contents)" / "Name (e.g. my-server-key)", Connect).
 * TODO(runner): confirm the "add SSHTerminal app to the board" gesture against the live app menu.
 */
const host = process.env.SSH_TARGET_HOST;
const port = process.env.SSH_TARGET_PORT || '2222';
const user = process.env.SSH_TARGET_USER || 'e2e';
const keyPath = process.env.SSH_TARGET_KEY_PATH; // path to the private key ssh-target.sh generated

test.skip(!host || !keyPath, 'SSH_TARGET_HOST and SSH_TARGET_KEY_PATH must be set (run scripts/ssh-target.sh up)');

test('connect the SSH terminal to a real host and run a command', async ({ page }) => {
  const privateKey = readFileSync(keyPath as string, 'utf8');

  await loginLdap(page);
  await enterAnyBoard(page);

  // TODO(runner): open the app menu and add "SSHTerminal" to the board. Placeholder gesture:
  await page.getByRole('button', { name: /applications|apps/i }).first().click();
  await page.getByRole('menuitem', { name: /ssh ?terminal/i }).click();

  // Setup form.
  const app = page.locator('.sage3-app', { hasText: 'Host' }).last();
  await app.getByPlaceholder('Host').fill(host as string);
  await app.getByPlaceholder('Port').fill(String(port));
  await app.getByRole('button', { name: /new credential|create/i }).click();
  await app.getByPlaceholder('Name (e.g. my-server-key)').fill(`e2e-ssh-${Date.now()}`);
  await app.getByPlaceholder('Username').fill(user);
  await app.getByPlaceholder('Private key (paste the full contents)').fill(privateKey);
  await app.getByRole('button', { name: 'Connect' }).click();

  // The xterm terminal should render and, after we type a command, echo real output.
  const term = app.locator('.xterm');
  await expect(term).toBeVisible({ timeout: 30_000 });
  await app.locator('.xterm-helper-textarea').fill('whoami\n');
  await expect(app.locator('.xterm-rows')).toContainText(user, { timeout: 15_000 });
});
