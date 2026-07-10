import { test, expect } from '@playwright/test';
import { login, createRoom, enterRoom, deleteRoom } from '../fixtures/sage3';

test.describe('Rooms', () => {
  test('create a room', async ({ page }) => {
    await login(page);
    const name = await createRoom(page);
    await expect(page.getByText(name, { exact: false }).first()).toBeVisible();
  });

  test('enter a room', async ({ page }) => {
    await login(page);
    const name = await createRoom(page);
    await enterRoom(page, name);
    await expect(page).toHaveURL(/#\/home\/room\//);
  });

  test('delete a room', async ({ page }) => {
    await login(page);
    const name = await createRoom(page);
    await expect(page.getByText(name, { exact: false }).first()).toBeVisible();
    await deleteRoom(page, name);
    await page.goto('/#/home');
    await expect(page).toHaveURL(/#\/home/);
    await expect(page.getByText(name, { exact: false })).toHaveCount(0);
  });
});
