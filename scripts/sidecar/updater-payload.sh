#!/bin/sh
# ════════════════════════════════════════════════════════════════════════
#  Panoptica365 — Signed updater payload  (Part 1, 2026-06-03 build)
# ════════════════════════════════════════════════════════════════════════
#
# This file is the SIGNED PAYLOAD. It carries all the sidecar logic that used
# to live in scripts/updater.sh. It is baked into the app image, dropped onto
# the host by the app at startup, signature-verified by the tiny
# updater-bootstrap.sh wrapper, and then executed by that wrapper ONE SCAN PASS
# AT A TIME (`sh updater-payload.sh once`). It does NOT loop — the wrapper owns
# the loop and the signature gate.
#
# Security model (build spec §0): the app container (internet-facing) may only
# write this file + its signature to a shared folder. The bootstrap wrapper —
# the ONLY container with the Docker socket — verifies the Ed25519 signature
# against the installer-embedded public key BEFORE copying it into its active
# working copy. An unsigned or tampered payload is never run. So a compromised
# app can never escalate to the Docker socket. (See §2.12: the only variable
# fed into a docker command is a strictly-validated image tag.)
#
# ── CAPABILITY HEADER (read verbatim by the wrapper — keep this exact form) ──
# CAPABILITIES: update diag
#
# ── COMPATIBILITY CONTRACT (build spec §1.7) ────────────────────────────────
#   * This payload MUST tolerate request files written by OLDER apps: extra
#     fields are ignored, missing optional fields are defaulted.
#   * The app MUST tolerate OLDER payloads: it reads data/state/sidecar-versions.json
#     (written by the wrapper) and degrades gracefully if a capability is absent.
#   * Bump scripts/sidecar/PAYLOAD_VERSION on every behavioral change and
#     regenerate the signature (release checklist §1.8). Forward-compatible by
#     design: a rollback to an older app image must never clobber a newer
#     payload, so the app only ever copies a NEWER payload onto the host.
#
# POSIX sh, busybox-compatible, `set -u`, no bashisms — same discipline as the
# updater.sh it replaces.
# ════════════════════════════════════════════════════════════════════════

set -u

# ─── Configuration (overridable via environment; the wrapper passes its env) ─
PROJECT_DIR="${PROJECT_DIR:-/project}"
STATE_DIR="${STATE_DIR:-$PROJECT_DIR/data/state}"
SNAP_DIR_HOST="${SNAP_DIR_HOST:-/snapshots}"          # path INSIDE panoptica-db
APP_SERVICE="${APP_SERVICE:-panoptica-app}"
DB_SERVICE="${DB_SERVICE:-panoptica-db}"
APP_IMAGE_REPO="${APP_IMAGE_REPO:-ghcr.io/panoptica365/app}"
HEALTH_URL="${HEALTH_URL:-http://panoptica-app:3000/healthz/ready}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-120}"               # seconds
HEALTH_CONSECUTIVE="${HEALTH_CONSECUTIVE:-3}"         # consecutive 200s = healthy
# Post-gate observation window (Reliability 1.7, payload v2): after the initial
# health gate passes, keep watching readiness for this many seconds. A new
# image that boots clean but crash-loops a minute later (poisoned worker,
# delayed migration failure) still triggers the automatic rollback instead of
# being declared a success at the ~9s mark. 0 disables the window.
HEALTH_SETTLE="${HEALTH_SETTLE:-180}"                 # seconds to observe after the gate
HEALTH_SETTLE_FAILS="${HEALTH_SETTLE_FAILS:-5}"       # consecutive probe failures = unhealthy
MANIFEST_URL="${UPDATE_MANIFEST_URL:-https://updates.panoptica365.com/latest.json}"

# Hard-coded container names + log window for the diag verb. NOTHING from any
# request file is ever interpolated into a docker command (spec §3.4 / §2.12).
DIAG_CONTAINERS="panoptica-app panoptica-db panoptica-proxy panoptica-updater"
DIAG_SINCE="72h"
DIAG_MAX_BYTES="20971520"                             # 20 MB per container log

