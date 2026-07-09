import { test, expect } from '@playwright/test';
import { loginLdap, enterAnyBoard, openUserSettings } from '../fixtures/sage3';

/**
 * Credentials management UI — real browser round-trip against a deployed instance.
 * Covers: add an SSH-key credential -> it appears in the list -> delete it -> it's gone.
 * The test creates and removes its own credential, so it leaves no residue.
 *
 * Form selectors are taken verbatim from CredentialsSettingsTab.tsx:
 *   "+ New credential" -> Select(type) / Input[placeholder=Name] /
 *   Input[placeholder="Private key (paste the full contents)"] / "Add"
 *   rows: IconButton[aria-label="Delete credential"] -> "Delete" confirm
 */
test('add, list, and delete an SSH-key credential via the settings UI', async ({ page }) => {
  const name = `e2e-cred-${Date.now()}`;

  await loginLdap(page);
  await enterAnyBoard(page);
  const settings = await openUserSettings(page, /credentials/i);

  // Open the add form and fill an SSH private key credential.
  await settings.getByRole('button', { name: '+ New credential' }).click();
  await settings.getByRole('combobox').selectOption('sshPrivateKey');
  await settings.getByPlaceholder('Name').fill(name);
  await settings.getByPlaceholder('Username').fill('deploy');
  await settings
    .getByPlaceholder('Private key (paste the full contents)')
    .fill('-----BEGIN OPENSSH PRIVATE KEY-----\ne2e-fake-key\n-----END OPENSSH PRIVATE KEY-----');
  await settings.getByRole('button', { name: 'Add' }).click();

  // It should now appear as a row (name + type), value never shown.
  const row = settings.getByRole('row', { name: new RegExp(name) });
  await expect(row).toBeVisible();
  await expect(settings.getByText(/-----BEGIN OPENSSH PRIVATE KEY-----/)).toHaveCount(0);

  // Delete it (inline confirm) and assert it's gone.
  await row.getByRole('button', { name: 'Delete credential' }).click();
  await settings.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(settings.getByRole('row', { name: new RegExp(name) })).toHaveCount(0);
});
