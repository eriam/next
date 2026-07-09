import { test, expect } from '@playwright/test';
import { loginLdap, createRoom, enterRoom } from '../fixtures/sage3';

test.describe('Rooms', () => {
  test('create a room', async ({ page }) => {
    await loginLdap(page);
    const name = await createRoom(page);
    await expect(page.getByText(name, { exact: false }).first()).toBeVisible();
  });

  test('enter a room', async ({ page }) => {
    await loginLdap(page);
    const name = await createRoom(page);
    await enterRoom(page, name);
    await expect(page).toHaveURL(/#\/home\/room\//);
  });
});
