#!/usr/bin/env bash
#
# Throwaway sshd target for the SSH-terminal E2E test.
#
#   ssh-target.sh up     # generate a keypair + start an openssh container, print env exports
#   ssh-target.sh down   # stop the container and remove the scratch keys
#
# The container authorizes the generated public key for user $SSH_TARGET_USER.
# IMPORTANT: the app-under-test's BACKEND (homebase) must be able to reach this port, not just
# the runner. Pick any free port on the runner and confirm the
# SAGE3 backend host can dial <test-host-ip>:<port>.
#
set -euo pipefail

NAME="${SSH_TARGET_NAME:-sage3-e2e-sshd}"
PORT="${SSH_TARGET_PORT:-2222}"
USER_NAME="${SSH_TARGET_USER:-e2e}"
KEYDIR="${SSH_TARGET_KEYDIR:-$(cd "$(dirname "$0")/.." && pwd)/.ssh-target}"
KEY="$KEYDIR/id_e2e"

up() {
  mkdir -p "$KEYDIR"
  [ -f "$KEY" ] || ssh-keygen -t ed25519 -N '' -f "$KEY" -C 'sage3-e2e' >/dev/null
  # A passphrase-protected COPY of the same key. Same public key, so it's already
  # authorized on the target — lets a test exercise the passphrase code path.
  if [ ! -f "$KEY.pass" ]; then
    cp "$KEY" "$KEY.pass"
    ssh-keygen -p -f "$KEY.pass" -P '' -N 'e2e-passphrase' >/dev/null
  fi
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker run -d --name "$NAME" \
    -e PUID=1000 -e PGID=1000 -e TZ=UTC \
    -e USER_NAME="$USER_NAME" \
    -e "PUBLIC_KEY=$(cat "$KEY.pub")" \
    -p "${PORT}:2222" \
    linuxserver/openssh-server:latest >/dev/null
  # homebase runs the shell inside tmux on the remote host, so the target needs tmux.
  # The base image (Alpine) ships without it; install it into the running container.
  for _ in $(seq 1 30); do
    if docker exec "$NAME" apk add --no-cache tmux >/dev/null 2>&1; then break; fi
    sleep 1
  done
  # Wait for sshd to accept connections.
  for _ in $(seq 1 30); do
    if ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=2 \
         -i "$KEY" -p "$PORT" "$USER_NAME@127.0.0.1" true 2>/dev/null; then break; fi
    sleep 1
  done
  echo "export SSH_TARGET_HOST=127.0.0.1"        # override with the runner's LAN IP for homebase reachability
  echo "export SSH_TARGET_PORT=$PORT"
  echo "export SSH_TARGET_USER=$USER_NAME"
  echo "export SSH_TARGET_KEY_PATH=$KEY"
  echo "export SSH_TARGET_PASS_KEY_PATH=$KEY.pass"
  echo "export SSH_TARGET_PASSPHRASE=e2e-passphrase"
}

down() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  rm -rf "$KEYDIR"
  echo "sshd target removed"
}

case "${1:-}" in
  up) up ;;
  down) down ;;
  *) echo "usage: $0 up|down" >&2; exit 2 ;;
esac
