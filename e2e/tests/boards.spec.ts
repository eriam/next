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
});
