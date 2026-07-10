import { Page, expect } from '@playwright/test';

/**
 * Reusable building blocks for the functional E2E specs, grounded in the real SAGE3
 * webapp DOM:
 *   login -> [first-login account creation] -> home
 *   create room -> enter room (/#/home/room/<id>)
 *   create board -> enter board (double-click card, /#/board/<room>/<board>)
 *   board MainButton (the button showing the user's name) -> "Settings" -> tabs incl. "Credentials"
 *
 * Auth is instance-dependent, so login() is strategy-selectable via SAGE3_AUTH:
 *   - "guest" (default): click the guest login button (ephemeral user).
 *   - "ldap": fill the LDAP form; requires SAGE3_USER / SAGE3_PASS.
 */

type AuthStrategy = 'guest' | 'ldap';
export function authStrategy(): AuthStrategy {
  return (process.env.SAGE3_AUTH as AuthStrategy) || 'guest';
}

/** LDAP credentials — only required when SAGE3_AUTH=ldap. */
export function creds() {
  const user = process.env.SAGE3_USER;
  const pass = process.env.SAGE3_PASS;
  if (!user || !pass) throw new Error('SAGE3_USER and SAGE3_PASS must be set for SAGE3_AUTH=ldap');
  return { user, pass };
}

/** The name the test account is created/known by — fills the first-login profile
 * form and locates the board MainButton. Defaults to a stable label for guest runs. */
export function displayName(): string {
  return process.env.SAGE3_USER || 'e2e-tester';
}

/** A second LDAP account, for the cross-user tests (control transfer, owner
 * isolation). Only required when those tests run. */
export function creds2() {
  const user = process.env.SAGE3_USER2;
  const pass = process.env.SAGE3_PASS2;
  if (!user || !pass) throw new Error('SAGE3_USER2 and SAGE3_PASS2 must be set for the cross-user tests');
  return { user, pass };
}

/** Log in against the target instance and land on /#/home, completing first-login
 * account creation if shown. Strategy chosen by SAGE3_AUTH (guest by default).
 * Pass `opts` to log in as a specific LDAP account (used for the second user). */
