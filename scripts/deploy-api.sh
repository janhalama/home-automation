#!/usr/bin/env bash
# Build the API image on the NAS and recreate the TrueNAS custom app.
# Loxone cannot read the forecast during the recreate.

set -euo pipefail

source "$(cd "$(dirname "$0")" && pwd)/lib/deploy.sh"

sync_repo

ssh -o BatchMode=yes -o ConnectTimeout=8 "$NAS_HOST" \
  "cd '$NAS_DIR' && docker build -f apps/home-automation-api/Dockerfile -t '$API_IMAGE' ."

ssh -o BatchMode=yes -o ConnectTimeout=8 "$NAS_HOST" \
  "NAS_DIR='$NAS_DIR' IX_APP_DIR='$IX_APP_DIR' python3 -" \
  < "$ROOT/scripts/lib/patch-api-compose.py"

ssh -o BatchMode=yes -o ConnectTimeout=8 "$NAS_HOST" \
  "docker compose -p ix-home-automation-api -f '$IX_APP_DIR/templates/rendered/docker-compose.yaml' up -d --force-recreate --no-deps api"

if ! ssh -o BatchMode=yes -o ConnectTimeout=8 "$NAS_HOST" "grep -q '^LOXONE_HOST=' '$NAS_DIR/.env'"; then
  echo "NAS .env has no LOXONE_HOST, so heater samples stay off. Spot prices are still stored."
fi

echo "API is on http://192.168.1.3:3001"
