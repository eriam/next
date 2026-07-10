import { test, expect } from '@playwright/test';
import { login, creds, freshBoard, mainButton } from '../fixtures/sage3';

/**
 * Authentication & authorization. The LDAP-specific cases (bad credentials, role
 * mapping) skip on non-LDAP instances; the session/authorization cases are generic.
 */
const isLdap = process.env.SAGE3_AUTH === 'ldap';

test.describe('Authentication & authorization', () => {
  test('a wrong password is rejected', async ({ page }) => {
    test.skip(!isLdap, 'LDAP-only');
    const { user } = creds();
    await page.goto('/');
    await page.locator('input[name="username"]').fill(user);
    await page.locator('input[name="password"]').fill('wrong-password-xyz');
    await page.locator('form[action="/auth/ldap"] button[type="submit"]').click();
    // The ?error= param is transient; the durable signal is that we never leave the
    // login page for the app.
    await page.waitForTimeout(3000);
    await expect(page).not.toHaveURL(/#\/(home|createuser)/);
    await expect(page.locator('input[name="username"]')).toBeVisible();
  });

  test('a nonexistent user is rejected', async ({ page }) => {
    test.skip(!isLdap, 'LDAP-only');
    await page.goto('/');
    await page.locator('input[name="username"]').fill(`nobody-${Date.now()}`);
    await page.locator('input[name="password"]').fill('whatever');
    await page.locator('form[action="/auth/ldap"] button[type="submit"]').click();
    await page.waitForTimeout(3000);
    await expect(page).not.toHaveURL(/#\/(home|createuser)/);
    await expect(page.locator('input[name="username"]')).toBeVisible();
  });

  test('unauthenticated requests are rejected', async ({ page }) => {
    // Fresh context, no session cookie: both the auth check and a data endpoint deny.
    const verify = await page.request.get('/auth/verify');
    expect(verify.status()).toBe(403);
    const creds = await page.request.get('/api/credentials');
    expect(creds.ok()).toBeFalsy();
  });

  test('logging out ends the session', async ({ page }) => {
    await freshBoard(page); // login + a board, where the MainButton menu lives
    expect((await page.request.get('/auth/verify')).status()).toBe(200);

    await mainButton(page).click();
    await page.getByRole('menuitem', { name: 'Logout' }).click();
    await expect(page.locator('input[name="username"]')).toBeVisible({ timeout: 20_000 }); // back at login
    expect((await page.request.get('/auth/verify')).status()).toBe(403); // session cleared
  });

  test('an LDAP user is assigned the group-mapped role', async ({ page }) => {
    test.skip(!isLdap, 'LDAP-only');
    await login(page);
    const body = await (await page.request.get('/auth/verify')).json();
    // The test account is a plain Domain Users member -> the "user" role.
    expect(body?.auth?.role).toBe('user');
  });
});
