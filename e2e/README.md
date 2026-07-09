# SAGE3 E2E (Playwright)

Real-browser end-to-end tests that run against a **deployed** SAGE3 instance (staging by default),
capturing **video + screenshots** for every run. Intended to run from the shared petitprox E2E
runner and, eventually, as a post-deploy Jenkins stage.

## What it covers
- **`tests/credentials.spec.ts`** — add an SSH-key credential in the settings UI, see it listed
  (value never shown), delete it. Self-cleaning.
- **`tests/ssh-terminal.spec.ts`** — place the SSHTerminal app, connect to a real sshd target,
  run `whoami`, assert real output. Skipped unless an SSH target is provided.

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

# SSH spec (optional): bring up the throwaway target, export what it prints
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
- Artifacts land in `playwright-report/` and `test-results/` — archive both from Jenkins.
- A few **navigation** selectors (create/enter board, open the app menu) are marked `TODO(runner)`
  and should be validated on the first live run; the form-level selectors are taken verbatim from
  the components and should be stable.
