#!/bin/bash
# Ansible-like server admin powered by Claude Code (runs locally, executes via SSH)
# Usage: ./claude-admin.sh <server-name|server-ip> [task description]
# Example: ./claude-admin.sh ctfd "installe fail2ban, ufw, sécurise SSH"
# Example: ./claude-admin.sh 192.168.1.50 "installe fail2ban, ufw, sécurise SSH"

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INVENTORY="$SCRIPT_DIR/inventory.conf"

INPUT="${1:?Usage: $0 <server-name|server-ip> [task description]}"
TASK="${2:-}"

# Resolve server: IP used directly, short name looked up in inventory, FQDN used directly
if [[ "$INPUT" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    SERVER="$INPUT"
elif [[ "$INPUT" == *.* ]]; then
    # Looks like a FQDN — use directly, SSH connectivity check below will validate
    SERVER="$INPUT"
else
    if [ ! -f "$INVENTORY" ]; then
        echo "ERROR: Inventory file not found: $INVENTORY"
        exit 1
    fi
    SERVER=$(grep -E "^${INPUT}=" "$INVENTORY" | cut -d= -f2 || true)
    if [ -z "$SERVER" ]; then
        echo "ERROR: Server '$INPUT' not found in inventory. Available:"
        grep -E '^[a-zA-Z]' "$INVENTORY" | grep -v '^#' | cut -d= -f1 | sed 's/^/  /'
        exit 1
    fi
fi

# Verify SSH access
if ! ssh -o ConnectTimeout=5 eriam@"$SERVER" true 2>/dev/null; then
    echo "ERROR: Cannot SSH to eriam@$SERVER"
    exit 1
fi

SYSTEM_PROMPT="Tu es un administrateur système Debian expert.
Tu gères le serveur distant $SERVER via SSH en tant que user eriam (qui a sudo).

RÈGLES:
- Pour exécuter une commande sur le serveur, utilise: ssh eriam@$SERVER '<commande>'
- Pour les commandes nécessitant root, utilise: ssh eriam@$SERVER 'sudo <commande>'
- Sois idempotent : vérifie avant d'agir, ne casse pas ce qui fonctionne
- Montre ce que tu fais et confirme le résultat
- Commence par un état des lieux (hostname, OS, services actifs)"

if [ -n "$TASK" ]; then
    claude --system-prompt "$SYSTEM_PROMPT" "$TASK"
else
    claude --system-prompt "$SYSTEM_PROMPT"
fi
