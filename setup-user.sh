#!/bin/bash
# Setup user eriam on a fresh server
# Usage: ssh root@server 'bash -s' < setup-user.sh

set -euo pipefail

USERNAME="eriam"
SSH_KEY="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILcO7TgZ577tUikXasXiK0+lUz6puxYP35gKmqRVYCVN eriam@fedora"

# Create user if not exists
if ! id "$USERNAME" &>/dev/null; then
    useradd -m -s /bin/bash "$USERNAME"
    echo "User $USERNAME created."
else
    echo "User $USERNAME already exists."
fi

# Set random password
PASSWORD=$(openssl rand -base64 16)
echo "$USERNAME:$PASSWORD" | chpasswd
echo "Password set to: $PASSWORD"

# Add to sudo group
usermod -aG sudo "$USERNAME"

# Setup SSH key
SSH_DIR="/home/$USERNAME/.ssh"
AUTH_KEYS="$SSH_DIR/authorized_keys"

mkdir -p "$SSH_DIR"
chmod 700 "$SSH_DIR"

if ! grep -qF "$SSH_KEY" "$AUTH_KEYS" 2>/dev/null; then
    echo "$SSH_KEY" >> "$AUTH_KEYS"
    echo "SSH key added."
else
    echo "SSH key already present."
fi

chmod 600 "$AUTH_KEYS"
chown -R "$USERNAME:$USERNAME" "$SSH_DIR"

echo "Done. User $USERNAME is ready."
