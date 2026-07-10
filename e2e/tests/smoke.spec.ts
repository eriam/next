import { test, expect } from '@playwright/test';
import { login } from '../fixtures/sage3';

/**
 * Smoke test — exercises the whole stack end-to-end in a real browser: auth,
 * first-login account creation, the home page, and creating a room (which round-trips
 * through the WebSocket / SAGEBase backend). If this passes, the frontend + auth +
 * backend are functionally alive.
 *
 * Deeper feature flows (credentials CRUD, SSH terminal) live in their own specs.
 */
test('smoke: login, account creation, and room creation round-trip', async ({ page }) => {
  await login(page);
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