REQUEST_FILE="$STATE_DIR/update-request.json"
STATUS_FILE="$STATE_DIR/update-status.json"
OVERRIDE_FILE="$PROJECT_DIR/docker-compose.override.yml"
LAST_REQUEST_FILE="$STATE_DIR/.updater-last-request"

DIAG_REQUEST_FILE="$STATE_DIR/diag-request.json"
DIAG_LAST_REQUEST_FILE="$STATE_DIR/.diag-last-request"
DIAG_OUT_ROOT="$STATE_DIR/diag"

log() { echo "[payload] $(date -u '+%Y-%m-%dT%H:%M:%SZ') $*"; }

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

# ─── The update sequence (UNCHANGED logic, moved verbatim from updater.sh) ──
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
  # reachable, the target should match ONE of its image_tags — the manifest
  # may now carry both a stable (`latest`) and an `early` channel entry
  # (Reliability 1.7), so collect every image_tag rather than just the first.
  # A transient manifest outage does not block (the strict regex already
  # bounds the input).
  if wget -q -O /tmp/manifest.json "$MANIFEST_URL" 2>/dev/null; then
    manifest_tags=$(grep -o '"image_tag"[[:space:]]*:[[:space:]]*"[^"]*"' /tmp/manifest.json 2>/dev/null \
      | sed 's/.*:[[:space:]]*"\(.*\)"/\1/')
    if [ -n "$manifest_tags" ] && ! printf '%s\n' "$manifest_tags" | grep -qx "$TARGET_TAG"; then
      log "WARN target $TARGET_TAG matches no manifest image_tag ($(printf '%s' "$manifest_tags" | tr '\n' ' ')) — proceeding on validated tag"
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

  # health_check — the boot gate
  write_status "health_check" "" "Checking it's healthy" ""
  if ! health_gate; then
    log "health gate FAILED for $TARGET_TAG — rolling back"
    do_rollback "New version failed its health check"
    return $?
  fi

  # settle window — keep observing readiness after the gate so a delayed
  # crash-loop still rolls back. Single probe blips are tolerated; only
  # HEALTH_SETTLE_FAILS consecutive failures count as unhealthy.
  if [ "$HEALTH_SETTLE" -gt 0 ] 2>/dev/null; then
    write_status "health_check" "" "Healthy — observing for ${HEALTH_SETTLE}s before confirming" ""
    settle_deadline=$(( $(date +%s) + HEALTH_SETTLE ))
    fail_streak=0
    while [ "$(date +%s)" -lt "$settle_deadline" ]; do
      if wget -q -O /dev/null "$HEALTH_URL" 2>/dev/null; then
        fail_streak=0
      else
        fail_streak=$(( fail_streak + 1 ))
        if [ "$fail_streak" -ge "$HEALTH_SETTLE_FAILS" ]; then
          log "settle window: readiness lost ($fail_streak consecutive probe failures) — rolling back"
          do_rollback "New version went unhealthy during the post-update observation window"
          return $?
        fi
      fi
      sleep 5
    done
  fi

  write_status "success" "success" "Update complete" ""
  log "update SUCCESS → $TARGET_TAG"
  return 0
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

