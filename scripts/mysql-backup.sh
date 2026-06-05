#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Panoptica — MySQL Daily Backup
# Runs via cron at 02:00 daily.
# Dumps the panoptica database, gzip-compresses it, and
# keeps only the most recent KEEP_BACKUPS dumps locally. Off-box copies
# live on the QNAP (and QNAP cloud), so we don't hoard them on the box —
# each dump is ~3 GB and a 14-deep pile filled the disk (2026-06-04).
# ─────────────────────────────────────────────────────────────

set -euo pipefail

# ── Configuration ──────────────────────────────────────────
BACKUP_DIR="/opt/panoptica/backups"
DB_NAME="${DB_NAME:-panoptica}"
DB_USER="${DB_USER:-panoptica}"
DB_PASS="${DB_PASS:-}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-3306}"
KEEP_BACKUPS=3        # how many of the most recent local dumps to retain
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

# ── Prune old backups — keep only the newest KEEP_BACKUPS ──
# Count-based (not age-based) so the local footprint is bounded no matter how
# often the job runs. Newest-first by mtime; delete everything past KEEP_BACKUPS.
mapfile -t ALL_BACKUPS < <(find "${BACKUP_DIR}" -maxdepth 1 -type f -name "${DB_NAME}_*.sql.gz" -printf '%T@ %p\n' | sort -rn | cut -d' ' -f2-)
if [ "${#ALL_BACKUPS[@]}" -gt "${KEEP_BACKUPS}" ]; then
  for old in "${ALL_BACKUPS[@]:KEEP_BACKUPS}"; do
    rm -f "${old}"
    log "Pruned old backup: $(basename "${old}")"
  done
  log "Kept the newest ${KEEP_BACKUPS} backup(s)"
else
  log "No backups to prune (${#ALL_BACKUPS[@]} present, keeping up to ${KEEP_BACKUPS})"
fi

log "─── Backup run complete ───"
