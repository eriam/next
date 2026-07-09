import { test, expect } from '@playwright/test';
import { freshBoard, openSettings } from '../fixtures/sage3';

/**
 * The features are only usable if they're actually surfaced in the UI: the
 * SSHTerminal app must appear in the Applications menu (proves features.apps
 * enablement), and the Credentials tab must appear in user Settings.
 */
test.describe('App availability', () => {
  test('SSHTerminal is offered in the Applications menu', async ({ page }) => {
    await freshBoard(page);
    await page.locator('[aria-label="Open Applications Menu"]').click();
    // TODO(runner): confirm the menu label if this doesn't match ("SSH Terminal" vs "SSHTerminal").
    await expect(page.getByText(/ssh\s?terminal/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test('Credentials tab is present in user Settings', async ({ page }) => {
    await freshBoard(page);
    const settings = await openSettings(page, /credentials/i);
    await expect(settings.getByRole('tab', { name: /credentials/i })).toBeVisible();
  });
});
