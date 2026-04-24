#!/bin/bash
# Deploy Sage3 with LDAP/AD support to Docker Hub and update the server
# Usage: ./deploy.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER="172.31.1.26"
DOCKER_USER="eriamschaffter"
REMOTE_DIR="/opt/sage3"

echo "=== Sage3 LDAP/AD Deployment ==="

# Image mapping: local name -> Docker Hub name
declare -A IMAGES=(
    ["sage-01"]="sage3-chromadb"
    ["sage-02"]="sage3-fluentd"
    ["sage-03"]="sage3-jupyter"
    ["sage-04"]="sage3-kernelserver"
    ["sage-06"]="sage3-redis"
)
# sage-05 (node-server) gets a custom build with LDAP

# Step 1: Build custom node-server with LDAP support on the server
echo ""
echo "[1/4] Building custom node-server with LDAP on $SERVER..."
scp "$SCRIPT_DIR/node-server-ldap/Dockerfile" eriam@$SERVER:/tmp/Dockerfile-ldap
scp "$SCRIPT_DIR/node-server-ldap/LDAPAdapter.js" eriam@$SERVER:/tmp/LDAPAdapter.js
scp "$SCRIPT_DIR/node-server-ldap/patch-auth.sh" eriam@$SERVER:/tmp/patch-auth.sh

ssh eriam@$SERVER "
    mkdir -p /tmp/sage3-ldap-build
    cp /tmp/Dockerfile-ldap /tmp/sage3-ldap-build/Dockerfile
    cp /tmp/LDAPAdapter.js /tmp/sage3-ldap-build/LDAPAdapter.js
    cp /tmp/patch-auth.sh /tmp/sage3-ldap-build/patch-auth.sh
    cd /tmp/sage3-ldap-build
    docker build -t sage3-node-ldap:latest .
"
echo "  -> Custom node-server built successfully"

# Step 2: Tag all images for Docker Hub
echo ""
echo "[2/4] Tagging images for Docker Hub..."
for local_name in "${!IMAGES[@]}"; do
    hub_name="${IMAGES[$local_name]}"
    ssh eriam@$SERVER "docker tag $local_name:latest $DOCKER_USER/$hub_name:latest"
    echo "  $local_name -> $DOCKER_USER/$hub_name:latest"
done
ssh eriam@$SERVER "docker tag sage3-node-ldap:latest $DOCKER_USER/sage3-node:latest"
echo "  sage3-node-ldap -> $DOCKER_USER/sage3-node:latest"

# Step 3: Push to Docker Hub
echo ""
echo "[3/4] Pushing images to Docker Hub..."
for hub_name in "${IMAGES[@]}"; do
    echo "  Pushing $DOCKER_USER/$hub_name:latest..."
    ssh eriam@$SERVER "docker push $DOCKER_USER/$hub_name:latest"
done
echo "  Pushing $DOCKER_USER/sage3-node:latest..."
ssh eriam@$SERVER "docker push $DOCKER_USER/sage3-node:latest"

# Step 4: Deploy updated docker-compose
echo ""
echo "[4/4] Deploying updated docker-compose.yml..."
scp "$SCRIPT_DIR/docker-compose.yml" eriam@$SERVER:$REMOTE_DIR/docker-compose.yml

echo ""
echo "=== Done ==="
echo ""
echo "Next steps:"
echo "  1. Update sage3-prod.hjson on the server to add ldapConfig"
echo "  2. Restart: ssh eriam@$SERVER 'cd $REMOTE_DIR && docker compose down && docker compose up -d'"
