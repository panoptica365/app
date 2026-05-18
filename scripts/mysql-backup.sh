#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Panoptica — MySQL Daily Backup
# Runs via cron at 02:00 daily.
# Dumps the panoptica database, gzip-compresses it, and
# removes backups older than 14 days.
# ─────────────────────────────────────────────────────────────

set -euo pipefail

# ── Configuration ──────────────────────────────────────────
BACKUP_DIR="/opt/panoptica/backups"
DB_NAME="${DB_NAME:-panoptica}"
DB_USER="${DB_USER:-panoptica}"
DB_PASS="${DB_PASS:-}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-3306}"
RETENTION_DAYS=14
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/${DB_NAME}_${TIMESTAMP}.sql.gz"
LOG_FILE="${BACKUP_DIR}/backup.log"

# ── Ensure backup directory exists ─────────────────────────
mkdir -p "${BACKUP_DIR}"

# ── Logging helper ─────────────────────────────────────────
log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "${LOG_FILE}"
}

# ── Run backup ─────────────────────────────────────────────
log "Starting backup of '${DB_NAME}' → ${BACKUP_FILE}"

if mysqldump \
  --host="${DB_HOST}" \
  --port="${DB_PORT}" \
  --user="${DB_USER}" \
  --password="${DB_PASS}" \
  --single-transaction \
  --routines \
  --triggers \
  --databases "${DB_NAME}" \
  2>>"${LOG_FILE}" \
  | gzip > "${BACKUP_FILE}"; then

  SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
  log "Backup completed successfully (${SIZE})"
else
  log "ERROR: mysqldump failed with exit code $?"
  exit 1
fi

# ── Prune old backups ──────────────────────────────────────
DELETED=$(find "${BACKUP_DIR}" -name "${DB_NAME}_*.sql.gz" -type f -mtime +${RETENTION_DAYS} -print -delete | wc -l)
if [ "${DELETED}" -gt 0 ]; then
  log "Pruned ${DELETED} backup(s) older than ${RETENTION_DAYS} days"
else
  log "No backups to prune"
fi

log "─── Backup run complete ───"
