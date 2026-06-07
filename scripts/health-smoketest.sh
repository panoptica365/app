#!/usr/bin/env bash
#
# Panoptica — /api/health smoke test
#
# Exercises the live health endpoint end-to-end and validates response shape.
# Run after a pm2 restart or after touching api-health.js / any check it
# composes (DB ping, alert poller, Graph endpoints, Claude API, AI parse).
#
# Usage:
#   PANOPTICA_URL=http://localhost:8080 \
#   PANOPTICA_COOKIE='connect.sid=s%3A...' \
#   ./scripts/health-smoketest.sh
#
# Get PANOPTICA_COOKIE from the browser:
#   1. Log into Panoptica in a browser.
#   2. Open DevTools → Application → Cookies → http://<host>:8080
#   3. Copy the value of `connect.sid` (URL-encoded; starts with `s%3A`).
#   4. Paste as: PANOPTICA_COOKIE='connect.sid=<that value>'
#
# Exit codes:
#   0 — all checks pass; overall=nominal or degraded (degraded is non-fatal)
#   1 — endpoint returned a malformed response or HTTP error
#   2 — overall=critical; one or more checks in crit state
#
# Requires: curl, jq

set -u
set -o pipefail

URL="${PANOPTICA_URL:-http://localhost:8080}"
COOKIE="${PANOPTICA_COOKIE:-}"

if [[ -z "$COOKIE" ]]; then
  echo "ERROR: PANOPTICA_COOKIE not set." >&2
  echo "       See script header for how to obtain a session cookie." >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq not installed (apt install jq / brew install jq)." >&2
  exit 1
fi

ENDPOINT="${URL}/api/health"
echo "→ Probing ${ENDPOINT}"

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

HTTP_CODE="$(curl -sS -o "$TMP" -w '%{http_code}' \
  --max-time 10 \
  -H "Cookie: ${COOKIE}" \
  -H 'Accept: application/json' \
  "$ENDPOINT")"
CURL_EXIT=$?

if [[ "$CURL_EXIT" -ne 0 ]]; then
  echo "FAIL: curl failed (exit ${CURL_EXIT})" >&2
  exit 1
fi

if [[ "$HTTP_CODE" != "200" ]]; then
  echo "FAIL: HTTP ${HTTP_CODE} (expected 200)" >&2
  echo "Response body:" >&2
  cat "$TMP" >&2
  exit 1
fi

# ─── Shape validation ───
# Required top-level keys: overall, summary, checked_at, checks (array)
# Required check keys:     id, label, state, summary

if ! jq -e 'has("overall") and has("summary") and has("checked_at") and has("checks")' "$TMP" >/dev/null; then
  echo "FAIL: response missing required top-level keys" >&2
  jq . "$TMP" >&2
  exit 1
fi

OVERALL="$(jq -r .overall "$TMP")"
SUMMARY="$(jq -r .summary "$TMP")"
CHECK_COUNT="$(jq -r '.checks | length' "$TMP")"

case "$OVERALL" in
  nominal|degraded|critical) ;;
  *)
    echo "FAIL: invalid overall='$OVERALL' (expected nominal|degraded|critical)" >&2
    exit 1
    ;;
esac

if [[ "$CHECK_COUNT" -lt 1 ]]; then
  echo "FAIL: checks array is empty" >&2
  exit 1
fi

# Validate each check's shape.
INVALID="$(jq -r '
  .checks[]
  | select(
      (has("id") | not) or
      (has("label") | not) or
      (has("state") | not) or
      (has("summary") | not) or
      (.state as $s | ($s != "ok" and $s != "warn" and $s != "crit"))
    )
  | .id // "<missing-id>"
' "$TMP")"

if [[ -n "$INVALID" ]]; then
  echo "FAIL: malformed checks: $(echo "$INVALID" | tr '\n' ' ')" >&2
  exit 1
fi

# ─── Pretty print ───
echo
echo "Overall : ${OVERALL}"
echo "Summary : ${SUMMARY}"
echo "Checks  : ${CHECK_COUNT}"
echo
jq -r '.checks[] | "  \(.state | ascii_upcase | (. + "    ")[:5])  \(.id)  —  \(.summary)"' "$TMP"
echo

# ─── Exit code reflects state ───
case "$OVERALL" in
  nominal)  echo "PASS — all systems nominal";        exit 0 ;;
  degraded) echo "PASS (degraded) — review the warn checks above"; exit 0 ;;
  critical) echo "FAIL — one or more checks are in crit state" >&2; exit 2 ;;
esac
