import { test, expect } from '@playwright/test';
import { freshBoard, openSettings, addApp } from '../fixtures/sage3';

/**
 * The features are only usable if they're actually surfaced in the UI: the
 * SSHTerminal app must appear in the Applications menu (proves features.apps
 * enablement), and the Credentials tab must appear in user Settings.
 */
test.describe('App availability', () => {
  test('SSHTerminal is offered in the Applications menu', async ({ page }) => {
    await freshBoard(page);
    await page.locator('[aria-label="Open Applications Menu"]').click();
    // The menu lists the app by its type name; match "SSHTerminal" / "SSH Terminal".
    await expect(page.getByText(/ssh\s?terminal/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test('Credentials tab is present in user Settings', async ({ page }) => {
    await freshBoard(page);
    const settings = await openSettings(page, /credentials/i);
    await expect(settings.getByRole('tab', { name: /credentials/i })).toBeVisible();
  });

  test('placing an app from the menu renders it on the board', async ({ page }) => {
    await freshBoard(page);
    await addApp(page, 'Stickie');
    // A Stickie renders its editable note textarea.
    await expect(page.getByPlaceholder('Type here...').first()).toBeVisible({ timeout: 15_000 });
  });

  test('all user Settings tabs are present and switchable', async ({ page }) => {
    await freshBoard(page);
    const settings = await openSettings(page, /interface/i);
    for (const name of ['Interface', 'Board Visibility', 'Intelligence', 'Credentials']) {
      const tab = settings.getByRole('tab', { name });
      await tab.click();
      await expect(tab).toHaveAttribute('aria-selected', 'true');
    }
  });
});