export async function login(page: Page, opts?: { user: string; pass: string }) {
  await page.goto('/');
  const profileName = opts?.user ?? displayName();
  if (authStrategy() === 'ldap') {
    const user = opts?.user ?? creds().user;
    const pass = opts?.pass ?? creds().pass;
    const username = page.locator('input[name="username"]');
    await expect(username, 'LDAP login form should be visible').toBeVisible();
    await username.fill(user);
    await page.locator('input[name="password"]').fill(pass);
    await Promise.all([
      page.waitForURL((url) => !/error=/.test(url.href), { timeout: 20_000 }),
      // Two elements share the name "Login with LDAP"; the form's submit button is unambiguous.
      page.locator('form[action="/auth/ldap"] button[type="submit"]').click(),
    ]);
    await expect(page, 'LDAP login must not be rejected').not.toHaveURL(/error=/);
  } else {
    // Guest: the login page offers a guest button that creates an ephemeral user.
    await Promise.all([
      page.waitForURL((url) => !/error=/.test(url.href), { timeout: 20_000 }),
      page.getByRole('button', { name: /log ?in as guest|guest/i }).first().click(),
    ]);
  }

  // After login we're on either home (existing account) or the first-login profile page.
  // An existing account only *flashes* createuser then auto-redirects home, so give that a
  // moment; only a genuinely new account stays and must submit the profile form.
  await page.waitForURL(/#\/(home|createuser)/, { timeout: 20_000 });
  if (!page.url().includes('/home')) {
    const wentHome = await page.waitForURL(/#\/home/, { timeout: 4_000 }).then(() => true).catch(() => false);
    if (!wentHome) {
      const firstName = page.getByPlaceholder('First name');
      if ((await firstName.inputValue().catch(() => '')) === '') await firstName.fill(profileName);
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
  return page.getByRole('button', { name: new RegExp(displayName(), 'i') }).first();
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
  await login(page);
  const room = await createRoom(page);
  await enterRoom(page, room);
  const board = await createBoard(page);
  await enterBoard(page, board);
  return { room, board };
}

/**
 * Add an app to the current board from the Applications menu. The menu lists one
 * button per enabled app (label == the app's type name, e.g. "SSHTerminal");
 * clicking it creates the app at board centre. Selectors from ApplicationsMenu.tsx
 * / MenuButton.tsx (Chakra Button with the app name as its text).
 */
export async function addApp(page: Page, appName: string): Promise<void> {
  await page.locator('[aria-label="Open Applications Menu"]').click();
  await page.getByRole('button', { name: appName, exact: true }).click();
  // Close the menu so it doesn't overlap the new app's UI.
  await page.keyboard.press('Escape');
}

/**
 * Delete a room by name (Room options -> Settings -> Delete -> confirm). Navigates
 * home first, so it works from anywhere. Best-effort: never throws, so it's safe
 * to call from teardown without failing an otherwise-passing test.
 */
export async function deleteRoom(page: Page, roomName: string): Promise<void> {
  try {
    await page.goto('/#/home');
    await expect(page).toHaveURL(/#\/home/);
    const roomLink = page.getByText(roomName, { exact: false }).first();
    if (!(await roomLink.isVisible().catch(() => false))) return; // already gone
    await roomLink.click();
    await expect(page).toHaveURL(/#\/home\/room\//);
    await page.locator('[aria-label="Room options"]').first().click();
    await page.getByRole('menuitem', { name: 'Settings' }).click();
    const dialog = page.getByRole('dialog');
    // The Delete button arms an inline confirm (still one Delete button); clicking
    // it again confirms and deletes the room.
    const del = dialog.getByRole('button', { name: 'Delete', exact: true });
    await del.click();
    await page.waitForTimeout(400);
    await del.click();
    await page.waitForTimeout(1000);
  } catch {
    /* best-effort teardown cleanup */
  }
}

/**
 * Delete every credential whose name starts with the e2e prefix, via the REST API
 * (page.request shares the logged-in context's session cookie). The SSH specs create
 * a stored sshPrivateKey credential on every connect-with-new-key; without this they
 * pile up on the shared test account. Assumes the page is already logged in.
 * Best-effort — never throws.
 */
export async function deleteAllE2ECredentials(page: Page, prefix = 'e2e-'): Promise<number> {
  let deleted = 0;
  try {
    const resp = await page.request.get('/api/credentials');
    if (!resp.ok()) return 0;
    const list = (await resp.json()) as Array<{ id: string; name: string }>;
    for (const c of list) {
      if (typeof c?.name === 'string' && c.name.startsWith(prefix)) {
        const d = await page.request.delete(`/api/credentials/${c.id}`);
        if (d.ok()) deleted++;
      }
    }
  } catch {
    /* best-effort */
  }
  return deleted;
}

/** Delete every room whose name starts with the e2e prefix. Used by global teardown. */
export async function deleteAllE2ERooms(page: Page, prefix = 'e2e-'): Promise<number> {
  await login(page);
  let deleted = 0;
  // Re-query each pass, since deleting reflows the list.
  for (let i = 0; i < 100; i++) {
    await page.goto('/#/home');
    await expect(page).toHaveURL(/#\/home/);
    const names = await page
      .locator(`text=/${prefix}/`)
      .evaluateAll((els) => [...new Set(els.map((e) => (e as HTMLElement).innerText.trim()).filter((t) => t.startsWith('e2e-')))]);
    // keep only room-looking names (rooms start with e2e-room / e2e-smoke etc.)
    const roomNames = names.filter((n) => /^e2e-(room|smoke)/.test(n));
    if (roomNames.length === 0) break;
    await deleteRoom(page, roomNames[0]);
    deleted++;
  }
  return deleted;
}
