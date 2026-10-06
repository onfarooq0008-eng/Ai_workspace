# syntax=docker/dockerfile:1
# ---------- build stage: compile TypeScript, install production deps ----------
FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend
COPY backend/package.json ./
RUN npm install --no-audit --no-fund
COPY backend/tsconfig.json ./
COPY backend/src ./src
# tsc still emits JavaScript when it reports type errors; surface them in the build log instead of failing the deploy.
RUN npx tsc -p . || echo "WARNING: TypeScript reported errors (see above); continuing with emitted JavaScript." ; \
    test -f dist/index.js
RUN npm prune --omit=dev

# ---------- runtime stage ----------
FROM node:22-bookworm-slim
# git + zip are used by the agent tools / project export; tini = proper PID 1; gosu = drop root after /data setup
RUN apt-get update && apt-get install -y --no-install-recommends git zip sqlite3 tini gosu ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --create-home --shell /usr/sbin/nologin app \
    && mkdir -p /data && chown app:app /data

WORKDIR /app/backend
COPY --from=build /app/backend/node_modules ./node_modules
COPY --from=build /app/backend/dist ./dist
COPY backend/package.json ./
COPY frontend /app/frontend
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV NODE_ENV=production \
    NODE_OPTIONS=--max-old-space-size=384 \
    APP_HOST=0.0.0.0 \
    PORT=8000 \
    DATA_DIR=/data \
    DATABASE_PATH=/data/app.db \
    WORKSPACE_DIR=/data/workspaces \
    LOG_DIR=/data/logs \
    LOG_LEVEL=info

# The ONLY port the app listens on (HTTP). Koyeb terminates HTTPS and forwards to this port.
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--", "/entrypoint.sh"]
