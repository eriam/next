import { Page, expect } from '@playwright/test';

/**
 * Reusable building blocks for the functional E2E specs, all grounded in the real
 * SAGE3 webapp DOM (validated live against staging on the e2e-runner):
 *   login -> [first-login account creation] -> home
 *   create room -> enter room (/#/home/room/<id>)
 *   create board -> enter board (double-click card, /#/board/<room>/<board>)
 *   board MainButton (the button showing the user's name) -> "Settings" -> tabs incl. "Credentials"
 */

export function creds() {
  const user = process.env.SAGE3_USER;
  const pass = process.env.SAGE3_PASS;
  if (!user || !pass) throw new Error('SAGE3_USER and SAGE3_PASS must be set');
  return { user, pass };
}

/** Log in via the LDAP form; complete first-login account creation if shown; land on the app. */
export async function loginLdap(page: Page) {
  const { user, pass } = creds();
  await page.goto('/');
  const username = page.locator('input[name="username"]');
  await expect(username, 'LDAP login form should be visible').toBeVisible();
  await username.fill(user);
  await page.locator('input[name="password"]').fill(pass);
  await Promise.all([
    page.waitForURL((url) => !/error=/.test(url.href), { timeout: 20_000 }),
    // Two elements share the name "Login with LDAP"; the form's submit button is unambiguous.
    page.locator('form[action="/auth/ldap"] button[type="submit"]').click(),
  ]);
  await expect(page, 'LDAP login must not be rejected').not.toHaveURL(/error=ldap_failed/);

  // After login we're on either home (existing account) or the first-login profile page.
  // An existing account only *flashes* createuser then auto-redirects home, so give that a
  // moment; only a genuinely new account stays and must submit the profile form.
  await page.waitForURL(/#\/(home|createuser)/, { timeout: 20_000 });
  if (!page.url().includes('/home')) {
    const wentHome = await page.waitForURL(/#\/home/, { timeout: 4_000 }).then(() => true).catch(() => false);
    if (!wentHome) {
      const firstName = page.getByPlaceholder('First name');
      if ((await firstName.inputValue().catch(() => '')) === '') await firstName.fill(user);
      await page.getByRole('button', { name: 'Create Account' }).click();
      await page.waitForURL(/#\/home/, { timeout: 20_000 });
    }
  }
  await expect(page).toHaveURL(/#\/home/);
}

export async function createRoom(page: Page, name = `e2e-room-${Date.now()}`) {
  await page.locator('[aria-label="Create Room"]').click();
  const d = page.getByRole('dialog');
  await d.getByPlaceholder('Room Name').fill(name);
  await d.getByRole('button', { name: 'Create' }).click();
  await expect(d).toBeHidden();
  await expect(page.getByText(name, { exact: false }).first()).toBeVisible();
  return name;
}

export async function enterRoom(page: Page, name: string) {
  await page.getByText(name, { exact: false }).first().click();
  await expect(page).toHaveURL(/#\/home\/room\//);
}

export async function createBoard(page: Page, name = `e2e-board-${Date.now()}`) {
  await page.locator('[aria-label="Create board"]').click();
  const d = page.getByRole('dialog');
  await d.getByPlaceholder('Board Name').fill(name);
  await d.getByRole('button', { name: /^create$/i }).click();
  await expect(d).toBeHidden();
  await expect(page.getByText(name, { exact: false }).first()).toBeVisible();
  return name;
}

export async function enterBoard(page: Page, name: string) {
  await page.getByText(name, { exact: false }).first().dblclick();
  await expect(page).toHaveURL(/#\/board\//, { timeout: 20_000 });
  // Board canvas is ready once the MainButton (the button labelled with the user's name) shows.
  await expect(mainButton(page)).toBeVisible({ timeout: 20_000 });
}

/** The board's MainButton is a Chakra button whose text is the user's (short) name. */
export function mainButton(page: Page) {
  return page.getByRole('button', { name: new RegExp(creds().user, 'i') }).first();
}

/** Open user settings on the given tab (default Credentials) from the board MainButton menu. */
export async function openSettings(page: Page, tab: RegExp = /credentials/i) {
  await mainButton(page).click();
  // Wait for the menu to actually be open before clicking, or the click races the
  // open animation and the Settings item never fires (dialog never appears).
  const settingsItem = page.getByRole('menuitem', { name: 'Settings' });
  await expect(settingsItem).toBeVisible();
  await settingsItem.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await dialog.getByRole('tab', { name: tab }).click();
  return dialog;
}

/** Compose the whole path to a fresh, entered board. Returns the room + board names. */
export async function freshBoard(page: Page) {
  await loginLdap(page);
  const room = await createRoom(page);
  await enterRoom(page, room);
  const board = await createBoard(page);
  await enterBoard(page, board);
  return { room, board };
}
