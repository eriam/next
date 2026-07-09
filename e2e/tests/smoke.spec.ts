import { test, expect } from '@playwright/test';
import { loginLdap } from '../fixtures/sage3';

/**
 * Deployment smoke test — the prod-deploy gate.
 *
 * Exercises the whole stack end-to-end in a real browser: LDAP auth, first-login
 * account creation, the home page, and creating a room (which round-trips through the
 * WebSocket / SAGEBase backend). If this passes, the deployed frontend + auth + backend
 * are functionally alive; if it fails, prod should NOT be deployed.
 *
 * Deeper feature flows (credentials CRUD, SSH terminal) live in their own specs and are
 * added to the gate as they're tuned.
 */
test('smoke: login, account creation, and room creation round-trip', async ({ page }) => {
  await loginLdap(page);
  await expect(page).toHaveURL(/#\/home/);

  const roomName = `e2e-smoke-${Date.now()}`;
  await page.locator('[aria-label="Create Room"]').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByPlaceholder('Room Name').fill(roomName);
  await dialog.getByRole('button', { name: 'Create' }).click();

  // The room persisted through the backend and shows up on the home page
  // (it renders in both the sidebar and the room list, so match the first).
  await expect(dialog).toBeHidden();
  await expect(page.getByText(roomName, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
});
