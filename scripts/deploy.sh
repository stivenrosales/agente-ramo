#!/usr/bin/env bash
# deploy.sh — Build Docker image locally, ship it to the VPS, load it.
#
# After this script runs, the image is available in the VPS's local Docker.
# In EasyPanel:
#   • First time: create a new service "From Image" pointing to ${IMAGE_NAME}:${IMAGE_TAG}
#   • Subsequent runs: click "Redeploy" on the service to pick up the new image
#
# Usage:
#   ./scripts/deploy.sh              # deploys as :latest
#   ./scripts/deploy.sh v0.2.0       # deploys as :v0.2.0

set -euo pipefail

# ─── Configuration ───────────────────────────────────────────────────────────
IMAGE_NAME="fitnessspace-agent"
IMAGE_TAG="${1:-latest}"
VPS_USER="ubuntu"
VPS_HOST="ec2-54-235-78-205.compute-1.amazonaws.com"
SSH_KEY="${HOME}/.ssh/instance_key_non_NV.pem"
TARGET_PLATFORM="linux/amd64"

TARBALL_NAME="${IMAGE_NAME}_${IMAGE_TAG}.tar.gz"
LOCAL_TARBALL="/tmp/${TARBALL_NAME}"
REMOTE_TARBALL="/tmp/${TARBALL_NAME}"

# ─── Prechecks ───────────────────────────────────────────────────────────────
command -v docker >/dev/null 2>&1 || { echo "❌ docker not installed"; exit 1; }
docker info >/dev/null 2>&1 || { echo "❌ Docker daemon not running. Start Docker Desktop and retry."; exit 1; }
[[ -f "${SSH_KEY}" ]] || { echo "❌ SSH key not found at ${SSH_KEY}"; exit 1; }

# ─── Cleanup trap ────────────────────────────────────────────────────────────
cleanup() {
  [[ -f "${LOCAL_TARBALL}" ]] && rm -f "${LOCAL_TARBALL}"
}
trap cleanup EXIT

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " Deploying ${IMAGE_NAME}:${IMAGE_TAG} → ${VPS_HOST}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ─── Step 1: Build for linux/amd64 (VPS architecture) ───────────────────────
echo "🔨  [1/4] Building Docker image (platform: ${TARGET_PLATFORM})..."
docker build --platform "${TARGET_PLATFORM}" -t "${IMAGE_NAME}:${IMAGE_TAG}" .
echo ""

# ─── Step 2: Save to compressed tarball ─────────────────────────────────────
echo "📦  [2/4] Saving image to tarball..."
docker save "${IMAGE_NAME}:${IMAGE_TAG}" | gzip > "${LOCAL_TARBALL}"
SIZE=$(du -h "${LOCAL_TARBALL}" | cut -f1)
echo "     Tarball size: ${SIZE}"
echo ""

# ─── Step 3: Upload to VPS via scp ──────────────────────────────────────────
echo "📤  [3/4] Uploading to ${VPS_HOST}..."
scp -i "${SSH_KEY}" -o StrictHostKeyChecking=accept-new "${LOCAL_TARBALL}" "${VPS_USER}@${VPS_HOST}:${REMOTE_TARBALL}"
echo ""

# ─── Step 4: Load image on VPS and clean up remote tarball ──────────────────
echo "🚀  [4/4] Loading image on VPS..."
ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=accept-new "${VPS_USER}@${VPS_HOST}" \
  "gunzip -c ${REMOTE_TARBALL} | sudo docker load && rm ${REMOTE_TARBALL}"
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " ✅ Deploy complete — image loaded on VPS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Next steps:"
echo "  • FIRST DEPLOY:  crear servicio en EasyPanel → 'From Image' → ${IMAGE_NAME}:${IMAGE_TAG}"
echo "  • UPDATES:       click 'Redeploy' en el servicio de EasyPanel"
echo ""
