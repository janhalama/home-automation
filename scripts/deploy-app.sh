#!/usr/bin/env bash
# Build the Home automation page on the NAS and publish it on port 4321.

set -euo pipefail

source "$(cd "$(dirname "$0")" && pwd)/lib/deploy.sh"

sync_repo

ssh -o BatchMode=yes -o ConnectTimeout=8 "$NAS_HOST" \
  "cd '$NAS_DIR' && APP_IMAGE='$APP_IMAGE' docker compose -p home-automation -f apps/energy-view/docker-compose.yml up -d --build --force-recreate"

echo "Home automation is on http://192.168.1.3:4321"
