import { test, expect, Locator } from '@playwright/test';
import { freshBoard, openSettings, login } from '../fixtures/sage3';

/**
 * Credentials management UI — one functionality per test. Each starts from a fresh
 * board and opens Settings -> Credentials. Form selectors are verbatim from
 * CredentialsSettingsTab.tsx. Every test names its credential uniquely and cleans
 * up after itself (or only ever adds a uniquely-named row), so runs don't collide.
 */

// Fill the add-credential form for a given type. Returns the credential name used.
async function fillNewCredential(
  settings: Locator,
  type: 'sshPrivateKey' | 'secretText' | 'usernamePassword',
  name: string
): Promise<void> {
  await settings.getByRole('button', { name: '+ New credential' }).click();
  await settings.getByRole('combobox').selectOption(type);
  await settings.getByPlaceholder('Name', { exact: true }).fill(name);
  if (type === 'sshPrivateKey') {
    await settings.getByPlaceholder('Username').fill('deploy');
    await settings
      .getByPlaceholder('Private key (paste the full contents)')
      .fill('-----BEGIN OPENSSH PRIVATE KEY-----\ne2e\n-----END OPENSSH PRIVATE KEY-----');
  } else if (type === 'secretText') {
    await settings.getByPlaceholder('Secret').fill('s3cr3t-value');
  } else {
    await settings.getByPlaceholder('Username').fill('svc-user');
    await settings.getByPlaceholder('Password').fill('svc-pass');
  }
}

async function deleteRow(settings: Locator, name: string): Promise<void> {
  const row = settings.getByRole('row', { name: new RegExp(name) });
  await row.getByRole('button', { name: 'Delete credential' }).click();
  await settings.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(settings.getByRole('row', { name: new RegExp(name) })).toHaveCount(0);
}

