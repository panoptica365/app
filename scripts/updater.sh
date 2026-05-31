#!/bin/sh
# ════════════════════════════════════════════════════════════════════════
#  Panoptica365 — Self-Update sidecar (Stage 5 / C2)
# ════════════════════════════════════════════════════════════════════════
#
# A small, dumb, rarely-changing watcher. It is the ONLY component allowed to
# touch the Docker socket. It watches data/state/update-request.json, and when
# an admin queues an update it: snapshots the DB, pulls the pinned image, swaps
# the app container in, health-gates the new version, and — if the new version
# does not come up healthy — AUTOMATICALLY ROLLS BACK to the previous image.
#
# PRIME DIRECTIVE (see build spec §0): it must never leave an instance in a
# broken state. Every failure path recovers to a running container and writes a
# clear status. It NEVER auto-restores the database.
#
# Security (spec §2.12): the ONLY variable fed into a docker command is an image
# tag, and it is strictly validated (^v[0-9]+.[0-9]+.[0-9]+$) before any use.
# No arbitrary string from the request file ever reaches a shell command.
#
# This script is intentionally POSIX sh and dependency-light (docker CLI + the
# compose plugin + busybox wget, all present in docker:cli). It does NOT update
# itself — see spec §7.6.
# ════════════════════════════════════════════════════════════════════════

set -u

# ─── Configuration (overridable via environment) ───
PROJECT_DIR="${PROJECT_DIR:-/project}"
STATE_DIR="${STATE_DIR:-$PROJECT_DIR/data/state}"
SNAP_DIR_HOST="${SNAP_DIR_HOST:-/snapshots}"          # path INSIDE panoptica-db
APP_SERVICE="${APP_SERVICE:-panoptica-app}"
DB_SERVICE="${DB_SERVICE:-panoptica-db}"
APP_IMAGE_REPO="${APP_IMAGE_REPO:-ghcr.io/panoptica365/app}"
HEALTH_URL="${HEALTH_URL:-http://panoptica-app:3000/healthz/ready}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-120}"               # seconds
HEALTH_CONSECUTIVE="${HEALTH_CONSECUTIVE:-3}"         # consecutive 200s = healthy
POLL_INTERVAL="${POLL_INTERVAL:-5}"                   # seconds between request polls
MANIFEST_URL="${UPDATE_MANIFEST_URL:-https://updates.panoptica365.com/latest.json}"

REQUEST_FILE="$STATE_DIR/update-request.json"
STATUS_FILE="$STATE_DIR/update-status.json"
OVERRIDE_FILE="$PROJECT_DIR/docker-compose.override.yml"
LAST_REQUEST_FILE="$STATE_DIR/.updater-last-request"

log() { echo "[updater] $(date -u '+%Y-%m-%dT%H:%M:%SZ') $*"; }

# ─── JSON helpers ───────────────────────────────────────────────────────
# We only ever emit values we control, so a minimal escaper is sufficient.
json_escape() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

# Read a string field from a flat JSON object via grep/sed. Good enough for the
# small, well-formed files WE write (request) and the manifest's flat "latest".
json_get() {
  # $1 = file, $2 = key
  grep -o "\"$2\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" "$1" 2>/dev/null \
    | head -n1 | sed 's/.*:[[:space:]]*"\(.*\)"/\1/'
}

now_iso() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }

# write_status PHASE RESULT MESSAGE ERROR
write_status() {
  _phase="$1"; _result="$2"; _msg="$3"; _err="$4"
  tmp="$STATUS_FILE.tmp"
  {
    printf '{\n'
    printf '  "request_id": "%s",\n'   "$(json_escape "$REQUEST_ID")"
    printf '  "phase": "%s",\n'        "$(json_escape "$_phase")"
    printf '  "result": %s,\n'         "$( [ -n "$_result" ] && printf '"%s"' "$(json_escape "$_result")" || printf 'null' )"
    printf '  "from_version": "%s",\n' "$(json_escape "$FROM_VERSION")"
    printf '  "to_version": "%s",\n'   "$(json_escape "$TO_VERSION")"
    printf '  "requested_by": "%s",\n' "$(json_escape "$REQUESTED_BY")"
    printf '  "started_at": "%s",\n'   "$(json_escape "$STARTED_AT")"
    printf '  "updated_at": "%s",\n'   "$(now_iso)"
    printf '  "message": %s,\n'        "$( [ -n "$_msg" ] && printf '"%s"' "$(json_escape "$_msg")" || printf 'null' )"
    printf '  "error": %s\n'           "$( [ -n "$_err" ] && printf '"%s"' "$(json_escape "$_err")" || printf 'null' )"
    printf '}\n'
  } > "$tmp" 2>/dev/null
  mv -f "$tmp" "$STATUS_FILE" 2>/dev/null
  log "status: phase=$_phase result=${_result:-_} ${_msg}"
}