# ─── The diag sequence (NEW — build spec §3.4) ──────────────────────────
# Mirrors the update verb's request/status/dedup protocol exactly. Collects
# `docker logs` for the four known containers into a per-request directory the
# app then zips + deletes. The app redacts the logs before they leave the box.
run_diag() {
  _req_id="$1"

  # Defence in depth: request_id is used in a filesystem path (never in a docker
  # command), but reject anything that isn't a safe slug so it can't traverse.
  case "$_req_id" in
    *[!A-Za-z0-9._-]*|''|.|..)
      log "diag: refusing unsafe request_id"
      return 1
      ;;
  esac

  _out_dir="$DIAG_OUT_ROOT/$_req_id"
  mkdir -p "$_out_dir" 2>/dev/null

  _files=""
  _err=""
  for _name in $DIAG_CONTAINERS; do
    _dest="$_out_dir/$_name.log"
    # 2>&1 so we capture stderr too; tail -c keeps the most-recent bytes under
    # the per-file cap. A missing container just yields a small error file —
    # never aborts the whole diag.
    if docker logs --since "$DIAG_SINCE" --timestamps "$_name" >"$_dest.full" 2>&1; then
      tail -c "$DIAG_MAX_BYTES" "$_dest.full" > "$_dest" 2>/dev/null
      rm -f "$_dest.full" 2>/dev/null
      _files="$_files \"$_name.log\""
    else
      # Record the failure inline; keep going.
      tail -c "$DIAG_MAX_BYTES" "$_dest.full" > "$_dest" 2>/dev/null
      rm -f "$_dest.full" 2>/dev/null
      log "diag: docker logs failed for $_name"
      _err="$_err $_name"
      _files="$_files \"$_name.log\""
    fi
  done

  # Build the files array JSON fragment (already-quoted items, comma-join).
  _files_json="$(printf '%s' "$_files" | sed 's/^ //; s/" "/", "/g')"
  [ -n "$_files_json" ] || _files_json=""

  _result="done"
  [ -n "$_err" ] && _result="done"   # partial is still "done"; per-file gaps show as small files

  _status_tmp="$_out_dir/diag-status.json.tmp"
  {
    printf '{\n'
    printf '  "request_id": "%s",\n' "$(json_escape "$_req_id")"
    printf '  "result": "%s",\n'     "$_result"
    printf '  "files": [%s],\n'      "$_files_json"
    printf '  "error": %s,\n'        "$( [ -n "$_err" ] && printf '"docker logs failed for:%s"' "$(json_escape "$_err")" || printf 'null' )"
    printf '  "finished_at": "%s"\n' "$(now_iso)"
    printf '}\n'
  } > "$_status_tmp" 2>/dev/null
  mv -f "$_status_tmp" "$_out_dir/diag-status.json" 2>/dev/null

  log "diag: wrote logs for [$DIAG_CONTAINERS] → $_out_dir (errors:${_err:-none})"
  return 0
}

# ─── One scan pass (build spec §1.5) ────────────────────────────────────
# The wrapper invokes us as `sh updater-payload.sh once` every poll cycle. We
# handle at most one update request and one diag request, then exit 0. The
# wrapper owns the loop; single-flight is preserved because the wrapper runs us
# serially and run_update checks the status-file phase.
scan_once() {
  mkdir -p "$STATE_DIR" 2>/dev/null

  # ── update request ──
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
          : # An update is already running (status not terminal) — wait.
          ;;
        *)
          TARGET_TAG="$(json_get "$REQUEST_FILE" target_image_tag)"
          TO_VERSION="$(json_get "$REQUEST_FILE" target_version)"
          FROM_VERSION="$(json_get "$REQUEST_FILE" from_version)"
          REQUESTED_BY="$(json_get "$REQUEST_FILE" requested_by)"
          log "new update request $REQUEST_ID → $TARGET_TAG (from ${FROM_VERSION:-?} to ${TO_VERSION:-?})"
          run_update
          # Mark handled regardless of outcome so we never loop on the same
          # request after the app reboots with the file still present.
          printf '%s' "$REQUEST_ID" > "$LAST_REQUEST_FILE" 2>/dev/null
          ;;
      esac
    fi
  fi

  # ── diag request ── (separate dedup marker; independent of update state)
  if [ -f "$DIAG_REQUEST_FILE" ]; then
    DIAG_ID="$(json_get "$DIAG_REQUEST_FILE" request_id)"
    DIAG_LAST=""
    [ -f "$DIAG_LAST_REQUEST_FILE" ] && DIAG_LAST="$(cat "$DIAG_LAST_REQUEST_FILE" 2>/dev/null)"
    if [ -n "$DIAG_ID" ] && [ "$DIAG_ID" != "$DIAG_LAST" ]; then
      log "new diag request $DIAG_ID"
      run_diag "$DIAG_ID"
      printf '%s' "$DIAG_ID" > "$DIAG_LAST_REQUEST_FILE" 2>/dev/null
    fi
  fi

  return 0
}

scan_once
exit 0