test.describe('Credentials', () => {
  for (const type of ['sshPrivateKey', 'secretText', 'usernamePassword'] as const) {
    test(`add a ${type} credential`, async ({ page }) => {
      await freshBoard(page);
      const settings = await openSettings(page, /credentials/i);
      const name = `e2e-${type}-${Date.now()}`;
      await fillNewCredential(settings, type, name);
      await settings.getByRole('button', { name: 'Add' }).click();
      await expect(settings.getByRole('row', { name: new RegExp(name) })).toBeVisible();
      // the secret value is never rendered
      await expect(settings.getByText(/BEGIN OPENSSH PRIVATE KEY|s3cr3t-value|svc-pass/)).toHaveCount(0);
      await deleteRow(settings, name); // clean up
    });
  }

  test('delete a credential', async ({ page }) => {
    await freshBoard(page);
    const settings = await openSettings(page, /credentials/i);
    const name = `e2e-del-${Date.now()}`;
    await fillNewCredential(settings, 'secretText', name);
    await settings.getByRole('button', { name: 'Add' }).click();
    await expect(settings.getByRole('row', { name: new RegExp(name) })).toBeVisible();
    await deleteRow(settings, name);
  });

  test('cancel the add form creates nothing', async ({ page }) => {
    await freshBoard(page);
    const settings = await openSettings(page, /credentials/i);
    const name = `e2e-cancel-${Date.now()}`;
    await fillNewCredential(settings, 'secretText', name);
    await settings.getByRole('button', { name: 'Cancel' }).click();
    await expect(settings.getByRole('row', { name: new RegExp(name) })).toHaveCount(0);
  });

  test('cancelling a delete keeps the credential', async ({ page }) => {
    await freshBoard(page);
    const settings = await openSettings(page, /credentials/i);
    const name = `e2e-keep-${Date.now()}`;
    await fillNewCredential(settings, 'secretText', name);
    await settings.getByRole('button', { name: 'Add' }).click();
    const row = settings.getByRole('row', { name: new RegExp(name) });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Delete credential' }).click();
    await settings.getByRole('button', { name: 'Cancel' }).click();
    await expect(settings.getByRole('row', { name: new RegExp(name) })).toBeVisible(); // still there
    await deleteRow(settings, name); // clean up
  });

  test('Add stays disabled until required fields are filled', async ({ page }) => {
    await freshBoard(page);
    const settings = await openSettings(page, /credentials/i);
    await settings.getByRole('button', { name: '+ New credential' }).click();
    await settings.getByRole('combobox').selectOption('secretText');
    // nothing filled yet -> Add disabled
    await expect(settings.getByRole('button', { name: 'Add' })).toBeDisabled();
    await settings.getByPlaceholder('Name', { exact: true }).fill(`e2e-valid-${Date.now()}`);
    await settings.getByPlaceholder('Secret').fill('x');
    await expect(settings.getByRole('button', { name: 'Add' })).toBeEnabled();
  });

  test('re-adding the same name updates in place (one row)', async ({ page }) => {
    await freshBoard(page);
    const settings = await openSettings(page, /credentials/i);
    const name = `e2e-dup-${Date.now()}`;
    await fillNewCredential(settings, 'secretText', name);
    await settings.getByRole('button', { name: 'Add' }).click();
    await expect(settings.getByRole('row', { name: new RegExp(name) })).toHaveCount(1);
    // Same name again -> createOrUpdate updates the existing row rather than adding.
    await fillNewCredential(settings, 'secretText', name);
    await settings.getByRole('button', { name: 'Add' }).click();
    await expect(settings.getByRole('row', { name: new RegExp(name) })).toHaveCount(1);
    await deleteRow(settings, name); // clean up
  });

  test('the API never returns the stored secret', async ({ page }) => {
    await login(page);
    const name = `e2e-apisec-${Date.now()}`;
    const marker = `topsecret-${Date.now()}`;
    const create = await page.request.post('/api/credentials', {
      data: { name, type: 'secretText', value: { type: 'secretText', secret: marker } },
    });
    expect(create.ok()).toBeTruthy();

    const resp = await page.request.get('/api/credentials');
    const body = await resp.text();
    // Neither the plaintext secret nor the stored ciphertext is ever serialised.
    expect(body).not.toContain(marker);
    const list = JSON.parse(body) as Array<{ id: string; name: string; encryptedValue?: string }>;
    const mine = list.find((c) => c.name === name);
    expect(mine, 'credential should be listed').toBeTruthy();
    expect(mine?.encryptedValue, 'ciphertext must not be exposed').toBeUndefined();

    await page.request.delete(`/api/credentials/${mine!.id}`); // clean up
  });

  test('listing by type returns only that type', async ({ page }) => {
    await login(page);
    const key = `e2e-tk-key-${Date.now()}`;
    const up = `e2e-tk-up-${Date.now()}`;
    await page.request.post('/api/credentials', {
      data: {
        name: key,
        type: 'sshPrivateKey',
        value: { type: 'sshPrivateKey', username: 'u', privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nx\n-----END OPENSSH PRIVATE KEY-----' },
      },
    });
    await page.request.post('/api/credentials', {
      data: { name: up, type: 'usernamePassword', value: { type: 'usernamePassword', username: 'u', password: 'p' } },
    });

    // The SSH terminal's picker relies on this filter (useCredentials('sshPrivateKey')).
    const resp = await page.request.get('/api/credentials?type=sshPrivateKey');
    const list = (await resp.json()) as Array<{ id: string; name: string; type: string }>;
    expect(list.some((c) => c.name === key)).toBeTruthy();
    expect(list.some((c) => c.name === up)).toBeFalsy();
    expect(list.every((c) => c.type === 'sshPrivateKey')).toBeTruthy();

    const all = (await (await page.request.get('/api/credentials')).json()) as Array<{ id: string; name: string }>;
    for (const c of all) if (c.name === key || c.name === up) await page.request.delete(`/api/credentials/${c.id}`);
  });
});
