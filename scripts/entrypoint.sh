#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
#  Panoptica365 — Container Entrypoint
# ═══════════════════════════════════════════════════════════════════
#
# Runs every time the panoptica-app container starts. Three phases:
#   1. Wait for MySQL to be reachable (compose depends_on can't see
#      "MySQL is actually accepting connections" — only "container
#      created").
#   2. Apply schema migrations (idempotent — schema.sql uses
#      CREATE … IF NOT EXISTS everywhere, and init-schema.js skips
#      the seed step if alert_policies already has rows).
#   3. Exec into `node src/server.js`. `exec` replaces this shell
#      with node so signals (SIGTERM from `docker stop`) reach the
#      app's graceful-shutdown handlers cleanly.
#
# This script is only invoked inside the container. The native
# production install still uses `pm2 start src/server.js`.
# ═══════════════════════════════════════════════════════════════════

set -euo pipefail

DB_HOST="${DB_HOST:-panoptica-db}"
DB_PORT="${DB_PORT:-3306}"
WAIT_TIMEOUT_SECONDS=120

# ─── Phase 1: wait for MySQL ────────────────────────────────────────
echo "[entrypoint] Waiting for MySQL at ${DB_HOST}:${DB_PORT} (up to ${WAIT_TIMEOUT_SECONDS}s)..."
elapsed=0
until nc -z "${DB_HOST}" "${DB_PORT}" 2>/dev/null; do
    if [ "${elapsed}" -ge "${WAIT_TIMEOUT_SECONDS}" ]; then
        echo "[entrypoint] ERROR: MySQL did not become reachable within ${WAIT_TIMEOUT_SECONDS}s."
        echo "[entrypoint] Check the panoptica-db container's logs:"
        echo "[entrypoint]   docker compose logs panoptica-db"
        exit 1
    fi
    sleep 1
    elapsed=$((elapsed + 1))
done
echo "[entrypoint] MySQL is reachable (${elapsed}s)."

# ─── Phase 2: schema migrations ─────────────────────────────────────
# init-schema.js is idempotent: applies schema.sql (CREATE … IF NOT EXISTS
# throughout), and seeds alert_policies only if the table is empty.
# A failure here is fatal — the app can't run against a missing schema.
echo "[entrypoint] Applying database schema (idempotent)..."
node src/db/init-schema.js
echo "[entrypoint] Schema ready."

# ─── Phase 3: hand off to node ──────────────────────────────────────
# `exec` so node becomes PID 1 and receives SIGTERM directly from
# `docker stop`. src/server.js has SIGINT + SIGTERM handlers that stop
# the polling engine, drift schedulers, UAL worker, and apply-jobs
# worker before closing the DB pool — graceful shutdown is wired.
echo "[entrypoint] Starting Panoptica365..."
exec node src/server.js