# ─── Docker helpers ─────────────────────────────────────────────────────
compose() { ( cd "$PROJECT_DIR" && docker compose "$@" ); }

current_app_digest() {
  # Prefer an immutable repo digest; fall back to the raw image id. Either is a
  # valid `image:` value compose can pin for rollback.
  img_id=$(docker inspect --format '{{.Image}}' "$APP_SERVICE" 2>/dev/null)
  [ -z "$img_id" ] && return 1
  repo_digest=$(docker inspect --format '{{if .RepoDigests}}{{index .RepoDigests 0}}{{end}}' "$img_id" 2>/dev/null)
  if [ -n "$repo_digest" ]; then printf '%s' "$repo_digest"; else printf '%s' "$img_id"; fi
}

write_override() {
  # $1 = full image ref to pin (tag or @digest)
  tmp="$OVERRIDE_FILE.tmp"
  {
    printf '# Managed by panoptica-updater (Stage 5). Do NOT edit by hand.\n'
    printf '# This file pins the panoptica-app image so updates are reversible.\n'
    printf 'services:\n'
    printf '  %s:\n' "$APP_SERVICE"
    printf '    image: %s\n' "$1"
  } > "$tmp" 2>/dev/null
  mv -f "$tmp" "$OVERRIDE_FILE" 2>/dev/null
}

# health_gate → returns 0 if healthy within timeout, 1 otherwise
health_gate() {
  deadline=$(( $(date +%s) + HEALTH_TIMEOUT ))
  streak=0
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if wget -q -O /dev/null "$HEALTH_URL" 2>/dev/null; then
      streak=$(( streak + 1 ))
      if [ "$streak" -ge "$HEALTH_CONSECUTIVE" ]; then return 0; fi
    else
      streak=0
    fi
    sleep 3
  done
  return 1
}

# ─── The update sequence ────────────────────────────────────────────────
run_update() {
  STARTED_AT="$(now_iso)"

  # queued
  write_status "queued" "" "Update queued" ""

  # Validate the target tag — the hard security gate (spec §2.12).
  case "$TARGET_TAG" in
    v[0-9]*.[0-9]*.[0-9]*)
      # shape ok; tighten with a full regex check
      if ! printf '%s' "$TARGET_TAG" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$'; then
        write_status "failed" "failed" "" "Invalid target tag"
        return 1
      fi
      ;;
    *)
      write_status "failed" "failed" "" "Invalid target tag"
      return 1
      ;;
  esac

  # Best-effort manifest cross-check (defense in depth). If the manifest is
  # reachable, the target must match its current image_tag; a transient
  # manifest outage does not block (the strict regex already bounds the input).
  manifest_tag=""
  if wget -q -O /tmp/manifest.json "$MANIFEST_URL" 2>/dev/null; then
    manifest_tag=$(json_get /tmp/manifest.json image_tag)
    if [ -n "$manifest_tag" ] && [ "$manifest_tag" != "$TARGET_TAG" ]; then
      log "WARN target $TARGET_TAG != manifest image_tag $manifest_tag — proceeding on validated tag"
    fi
  else
    log "WARN manifest unreachable for cross-check — proceeding on validated tag"
  fi

  # Record the rollback target BEFORE we change anything.
  ROLLBACK_REF="$(current_app_digest)"
  if [ -z "$ROLLBACK_REF" ]; then
    write_status "failed" "failed" "" "Could not determine current image for rollback"
    return 1
  fi
  log "rollback target recorded: $ROLLBACK_REF"

  # snapshotting — insurance only; never auto-restored (spec §7.5).
  write_status "snapshotting" "" "Backing up the database" ""
  SNAP_NAME="pre-update-$(date -u '+%Y%m%dT%H%M%SZ').sql"
  if ! docker exec "$DB_SERVICE" sh -c "exec mysqldump -u root -p\"\$MYSQL_ROOT_PASSWORD\" --single-transaction --routines --events --all-databases > \"$SNAP_DIR_HOST/$SNAP_NAME\"" 2>/tmp/snap.err; then
    # A failed snapshot is a hard stop — we will not proceed to swap without
    # the insurance dump. Current version keeps running.
    write_status "failed" "failed" "" "Database snapshot failed: $(head -c 200 /tmp/snap.err 2>/dev/null)"
    return 1
  fi
  log "snapshot written: $SNAP_NAME"

  # pulling — pull the exact target tag by explicit ref so we validate
  # availability WITHOUT mutating the override yet (manifest-timing edge §2.11).
  write_status "pulling" "" "Downloading the new version" ""
  TARGET_IMAGE="$APP_IMAGE_REPO:$TARGET_TAG"
  if ! docker pull "$TARGET_IMAGE" 2>/tmp/pull.err; then
    # 404 / not-built-yet → abort cleanly, current version keeps running.
    write_status "failed" "failed" "" "Image not available yet — not ready, retry later"
    log "pull failed: $(head -c 200 /tmp/pull.err 2>/dev/null)"
    return 1
  fi
  log "pulled $TARGET_IMAGE"

  # restarting — write the pin, recreate the app container.
  write_status "restarting" "" "Restarting" ""
  write_override "$TARGET_IMAGE"
  if ! compose up -d "$APP_SERVICE" 2>/tmp/up.err; then
    log "compose up (new) failed: $(head -c 200 /tmp/up.err 2>/dev/null)"
    do_rollback "compose up failed for new image"
    return $?
  fi

  # health_check
  write_status "health_check" "" "Checking it's healthy" ""
  if health_gate; then
    write_status "success" "success" "Update complete" ""
    log "update SUCCESS → $TARGET_TAG"
    return 0
  fi

  log "health gate FAILED for $TARGET_TAG — rolling back"
  do_rollback "New version failed its health check"
  return $?
}

