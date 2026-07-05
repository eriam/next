# SAGE3 SSH Terminal App — Design Spec

## Goal

Give SAGE3 a native app for connecting to a remote host over SSH and attaching to a persistent `tmux` session, providing a fully interactive terminal in the browser — real-time keystroke input and output, proper resize handling — rather than one-shot command execution.

This is the first real consumer of the credentials store's `sshPrivateKey` credential type (built as a separate, prior feature): a user's private key never has to be re-typed, never touches SAGE3's shared app state, and is only ever decrypted by one first-party integration handler, mirroring the pattern already established by the `ctfd` integration.

## Non-goals (explicitly out of scope for v1)

- **Multiple tmux panes/windows per app instance.** One app instance = one tmux session. Splitting a session into multiple panes from within the app is out of scope; users can still split panes manually from inside tmux itself once connected.
- **File transfer (SCP/SFTP).** This app is a terminal, not a file browser.
- **Session recording / audit logging of terminal content.** No transcript is stored beyond what tmux's own scrollback already keeps on the remote host.
- **Password-based SSH auth.** Only the `sshPrivateKey` credential type is supported in v1. Password auth (via the credentials store's existing `usernamePassword` type) can be added later without changing the connection architecture.
- **Jump-host / bastion chains.** Direct SSH to one host only.
- **Personal, per-viewer terminals.** See Architecture below — this is a deliberate, considered choice, not an oversight.

## Architecture

**App type:** A native SAGE3 app (`libs/applications/src/lib/apps/SSHTerminal/`), not a PluginApp. Unlike the CTFd integration (a genuine third-party system, built and deployed separately), SSH/tmux access is a first-party SAGE3 capability — it fits the same model as JupyterLab or SageCell: a native frontend paired with backend code that ships and is reviewed as part of SAGE3 itself. This also avoids inventing persistent-WebSocket and raw-keystroke-streaming support inside the PluginApp iframe protocol, which doesn't exist today and isn't a good fit for high-frequency terminal I/O.

**Sharing model.** SAGE3 apps are normally fully shared: everyone viewing a board sees identical app state. An SSH session is inherently tied to one connection, so this app keeps **one shared, collaborative terminal per app instance** rather than a private terminal per viewer:

- Whoever sets up the connection becomes its **owner**. The owner's stored credential is what's used to authenticate to the remote host, on every connection and every reconnection — never the identity of whichever browser happens to trigger the (re)connect.
- Every viewer of the board sees the **same live terminal output**, exactly like watching someone's screen together — this matches SAGE3's collaborative-canvas philosophy, and mirrors how `tmux attach` itself already lets multiple people share one remote session.
- Only one user has keystroke input at a time (the **controller**, tracked in app state). Anyone can take control at any moment via a "Take control" button — there's no permission gate and no automatic release when the controller navigates away. This keeps the model simple: with a single serial input stream, two people typing simultaneously would otherwise produce genuinely garbled, unrecoverable terminal input, not just a rare edge case.

**Connection lifecycle.** Homebase holds at most one live outbound SSH connection per app instance (keyed by `appId`), established via the `ssh2` npm library. The remote command is `tmux new -A -s sage3-<appId>` (attach-or-create) — tmux itself runs entirely on the remote host, so **no local PTY library is needed** on the homebase side at all; the PTY that matters is tmux's own, on the far end of the SSH channel.

If every browser WebSocket for an `appId` disconnects, homebase is free to drop the outbound SSH connection — there's no reason to hold it open with nobody watching. Reconnecting is cheap and lossless: the next viewer to open the app re-runs the exact same `tmux new -A -s <name>` command, which reattaches to the same session with scrollback and any running processes fully intact. This is the entire reason to use tmux here rather than a bare shell.

**A deliberate security exception, stated explicitly.** Every other consumer of the credentials store looks up a credential using the *calling* user's own id (`req.user.id`) as the ownership check. This app is the one place that doesn't: the credential lookup for a (re)connect always uses the **app's own stored `ownerId`** (the original setup user), not the id of whichever browser's WebSocket triggers the connection attempt. This is what makes the shared-terminal model possible — any viewer can cause a reconnect, but:
- they never see the credential's plaintext (only the one first-party handler ever does, exactly as elsewhere),
- they can't redirect the connection to a different host or credential (both are fixed in the app's own state at setup time, not supplied per-request), and
- the actual authorization boundary is "can this user see/interact with this SAGE3 app instance at all" — the same boundary that already gates every other shared piece of app state.

