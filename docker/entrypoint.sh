#!/bin/sh
# Container entrypoint: prepares /data (the only place that must persist), creates first-run secrets if you
# did not provide them, then drops root and starts the app as the unprivileged "app" user.
set -eu
DATA_DIR="${DATA_DIR:-/data}"
mkdir -p "$DATA_DIR/workspaces" "$DATA_DIR/logs"

SECRETS="$DATA_DIR/.secrets"          # root-owned, mode 600: agent-run code (user "app") cannot read it from disk
gen() { node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"; }
touch "$SECRETS"; chmod 600 "$SECRETS"; chown root:root "$SECRETS"

# Only fill in what the operator did not set via Koyeb environment variables / secrets.
if [ -z "${SESSION_SECRET:-}" ]; then
  grep -q '^SESSION_SECRET=' "$SECRETS" || echo "SESSION_SECRET=$(gen)" >> "$SECRETS"
fi
if [ -z "${ENCRYPTION_KEY:-}" ]; then
  grep -q '^ENCRYPTION_KEY=' "$SECRETS" || echo "ENCRYPTION_KEY=$(gen)" >> "$SECRETS"
fi
# Environment variables you set in Koyeb always win; the file only supplies values you left unset.
for k in SESSION_SECRET ENCRYPTION_KEY; do
  eval "cur=\${$k:-}"
  if [ -z "$cur" ]; then v="$(grep "^$k=" "$SECRETS" | cut -d= -f2-)"; export "$k=$v"; fi
done

if [ -z "${INITIAL_ADMIN_PASSWORD:-}" ] && [ ! -f "${DATABASE_PATH:-$DATA_DIR/app.db}" ]; then
  INITIAL_ADMIN_PASSWORD="$(gen | cut -c1-20)"
  export INITIAL_ADMIN_PASSWORD
  echo "=============================================================="
  echo " FIRST RUN: no INITIAL_ADMIN_PASSWORD was set, so one was generated."
  echo "   username: ${INITIAL_ADMIN_USERNAME:-admin}"
  echo "   password: $INITIAL_ADMIN_PASSWORD"
  echo " Log in, then change it in Settings -> Account. This is shown once."
  echo "=============================================================="
fi

chown -R app:app "$DATA_DIR/workspaces" "$DATA_DIR/logs" 2>/dev/null || true
[ -f "${DATABASE_PATH:-$DATA_DIR/app.db}" ] && chown app:app "${DATABASE_PATH:-$DATA_DIR/app.db}"* 2>/dev/null || true
chown app:app "$DATA_DIR" 2>/dev/null || true

exec gosu app node dist/index.js
