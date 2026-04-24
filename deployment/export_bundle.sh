#!/bin/bash

set -e

EXPORT_DIR="exported_bundle"
COMPOSE_FILE="docker-compose-simple.yml"
ENV_FILE=".env"
CONFIG_DIR="configurations"
ELECTRON="../webstack/clients/electron/SAGE3-linux-x64.tar.gz"
IMAGE_MAP_FILE="$EXPORT_DIR/image-map.txt"
EXPORT_TAR="$EXPORT_DIR/sage-images.tar"
IMPORT_SCRIPT="$EXPORT_DIR/import_images.sh"
TMP_COMPOSE="$EXPORT_DIR/docker-compose.yml"

# Create export directory
mkdir -p "$EXPORT_DIR"
rm -f "$IMAGE_MAP_FILE"

# Copy .env if it exists
if [ -f "$ENV_FILE" ]; then
  cp "$ENV_FILE" "$EXPORT_DIR/"
fi

# Copy configurations folder if it exists
if [ -d "$CONFIG_DIR" ]; then
  cp -r "$CONFIG_DIR" "$EXPORT_DIR/"
fi

# Copy electron client folder if it exists
if [ -d "$ELECTRON" ]; then
  cp -r "$ELECTRON" "$EXPORT_DIR/"
fi

echo "[+] Parsing image names from $COMPOSE_FILE"
IMAGES=($(docker compose -f "$COMPOSE_FILE" config | grep image: | awk '{print $2}'))
COUNTER=1
TAGS=()

# Prepare a modified docker-compose with sage-XX tags
cp "$COMPOSE_FILE" "$TMP_COMPOSE"

for IMAGE in "${IMAGES[@]}"; do
  TAG=$(printf "sage-%02d" $COUNTER)
  echo "  - $IMAGE → $TAG"
  docker pull "$IMAGE" >/dev/null 2>&1
  docker tag "$IMAGE" "$TAG"
  TAGS+=("$TAG")
  echo "$TAG → $IMAGE" >> "$IMAGE_MAP_FILE"
  # Update compose file
  sed -i "s|$IMAGE|$TAG|g" "$TMP_COMPOSE"
  ((COUNTER++))
done

echo "[+] Saving images to $EXPORT_TAR"
docker save -o "$EXPORT_TAR" "${TAGS[@]}"

echo "[+] Cleaning temporary tags..."
for TAG in "${TAGS[@]}"; do
  docker rmi "$TAG" >/dev/null 2>&1 || true
done

# Create import script
cat > "$IMPORT_SCRIPT" <<EOF
#!/bin/bash
echo "[+] Loading Docker images from sage-images.tar..."
docker load -i sage-images.tar
echo "[✓] Done. You can now run: docker compose up -d"
EOF
chmod +x "$IMPORT_SCRIPT"

echo "[✓] Bundle created in ./$EXPORT_DIR"