**Data flow, end to end:**
1. Browser opens a dedicated WebSocket to homebase (e.g. `wss://.../api/ssh/terminal?appId=...`), authenticated via the same session cookie every other homebase route already uses.
2. Homebase looks up the connection registry entry for that `appId`. If none exists yet, it establishes one: decrypt the stored credential (via `SBCredentialsDB.getDecryptedValue(credentialId, ownerId)` — the app's stored `ownerId`, per the exception above), `ssh2` connect, exec `tmux new -A -s sage3-<appId>`.
3. Remote stdout/stderr is broadcast to every browser WebSocket currently open for that `appId`.
4. Keystrokes arriving from the WebSocket belonging to the current `controllerId` are written to the remote session's stdin; keystrokes from anyone else are dropped server-side — this is enforced in the relay itself, not just hidden in the UI.
5. "Take control" is a plain `updateState({controllerId: myUserId})` call — no different from any other SAGE3 app state change.

## Data model

App state (`SSHTerminalState`, in `libs/shared` alongside other app state types):

```typescript
type SSHTerminalState = {
  host: string;
  port: number;
  credentialId: string;   // an sshPrivateKey-type credential, owned by ownerId below
  ownerId: string;        // the user whose credential is used on every (re)connect
  controllerId?: string;  // who currently has keystroke input; undefined = read-only for everyone
  connected: boolean;     // best-effort status flag for the UI
};
```

`connected` is written by the frontend, like every other field here — homebase never writes app state directly (no SAGE3 app does). The frontend receives `status` messages over the WebSocket (see below) and translates them into ordinary `updateState({connected: ...})` calls, the same way it already handles `host`/`port`/`credentialId` on setup.
```

Before setup completes, `host`/`credentialId`/`ownerId` are empty/unset and the app renders its setup form instead of a terminal.

## First-party integration: `ssh`

New router, `apps/homebase/src/api/routers/custom/integrations/ssh.ts`, mounted at `/api/integrations/ssh`, mirroring the `ctfd` integration's shape exactly:

| Method | Path | Body |
|---|---|---|
| `POST` | `/api/integrations/ssh/connect` | `{host, port, credentialId}` **or** `{host, port, newCredential: {name, value: {type: 'sshPrivateKey', username, privateKey, passphrase?}}}` |

Unlike `ctfd`, this call doesn't just validate — it *is* the actual connection setup. On success, homebase registers the new live connection (host, port, decrypted key material held only in-process, `ownerId` = `req.user.id`) in the per-`appId` connection registry, and the caller's subsequent `updateState({host, port, credentialId, ownerId, connected: true})` is what other viewers see. On failure, it returns a specific, non-secret error and nothing is registered or persisted:

- `auth_failed` — the SSH handshake completed but authentication was rejected.
- `unreachable` — the host/port could not be reached at all.
- `tmux_failed` — SSH authenticated, but the remote `tmux new -A -s ...` command itself failed (e.g. tmux isn't installed on the remote host).
- `credential_unavailable` — the stored credential (an existing `credentialId`, not a fresh `newCredential`) failed to decrypt (`CredentialDecryptionError`), matching the generic, non-stack-trace message the `ctfd` handler already establishes as the pattern for this exact failure mode.

If this was a `newCredential`, it's only persisted (via `SBCredentialsDB.createOrUpdate`) after the SSH handshake and the `tmux new` command both succeed — a bad key or bad host never gets saved, same principle as the `ctfd` handler's "don't persist on failure" rule.

## WebSocket protocol (`/api/ssh/terminal`)

A new WebSocket route in homebase, alongside the existing `apiWebSocketServer`/`logsServer` upgrade handling in `main.ts`. Messages, both directions, are small JSON envelopes:

- Client → server: `{type: 'input', data: string}` (raw keystrokes, only honored if the sender is the current `controllerId`), `{type: 'resize', cols: number, rows: number}` (triggers an SSH window-change request to the remote PTY).
- Server → client: `{type: 'output', data: string}` (raw remote stdout/stderr, broadcast to every connected viewer for this `appId`), `{type: 'status', connected: boolean, error?: string}` (connection state changes — e.g. a network blip disconnected the SSH session and homebase is retrying).

On an unexpected SSH-level disconnect (not a client closing their tab, but the underlying connection itself dropping), homebase broadcasts a `status` message, attempts to reconnect using the same stored `ownerId`/`credentialId`/`host`/`port` (the exact same first-party connect logic, just triggered internally rather than via the REST call), and broadcasts another `status` update once it succeeds or exhausts a small retry budget.

## Frontend

The app renders `xterm.js` (with its `fit` addon) inside its own canvas — the standard browser terminal emulator, also used by VS Code and Hyper. Remote `output` messages are piped directly into `terminal.write()`. If `state.controllerId === myUserId`, keystrokes captured via `terminal.onData()` are sent as `input` messages. The `fit` addon recomputes rows/cols on any resize of the app's canvas element, and a `resize` message is sent so the remote PTY (and tmux's own internal layout) stays in sync with the actual browser window size.

Before `state.host` is set, the canvas shows a setup form instead: host, port (default 22), and a credential picker scoped to `type=sshPrivateKey`, via a new `useCredentials` hook in `libs/frontend` (parallel in spirit to the one already built for the CTFd-SAGE plugin, but living in the monorepo since this is a native app, not a separately-built plugin). Submitting the form calls `POST /api/integrations/ssh/connect`; on success the app calls `updateState(...)` with the now-live connection's details, and the canvas switches to the terminal view.

A small "Take control" button is shown to any viewer who isn't the current controller; clicking it is a plain state update, nothing more.

## Error handling

- Setup-time failures (`auth_failed`, `unreachable`, `tmux_failed`, `credential_unavailable`) are shown directly in the setup form — the user can just fix the field and retry, no partial state was ever saved.
- A mid-session SSH disconnect surfaces as a `status` WebSocket message; the frontend shows a brief "Reconnecting..." indicator rather than clearing the terminal, since tmux's own scrollback means nothing is actually lost — homebase's reconnect just needs to catch up.
- A `CredentialDecryptionError` during any reconnect attempt (not just initial setup) surfaces the same generic `credential_unavailable` status — never a raw stack trace — and stops automatic retries (a corrupted stored credential won't fix itself), requiring the owner to re-enter their key via the setup form again.

## Testing

Mirroring the depth established for the credentials store (unit + real-dependency integration tests, not mocks-only):

- Connection-registry unit tests (mocked `ssh2`): connect/disconnect lifecycle, reconnect reuses the stored owner's credential, dropped-connection retry logic.
- `ssh.spec.ts` (REST connect handler, real Express + supertest, mocked `ssh2` for the actual network call — mirroring `ctfdIntegration.integration.spec.ts`'s structure): successful connect, each of the four error cases, "new credential, failed connect" doesn't get persisted.
- WebSocket relay tests: output is broadcast to every connected client for an `appId`; input from a non-controller is dropped; input from the controller reaches the mocked `ssh2` stream; a `resize` message triggers the expected SSH window-change call.
- Frontend: xterm.js output rendering from mocked WebSocket messages, take-control button toggling `controllerId` via `updateState`, resize triggering a `resize` message.
