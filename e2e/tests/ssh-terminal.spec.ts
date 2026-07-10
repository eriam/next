import { test, expect, Page, Locator } from '@playwright/test';
import { readFileSync } from 'fs';
import { freshBoard, addApp, enterRoom, enterBoard, createRoom, createBoard, login, creds2 } from '../fixtures/sage3';

/**
 * SSHTerminal app — real end-to-end. The server (homebase) dials a real sshd, starts
 * tmux, and relays the PTY over a WebSocket; the app renders it with xterm.js.
 *
 * Requires a reachable sshd target — bring one up with `scripts/ssh-target.sh up`.
 * IMPORTANT: the target must be reachable from the SAGE3 *backend* (homebase), not
 * just from the machine running the tests, since homebase makes the SSH connection.
 * When homebase runs on a different host (or in a container), set SSH_TARGET_HOST to
 * an address it can dial (e.g. the test host's LAN IP, not 127.0.0.1).
 *
 * Form + terminal selectors are verbatim from SSHTerminal.tsx.
 */
const host = process.env.SSH_TARGET_HOST;
const port = process.env.SSH_TARGET_PORT || '2222';
const user = process.env.SSH_TARGET_USER || 'e2e';
const keyPath = process.env.SSH_TARGET_KEY_PATH; // private key that scripts/ssh-target.sh generated

test.skip(!host || !keyPath, 'SSH_TARGET_HOST and SSH_TARGET_KEY_PATH must be set (run scripts/ssh-target.sh up)');

const privateKey = keyPath ? readFileSync(keyPath, 'utf8') : '';

// The SSHTerminal app window is small; its drag/resize "handle" overlays the edges
// and intercepts pointer events on controls near the bottom. Dispatch the click
// straight to the element (React's delegated onClick still fires) so the overlay
// can't swallow it.
async function clickInApp(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible();
  await locator.dispatchEvent('click');
}

