# SAGE3 E2E (Playwright)

Real-browser end-to-end tests that run against a **running** SAGE3 instance (a local
dev server by default, or any deployed one), capturing **video + screenshots** for
every run.

## What it covers
- **`tests/smoke.spec.ts`** — login + first-login account creation + a room round-trip
  through the WebSocket/SAGEBase backend.
- **`tests/rooms.spec.ts`** / **`tests/boards.spec.ts`** — room and board create/enter flows.
- **`tests/apps.spec.ts`** — SSHTerminal is offered in the Applications menu; the Credentials
  tab is present in user Settings.
- **`tests/credentials.spec.ts`** — add each credential type (ssh key / secret / user-pass) in
  the settings UI, see it listed (secret value never shown), delete it, cancel add, cancel delete,
  and the Add-button validation gate. Each test self-cleans.
- **`tests/ssh-terminal.spec.ts`** — real SSH end-to-end against a throwaway sshd target: connect
  with a new key and run a command (asserts remotely-computed output), connect by picking an
  existing stored credential, ANSI colour rendering (xterm-256color PTY), unreachable-host and
  auth-failure error paths, controller input gating (take control), and reconnect-on-re-enter
  (reattaches the persistent tmux session). Skipped unless an SSH target is provided.

Rooms and stored `e2e-*` credentials created during a run are swept afterwards by the global
teardown (`global-teardown.ts`), so the test account stays clean.

## Configuration (all via env)
| Var | Purpose | Default |
|-----|---------|---------|
| `BASE_URL` | target instance | `http://localhost:4200` |
| `SAGE3_AUTH` | login strategy: `guest` or `ldap` | `guest` |
| `SAGE3_USER` / `SAGE3_PASS` | credentials (required only for `SAGE3_AUTH=ldap`) | — |
| `SLOWMO_MS` | per-action delay; keep ≥ 120 (0 races the UI's open animations) | `500` |
| `SSH_TARGET_HOST` / `_PORT` / `_USER` / `_KEY_PATH` | sshd target for the SSH spec | see below |

## Running
```bash
npm ci
npx playwright install --with-deps chromium      # first time only

# Point at a running SAGE3 instance (a local `yarn start` dev server, or a deployed one).
export BASE_URL=http://localhost:4200
# For an LDAP/AD instance instead of guest:
#   export SAGE3_AUTH=ldap SAGE3_USER=... SAGE3_PASS=...

# SSH spec (optional): bring up the throwaway target (installs tmux in the container,
# which homebase needs) and export what it prints.
eval "$(npm run -s ssh-target:up)"
# If homebase runs on a different host/container than this one, override SSH_TARGET_HOST
# with an address it can dial (e.g. this machine's LAN IP), not 127.0.0.1.
#   export SSH_TARGET_HOST=<lan-ip>

npm test
npm run report        # open the HTML report (video + screenshots)
npm run ssh-target:down
```

## Notes
- The SSH target must be reachable from the **SAGE3 backend** (homebase), not just from the
  machine running the tests — homebase makes the SSH connection.
- The sshd target image (`linuxserver/openssh-server`) ships without `tmux`; `ssh-target.sh up`
  installs it into the running container, because homebase runs the remote shell inside tmux.
- These specs mutate shared server state, so they run serially (`workers: 1`).
- Artifacts land in `playwright-report/` and `test-results/`.
