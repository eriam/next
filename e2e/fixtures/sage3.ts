import { Page, expect } from '@playwright/test';

/**
 * Shared navigation helpers, grounded in the real SAGE3 webapp DOM:
 *  - LDAP login is a plain POST form (action="/auth/ldap") with name=username / name=password
 *    and a "Login with LDAP" submit button (apps/webapp/.../login/Login.tsx).
 *  - User settings open from the board MainButton menu -> Settings item -> modal, whose tabs
 *    include "Credentials" (libs/frontend/.../MainButton.tsx, EditUserSettingsModal.tsx).
 *
 * Navigation selectors (create/enter board, open the MainButton menu) are best-effort and may
 * need a tuning pass on first run against the live app — the form-level selectors below are
 * taken verbatim from the components and should be stable.
 */

export function creds() {
  const user = process.env.SAGE3_USER;
  const pass = process.env.SAGE3_PASS;
  if (!user || !pass) throw new Error('SAGE3_USER and SAGE3_PASS must be set');
  return { user, pass };
}

/** Log in via the LDAP form and land authenticated on the home page. */
export async function loginLdap(page: Page) {
  const { user, pass } = creds();
  await page.goto('/');
  const username = page.locator('input[name="username"]');
  await expect(username, 'LDAP login form should be visible').toBeVisible();
  await username.fill(user);
  await page.locator('input[name="password"]').fill(pass);
  await Promise.all([
    page.waitForURL((url) => !/error=/.test(url.href), { timeout: 20_000 }),
    page.getByRole('button', { name: 'Login with LDAP' }).click(),
  ]);
  await expect(page, 'LDAP login must not be rejected').not.toHaveURL(/error=ldap_failed/);
}

/**
 * Enter a board (settings + apps are only reachable inside one). Creates a scratch board if
 * needed. TODO(runner): confirm the create-board / enter-board selectors against the live home UI.
 */
export async function enterAnyBoard(page: Page, boardName = `e2e-${Date.now()}`) {
  // Try to open an existing board card first; otherwise create one.
  const existing = page.getByRole('button', { name: /open board|enter/i }).first();
  if (await existing.isVisible().catch(() => false)) {
    await existing.click();
  } else {
    await page.getByRole('button', { name: /create board/i }).first().click();
    await page.getByPlaceholder(/board name|name/i).first().fill(boardName);
    await page.getByRole('button', { name: /^create$/i }).click();
  }
  // The board canvas is ready once the MainButton (bottom-left) is present.
  await expect(page.locator('[aria-label="Main Menu"], [data-testid="main-button"]').first()).toBeVisible();
}

/** Open user settings on the given tab (default 'Credentials') from the board MainButton menu. */
export async function openUserSettings(page: Page, tab: RegExp = /credentials/i) {
  await page.locator('[aria-label="Main Menu"], [data-testid="main-button"]').first().click();
  await page.getByRole('menuitem', { name: /settings/i }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('tab', { name: tab }).click();
  return dialog;
}