// Fill the SetupForm's "new SSH key" variant and connect. The form auto-shows the
// new-key fields when the account has no sshPrivateKey credentials; if a previous
// run left one, flip to it explicitly.
async function connectWithNewKey(
  page: Page,
  opts: { host: string; port: string; user: string; key: string; name: string }
): Promise<void> {
  await page.getByPlaceholder('Host').fill(opts.host);
  await page.getByPlaceholder('Port').fill(opts.port);
  // Force the new-key variant regardless of whether the account already has stored
  // sshPrivateKey credentials (which flips the form to a radio list of them).
  if (!(await page.getByText('New SSH key').isVisible().catch(() => false))) {
    await clickInApp(page.getByRole('button', { name: /use a new key instead/i }));
  }
  await page.getByPlaceholder('Name (e.g. my-server-key)').fill(opts.name);
  await page.getByPlaceholder('Username').fill(opts.user);
  await page.getByPlaceholder(/Private key \(paste the full contents/).fill(opts.key);
  await clickInApp(page.getByRole('button', { name: 'Connect' }));
}

// Place an SSHTerminal, connect it to the good target with a fresh key, and wait for
// the live terminal to render.
async function placeAndConnect(page: Page, name: string): Promise<void> {
  await addApp(page, 'SSHTerminal');
  await connectWithNewKey(page, { host: host as string, port, user, key: privateKey, name });
  await expect(page.locator('.xterm')).toBeVisible({ timeout: 30_000 });
}

// Type a shell command into the terminal via real key events (xterm listens to key
// events, not textarea.fill). Becomes the controller first if it isn't already —
// the creator is NOT the controller by default.
async function runCommand(page: Page, command: string): Promise<void> {
  const takeControl = page.getByRole('button', { name: /take control/i });
  if (await takeControl.isVisible().catch(() => false)) await clickInApp(takeControl);
  // Focus xterm's hidden input directly — clicking it is intercepted by the app
  // window's resize handle, and focus() needs no clickability.
  await page.locator('.xterm-helper-textarea').focus();
  await page.keyboard.type(command);
  await page.keyboard.press('Enter');
}

test('connect to a real host with a new key and run a command', async ({ page }) => {
  await freshBoard(page);
  await placeAndConnect(page, `e2e-ssh-${Date.now()}`);

  // `echo e2e-$((6*7))` -> "e2e-42": the typed line contains "6*7", so only real
  // remote execution can produce "e2e-42" in the output.
  await runCommand(page, 'echo e2e-$((6*7))');
  await expect(page.locator('.xterm-rows')).toContainText('e2e-42', { timeout: 15_000 });
});

test('connect by picking an existing stored credential', async ({ page }) => {
  const credName = `e2e-reuse-${Date.now()}`;
  // Board 1: connect once with a new key — this is what persists the credential.
  // (The terminal rendering means the connect POST returned, i.e. the credential
  // is already stored.)
  await freshBoard(page);
  await placeAndConnect(page, credName);

  // Board 2: a fresh app now offers the stored credential as a radio (the
  // credentialId path), instead of the new-key fields.
  await page.goto('/#/home');
  const room2 = await createRoom(page);
  await enterRoom(page, room2);
  const board2 = await createBoard(page);
  await enterBoard(page, board2);

  await addApp(page, 'SSHTerminal');
  await page.getByPlaceholder('Host').fill(host as string);
  await page.getByPlaceholder('Port').fill(port);
  // Chakra hides the native radio input behind a styled control; clicking the
  // label (a real click, which forwards activation to the input) is what actually
  // selects the stored credential.
  await expect(page.getByRole('radio', { name: credName })).toBeAttached({ timeout: 15_000 });
  await clickInApp(page.locator('label.chakra-radio', { hasText: credName }));
  await clickInApp(page.getByRole('button', { name: 'Connect' }));

  await expect(page.locator('.xterm')).toBeVisible({ timeout: 30_000 });
  await runCommand(page, 'echo reuse-$((5*5))');
  await expect(page.locator('.xterm-rows')).toContainText('reuse-25', { timeout: 15_000 });
});

test('renders ANSI colors (xterm-256color PTY)', async ({ page }) => {
  await freshBoard(page);
  await placeAndConnect(page, `e2e-color-${Date.now()}`);
  // Emit red text; with a 256-color PTY xterm renders SGR colors as foreground-class
  // spans (a vt100 PTY would render everything monochrome). tmux's own coloured
  // status bar also depends on this, so a coloured span proves the PTY negotiated colour.
  await runCommand(page, "printf '\\033[31mCOLORMARK\\033[0m\\n'");
  await expect(page.locator('.xterm-rows')).toContainText('COLORMARK', { timeout: 15_000 });
  await expect(page.locator('.xterm-rows span[class*="xterm-fg-"]').first()).toBeVisible({ timeout: 15_000 });
});

test('shows a clear error when the host is unreachable', async ({ page }) => {
  await freshBoard(page);
  await addApp(page, 'SSHTerminal');
  // Nothing listens on 2202 on the target; the backend's dial is refused.
  await connectWithNewKey(page, {
    host: host as string,
    port: '2202',
    user,
    key: privateKey,
    name: `e2e-unreach-${Date.now()}`,
  });
  await expect(page.getByText('Could not reach that host.')).toBeVisible({ timeout: 30_000 });
  // Still on the setup form — no terminal.
  await expect(page.locator('.xterm')).toHaveCount(0);
});

test('shows a clear error when authentication fails', async ({ page }) => {
  await freshBoard(page);
  await addApp(page, 'SSHTerminal');
  // Right host + key, but a username the key isn't authorized for -> auth failure.
  await connectWithNewKey(page, {
    host: host as string,
    port,
    user: 'wronguser',
    key: privateKey,
    name: `e2e-auth-${Date.now()}`,
  });
  await expect(page.getByText(/Authentication failed/i)).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.xterm')).toHaveCount(0);
});

test('input is gated to the controller (take control)', async ({ page }) => {
  await freshBoard(page);
  await placeAndConnect(page, `e2e-ctrl-${Date.now()}`);

  // The creator is a viewer, not the controller: the button is offered and typing
  // is ignored (input only relays from the controllerId).
  const takeControl = page.getByRole('button', { name: /take control/i });
  await expect(takeControl).toBeVisible();
  await page.locator('.xterm-helper-textarea').focus();
  await page.keyboard.type('echo BEFORE_$((1+1))');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  await expect(page.locator('.xterm-rows')).not.toContainText('BEFORE_2');

  // Taking control clears the button and lets input through.
  await clickInApp(takeControl);
  await expect(takeControl).toBeHidden();
  await page.locator('.xterm-helper-textarea').focus();
  await page.keyboard.type('echo AFTER_$((1+1))');
  await page.keyboard.press('Enter');
  await expect(page.locator('.xterm-rows')).toContainText('AFTER_2', { timeout: 15_000 });
});

test('reconnects to the session after leaving and re-entering the board', async ({ page }) => {
  const { room, board } = await freshBoard(page);
  await placeAndConnect(page, `e2e-recon-${Date.now()}`);
  await runCommand(page, 'echo FIRST_$((2+2))');
  await expect(page.locator('.xterm-rows')).toContainText('FIRST_4', { timeout: 15_000 });

  // Leave the board entirely (tears down the last viewer's connection), then return.
  await page.goto('/#/home');
  await expect(page).toHaveURL(/#\/home/);
  await enterRoom(page, room);
  await enterBoard(page, board);

  // The app persists its host state, so it re-mounts straight into the terminal and
  // the backend re-establishes SSH+tmux from the app's stored ownerId/credentialId,
  // reattaching to the SAME persistent tmux session. A brand-new xterm instance
  // showing the pre-existing "FIRST_4" output can only have come from the server
  // replaying the reattached session — proof the reconnect path works.
  await expect(page.locator('.xterm')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.xterm-rows')).toContainText('FIRST_4', { timeout: 30_000 });
});

test('a second viewer of the same terminal sees the output', async ({ page, browser }) => {
  await freshBoard(page);
  await placeAndConnect(page, `e2e-2v-${Date.now()}`);
  const boardUrl = page.url();
  await runCommand(page, 'echo VIEWER_$((7+8))');
  await expect(page.locator('.xterm-rows')).toContainText('VIEWER_15', { timeout: 15_000 });

  // A second browser session (same account) opens the same board; output relays to
  // every viewer, so B's fresh terminal replays the running tmux session.
  const ctxB = await browser.newContext({ ignoreHTTPSErrors: true });
  const pageB = await ctxB.newPage();
  try {
    await login(pageB);
    await pageB.goto(boardUrl);
    await expect(pageB.locator('.xterm')).toBeVisible({ timeout: 30_000 });
    await expect(pageB.locator('.xterm-rows')).toContainText('VIEWER_15', { timeout: 30_000 });
  } finally {
    await ctxB.close();
  }
});

test('control transfers between two users', async ({ page, browser }) => {
  test.skip(!process.env.SAGE3_USER2, 'SAGE3_USER2 / SAGE3_PASS2 required for the cross-user test');
  await freshBoard(page); // user A; the room is open-by-link so user B can join
  await placeAndConnect(page, `e2e-ct-${Date.now()}`);
  const boardUrl = page.url();
  await runCommand(page, 'echo AAA_$((1+1))'); // A takes control and drives
  await expect(page.locator('.xterm-rows')).toContainText('AAA_2', { timeout: 15_000 });

  const ctxB = await browser.newContext({ ignoreHTTPSErrors: true });
  const pageB = await ctxB.newPage();
  try {
    await login(pageB, creds2()); // a DIFFERENT user
    await pageB.goto(boardUrl);
    await expect(pageB.locator('.xterm')).toBeVisible({ timeout: 30_000 });

    // Control is per-user, so B is offered "Take control"; taking it strips A's control.
    const takeB = pageB.getByRole('button', { name: /take control/i });
    await expect(takeB).toBeVisible({ timeout: 15_000 });
    await clickInApp(takeB);
    await expect(takeB).toBeHidden();
    await expect(page.getByRole('button', { name: /take control/i })).toBeVisible({ timeout: 15_000 });

    // B can now drive the shell.
    await pageB.locator('.xterm-helper-textarea').focus();
    await pageB.keyboard.type('echo BBB_$((3+3))');
    await pageB.keyboard.press('Enter');
    await expect(pageB.locator('.xterm-rows')).toContainText('BBB_6', { timeout: 15_000 });
  } finally {
    await ctxB.close();
  }
});

test('connect with a passphrase-protected key', async ({ page }) => {
  const passKeyPath = process.env.SSH_TARGET_PASS_KEY_PATH;
  const passphrase = process.env.SSH_TARGET_PASSPHRASE;
  test.skip(!passKeyPath || !passphrase, 'SSH_TARGET_PASS_KEY_PATH / _PASSPHRASE must be set');
  const passKey = readFileSync(passKeyPath as string, 'utf8');

  await freshBoard(page);
  await addApp(page, 'SSHTerminal');
  await page.getByPlaceholder('Host').fill(host as string);
  await page.getByPlaceholder('Port').fill(port);
  if (!(await page.getByText('New SSH key').isVisible().catch(() => false))) {
    await clickInApp(page.getByRole('button', { name: /use a new key instead/i }));
  }
  await page.getByPlaceholder('Name (e.g. my-server-key)').fill(`e2e-pass-${Date.now()}`);
  await page.getByPlaceholder('Username').fill(user);
  await page.getByPlaceholder(/Private key \(paste the full contents/).fill(passKey);
  await page.getByPlaceholder('Passphrase (optional)').fill(passphrase as string);
  await clickInApp(page.getByRole('button', { name: 'Connect' }));

  await expect(page.locator('.xterm')).toBeVisible({ timeout: 30_000 });
  await runCommand(page, 'echo pass-$((4*4))');
  await expect(page.locator('.xterm-rows')).toContainText('pass-16', { timeout: 15_000 });
});
