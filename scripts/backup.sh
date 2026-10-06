#!/usr/bin/env bash
# Manual / cron backup. Usage: scripts/backup.sh [--include-keys]
# Backs up the SQLite DB (consistent snapshot), settings, and project workspaces. Encrypted API keys are
# blanked unless --include-keys is passed. Your .env (session/encryption secrets) is never included.
set -euo pipefail
APP_DIR="${APP_DIR:-/opt/ai-agent}"
OUT_DIR="$APP_DIR/backups"; TS=$(date +%Y%m%d-%H%M%S); TMP=$(mktemp -d)
mkdir -p "$OUT_DIR"
sqlite3 "$APP_DIR/backend/data/app.db" ".backup '$TMP/app.db'"
if [ "${1:-}" != "--include-keys" ]; then
  sqlite3 "$TMP/app.db" "UPDATE providers SET api_key_encrypted=''; DELETE FROM sessions; DELETE FROM api_tokens;"
fi
( cd "$APP_DIR/backend/workspaces" && zip -r -q "$TMP/projects.zip" . -x "*/node_modules/*" ) || true
( cd "$TMP" && zip -r -q "$OUT_DIR/backup-$TS.zip" . )
rm -rf "$TMP"
echo "Backup written to $OUT_DIR/backup-$TS.zip"
