#!/bin/bash
# =============================================================================
# panoptica_backup.sh
# Backs up /opt/panoptica to QNAP NAS share, purges backups older than 14 days
# =============================================================================

set -euo pipefail

# --- Configuration ---
NAS_SHARE="//192.168.11.11/panoptica_backups"
MOUNT_POINT="/mnt/qnap"
CREDENTIALS="/etc/samba/.qnap_creds"
SOURCE_DIR="/opt/panoptica"
RETENTION_DAYS=14
TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
BACKUP_DIR="${MOUNT_POINT}/${TIMESTAMP}"
LOG_PREFIX="[panoptica_backup]"

# --- Helpers ---
log()  { echo "${LOG_PREFIX} $(date '+%H:%M:%S') INFO  $*"; }
warn() { echo "${LOG_PREFIX} $(date '+%H:%M:%S') WARN  $*" >&2; }
die()  { echo "${LOG_PREFIX} $(date '+%H:%M:%S') ERROR $*" >&2; exit 1; }

# --- Pre-flight checks ---
log "Starting backup — source: ${SOURCE_DIR} → ${NAS_SHARE}/${TIMESTAMP}"

[[ $EUID -ne 0 ]] && die "This script must be run as root (use sudo)."
[[ ! -f "${CREDENTIALS}" ]] && die "Credentials file not found: ${CREDENTIALS}"
[[ ! -d "${SOURCE_DIR}" ]] && die "Source directory not found: ${SOURCE_DIR}"
[[ ! -d "${MOUNT_POINT}" ]] && die "Mount point not found: ${MOUNT_POINT}"

# Check if already mounted (e.g. from fstab), skip mount if so
if mountpoint -q "${MOUNT_POINT}"; then
    log "Share already mounted at ${MOUNT_POINT}, skipping mount step."
    MOUNTED_BY_SCRIPT=false
else
    log "Mounting ${NAS_SHARE} at ${MOUNT_POINT}..."
    mount -t cifs "${NAS_SHARE}" "${MOUNT_POINT}" \
        -o credentials="${CREDENTIALS}",vers=3.0,uid=1000,gid=1000 \
        || die "Mount failed. Check NAS availability and credentials."
    MOUNTED_BY_SCRIPT=true
    log "Mount successful."
fi

# --- Cleanup: ensure unmount happens even on failure ---
cleanup() {
    if [[ "${MOUNTED_BY_SCRIPT}" == true ]]; then
        log "Unmounting ${MOUNT_POINT}..."
        umount "${MOUNT_POINT}" && log "Unmounted successfully." \
            || warn "Unmount failed — you may need to run: sudo umount ${MOUNT_POINT}"
    fi
}
trap cleanup EXIT

# --- Create timestamped backup directory ---
log "Creating backup directory: ${BACKUP_DIR}"
mkdir -p "${BACKUP_DIR}" || die "Failed to create backup directory."

# --- Copy source to backup ---
log "Copying ${SOURCE_DIR} to ${BACKUP_DIR} (excluding node_modules)..."
rsync -a --no-links \
    --exclude='node_modules/' \
    --exclude='.npm/' \
    "${SOURCE_DIR}/" "${BACKUP_DIR}/" \
    || die "Copy failed. Backup may be incomplete."
log "Copy complete."

# --- Purge backups older than ${RETENTION_DAYS} days ---
log "Checking for backups older than ${RETENTION_DAYS} days..."

DELETED=0
while IFS= read -r -d '' old_dir; do
    # Safety check: only delete directories matching our YYYY-MM-DD_HH-MM-SS pattern
    dirname=$(basename "${old_dir}")
    if [[ "${dirname}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{2}-[0-9]{2}-[0-9]{2}$ ]]; then
        log "Deleting old backup: ${dirname}"
        rm -rf "${old_dir}"
        ((DELETED++))
    else
        warn "Skipping unexpected directory (pattern mismatch): ${dirname}"
    fi
done < <(find "${MOUNT_POINT}" -mindepth 1 -maxdepth 1 -type d \
         -not -name "@*" \
         -mtime +${RETENTION_DAYS} \
         -print0)

if [[ $DELETED -eq 0 ]]; then
    log "No old backups to purge."
else
    log "Purged ${DELETED} backup(s) older than ${RETENTION_DAYS} days."
fi

# --- Done (cleanup/unmount handled by trap) ---
log "Backup completed successfully: ${TIMESTAMP}"
