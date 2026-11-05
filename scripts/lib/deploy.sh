# Shared settings for deploying this monorepo to the house NAS.
# The API and the Home automation page each have their own script.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NAS_HOST="${NAS_HOST:-root@192.168.1.3}"
NAS_DIR="${NAS_DIR:-/mnt/Data/apps/home-automation}"
API_IMAGE="${API_IMAGE:-home-automation-api:1.0.0}"
APP_IMAGE="${APP_IMAGE:-home-automation:1.0.0}"
IX_APP_DIR="${IX_APP_DIR:-/mnt/.ix-apps/app_configs/home-automation-api/versions/1.0.0}"

# Copy the repo to the NAS. The NAS .env and data directory stay where they are.
sync_repo() {
  ssh -o BatchMode=yes -o ConnectTimeout=8 "$NAS_HOST" "mkdir -p '$NAS_DIR/data/wattsonic/days'"
  rsync -az --delete \
    --exclude '.git/' \
    --exclude 'node_modules/' \
    --exclude '.pnpm-store/' \
    --exclude 'dist/' \
    --exclude 'build/' \
    --exclude '.env' \
    --exclude 'data/' \
    --exclude 'apps/evcc/' \
    "$ROOT/" "$NAS_HOST:$NAS_DIR/"
}
