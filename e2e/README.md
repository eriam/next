# SAGE3 E2E (Playwright)

Real-browser end-to-end tests that run against a **deployed** SAGE3 instance (staging by default),
capturing **video + screenshots** for every run. Intended to run from the shared petitprox E2E
runner and, eventually, as a post-deploy Jenkins stage.

## What it covers
- **`tests/smoke.spec.ts`** — login + landing.
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
teardown (`global-teardown.ts`), so the shared test account stays clean.

## Configuration (all via env)
| Var | Purpose | Default |
|-----|---------|---------|
| `BASE_URL` | target instance | `https://sage3-staging.mediavirtuel.com` |
| `SAGE3_USER` / `SAGE3_PASS` | LDAP login used by the tests | — (required) |
| `SSH_TARGET_HOST` / `_PORT` / `_USER` / `_KEY_PATH` | sshd target for the SSH spec | see below |

## Running
```bash
npm ci
npx playwright install --with-deps chromium      # first time only

export SAGE3_USER=e2e-test SAGE3_PASS=...         # dedicated LAB.LOCAL test account
export BASE_URL=https://sage3-staging.mediavirtuel.com

# SSH spec (optional): bring up the throwaway target (installs tmux in the container,
# which homebase needs), export what it prints
eval "$(npm run -s ssh-target:up)"
# Override SSH_TARGET_HOST with the runner's LAN IP so staging's homebase can reach it:
export SSH_TARGET_HOST=<runner-lan-ip>

npm test
npm run report        # open the HTML report (video + screenshots)
npm run ssh-target:down
```

## Notes for the runner / Jenkins
- The SSH target must be reachable from the **app backend** (homebase on the deploy host), not just
  from this runner — homebase makes the SSH connection. Expose it on the reserved `2200-2299` range
  and confirm the target host can dial `<runner-ip>:<port>`.
- Add an `/etc/hosts` pin (`<origin-ip> <domain>`) if you want to bypass CDN caching.
- The sshd target (`linuxserver/openssh-server`) ships without `tmux`; `ssh-target.sh up` installs
  it into the running container, because homebase runs the remote shell inside tmux.
- Artifacts land in `playwright-report/` and `test-results/` — archive both from Jenkins.
- All navigation and form selectors have been validated against live staging on the runner.
