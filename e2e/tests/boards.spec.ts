import { test, expect } from '@playwright/test';
import { login, createRoom, enterRoom, createBoard, enterBoard } from '../fixtures/sage3';

test.describe('Boards', () => {
  test('create a board', async ({ page }) => {
    await login(page);
    const room = await createRoom(page);
    await enterRoom(page, room);
    const board = await createBoard(page);
    await expect(page.getByText(board, { exact: false }).first()).toBeVisible();
  });

  test('enter a board', async ({ page }) => {
    await login(page);
    const room = await createRoom(page);
    await enterRoom(page, room);
    const board = await createBoard(page);
    await enterBoard(page, board);
    await expect(page).toHaveURL(/#\/board\//);
  });

  test('delete a board', async ({ page }) => {
    await login(page);
    const room = await createRoom(page);
    await enterRoom(page, room);
    const board = await createBoard(page);
    await expect(page.getByText(board, { exact: false }).first()).toBeVisible();

    // Board card options -> Edit Board -> modal Delete -> confirm Delete.
    // Fresh room, so there's a single board card / options button.
    await page.locator('[aria-label="Board options"]').first().click();
    await page.getByText('Edit Board', { exact: true }).click();
    // EditBoardModal's red Delete button arms a confirm dialog with its own Delete.
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).last().click();

    await expect(page.getByText(board, { exact: false })).toHaveCount(0);
  });
});