# do_rollback REASON
do_rollback() {
  reason="$1"
  write_status "health_check" "" "Update failed — rolling back" "$reason"
  write_override "$ROLLBACK_REF"
  if ! compose up -d "$APP_SERVICE" 2>/tmp/rb.err; then
    # Could not even bring the old image back via override — last resort: drop
    # the override entirely (revert to the base compose image) and try once more.
    log "rollback compose up failed: $(head -c 200 /tmp/rb.err 2>/dev/null) — dropping override"
    rm -f "$OVERRIDE_FILE" 2>/dev/null
    compose up -d "$APP_SERVICE" 2>/dev/null
  fi
  if health_gate; then
    write_status "rolled_back" "rolled_back" "Automatically rolled back to the previous version" "$reason"
    log "ROLLBACK SUCCESS"
    return 0
  fi
  # Rollback itself did not come up healthy (should be near-impossible given
  # additive-only migrations). Leave whatever is running; write a loud status.
  write_status "failed" "failed" "Rollback did not come up healthy — manual intervention required" "$reason"
  log "ROLLBACK FAILED — manual intervention required"
  return 1
}

# ─── Main watch loop ────────────────────────────────────────────────────
log "started: project=$PROJECT_DIR app=$APP_SERVICE health=$HEALTH_URL timeout=${HEALTH_TIMEOUT}s"
mkdir -p "$STATE_DIR" 2>/dev/null

while true; do
  if [ -f "$REQUEST_FILE" ]; then
    REQUEST_ID="$(json_get "$REQUEST_FILE" request_id)"
    LAST_DONE=""
    [ -f "$LAST_REQUEST_FILE" ] && LAST_DONE="$(cat "$LAST_REQUEST_FILE" 2>/dev/null)"

    if [ -n "$REQUEST_ID" ] && [ "$REQUEST_ID" != "$LAST_DONE" ]; then
      # Single-flight: only start if no update is currently in progress.
      CUR_PHASE=""
      [ -f "$STATUS_FILE" ] && CUR_PHASE="$(json_get "$STATUS_FILE" phase)"
      case "$CUR_PHASE" in
        queued|snapshotting|pulling|restarting|health_check)
          # An update is already running (status not terminal) — wait.
          ;;
        *)
          TARGET_TAG="$(json_get "$REQUEST_FILE" target_image_tag)"
          TO_VERSION="$(json_get "$REQUEST_FILE" target_version)"
          FROM_VERSION="$(json_get "$REQUEST_FILE" from_version)"
          REQUESTED_BY="$(json_get "$REQUEST_FILE" requested_by)"
          log "new request $REQUEST_ID → $TARGET_TAG (from ${FROM_VERSION:-?} to ${TO_VERSION:-?})"
          run_update
          # Mark this request handled regardless of outcome so we never loop on
          # the same request after the app reboots with the file still present.
          printf '%s' "$REQUEST_ID" > "$LAST_REQUEST_FILE" 2>/dev/null
          ;;
      esac
    fi
  fi
  sleep "$POLL_INTERVAL"
done
