import { test, expect } from '@playwright/test';
import { freshBoard, openSettings } from '../fixtures/sage3';

/**
 * Credentials management UI, one functionality per test. Each starts from a fresh board
 * and opens Settings -> Credentials. Form selectors are verbatim from CredentialsSettingsTab.tsx.
 */
test.describe('Credentials', () => {
  test('add a credential', async ({ page }) => {
    await freshBoard(page);
    const settings = await openSettings(page, /credentials/i);

    const name = `e2e-cred-${Date.now()}`;
    await settings.getByRole('button', { name: '+ New credential' }).click();
    await settings.getByRole('combobox').selectOption('sshPrivateKey');
    await settings.getByPlaceholder('Name').fill(name);
    await settings.getByPlaceholder('Username').fill('deploy');
    await settings
      .getByPlaceholder('Private key (paste the full contents)')
      .fill('-----BEGIN OPENSSH PRIVATE KEY-----\ne2e-fake-key\n-----END OPENSSH PRIVATE KEY-----');
    await settings.getByRole('button', { name: 'Add' }).click();

    await expect(settings.getByRole('row', { name: new RegExp(name) })).toBeVisible();
    // the secret value is never rendered
    await expect(settings.getByText(/BEGIN OPENSSH PRIVATE KEY/)).toHaveCount(0);
  });

  test('delete a credential', async ({ page }) => {
    await freshBoard(page);
    const settings = await openSettings(page, /credentials/i);

    const name = `e2e-cred-del-${Date.now()}`;
    await settings.getByRole('button', { name: '+ New credential' }).click();
    await settings.getByRole('combobox').selectOption('secretText');
    await settings.getByPlaceholder('Name').fill(name);
    await settings.getByPlaceholder('Secret').fill('s3cr3t-value');
    await settings.getByRole('button', { name: 'Add' }).click();

    const row = settings.getByRole('row', { name: new RegExp(name) });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Delete credential' }).click();
    await settings.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(settings.getByRole('row', { name: new RegExp(name) })).toHaveCount(0);
  });
});
