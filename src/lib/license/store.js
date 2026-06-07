/**
 * Panoptica365 — License Storage Layer
 *
 * Owns persistence of the license token + fingerprint across two surfaces:
 *
 *   1. `.env` at the project root      (canonical, edited by humans + by
 *                                       the refresh client when it rotates
 *                                       the token weekly).
 *
 *   2. `data/state/license-cache.json` (sidecar fallback; rewritten on every
 *                                       successful boot + every refresh. Read
 *                                       only when LICENSE_TOKEN is missing
 *                                       from .env — this is the safety net
 *                                       against accidental .env wipes that
 *                                       lit up the design discussion on
 *                                       May 24, 2026).
 *
 * Why a separate module from validator.js: validation is pure crypto and
 * fingerprint-comparison; storage is fs + path management + concurrency.
 * Keeping them split lets unit tests exercise validation against fixture
 * JWTs without touching the host filesystem.
 *
 * Why not in api-settings.js's parseEnvFile/updateEnvVars: that module is
 * inside src/routes/ which makes it a route-layer concern. The license
 * store is needed at boot, BEFORE any route is mounted, and pulling
 * api-settings.js into the boot path drags in express + Anthropic SDK
 * + nodemailer transitively. We keep boot lean by re-implementing a
 * tiny .env reader/writer here with the same structure-preserving
 * semantics as parseEnvFile.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROJECT_ROOT = path.join(__dirname, '..', '..', '..');
const ENV_PATH = path.join(PROJECT_ROOT, '.env');
const CACHE_DIR = path.join(PROJECT_ROOT, 'data', 'state');
const CACHE_PATH = path.join(CACHE_DIR, 'license-cache.json');

const ENV_LICENSE_TOKEN_KEY = 'LICENSE_TOKEN';
const ENV_FINGERPRINT_KEY = 'PANOPTICA_INSTALL_FINGERPRINT';

// ─── .env file helpers ─────────────────────────────────────────────────
// Mirror the parseEnvFile/updateEnvVars semantics from src/routes/api-settings.js:
// preserve line ordering, blank lines, and comments. The line regex matches
// uppercase + digit + underscore keys, same as the existing helper.

/**
 * Read .env into ({ lines, vars }) where vars is a Map<key, {lineIdx, value}>.
 * If .env doesn't exist (fresh install), returns empty structures.
 */
function readEnvFile() {
  let content = '';
  try {
    content = fs.readFileSync(ENV_PATH, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') {
      // .env doesn't exist — return empty. The caller will write one if
      // it needs to persist a fingerprint.
      return { lines: [], vars: new Map() };
    }
    throw e;
  }
  const lines = content.split('\n');
  const vars = new Map();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) {
      vars.set(m[1], { lineIdx: i, value: m[2] });
    }
  }
  return { lines, vars };
}

/**
 * Write updates back to .env, preserving structure. Also mutates process.env
 * so subsequent reads in the same process see the new values.
 *
 * Throws if .env is read-only or missing (the latter only for non-bootstrap
 * cases — if .env doesn't exist, we don't auto-create it from this layer;
 * the operator should have copied .env.template first).
 */
function writeEnvVars(updates) {
  const { lines, vars } = readEnvFile();

  // Guard: refuse to write if .env doesn't exist at all. Persisting a
  // fingerprint to a non-existent file would create a half-configured
  // install state that's worse than failing loud.
  if (!fs.existsSync(ENV_PATH)) {
    throw new Error(
      `.env not found at ${ENV_PATH}. ` +
      `Copy .env.template to .env and configure your install before first boot.`,
    );
  }

  for (const [key, value] of Object.entries(updates)) {
    const safeVal = String(value);
    if (vars.has(key)) {
      lines[vars.get(key).lineIdx] = `${key}=${safeVal}`;
    } else {
      lines.push(`${key}=${safeVal}`);
    }
    process.env[key] = safeVal;
  }

  fs.writeFileSync(ENV_PATH, lines.join('\n'), 'utf8');
}

// ─── Fingerprint generation ─────────────────────────────────────────────

/**
 * Returns the existing PANOPTICA_INSTALL_FINGERPRINT from .env (or, if .env
 * is missing the key but process.env carries it from an external source like
 * docker-compose, returns that). If neither is set, generates a fresh UUID v4,
 * writes it back to .env, and returns it.
 *
 * Once persisted, NEVER regenerated. The fingerprint is the install identity
 * the license server uses to bind JWTs.
 *
 * Returns: string (the fingerprint). Throws only on fs failures.
 */
function getOrCreateFingerprint() {
  // process.env is populated by dotenv at app startup AND by docker-compose
  // env_file, so this check covers both native + container paths.
  const fromEnv = process.env[ENV_FINGERPRINT_KEY];
  if (fromEnv && fromEnv.trim().length >= 8) {
    return fromEnv.trim();
  }

  // Not in process.env — generate, persist, return.
  const fingerprint = crypto.randomUUID();

  // Only write to .env if .env exists. In container deploys where .env is
  // mounted read-only or absent (some MSPs may inject env via compose only,
  // no .env file), we accept that the fingerprint won't persist across
  // restarts — but we still surface it to the operator so they can drop it
  // into compose manually.
  if (fs.existsSync(ENV_PATH)) {
    try {
      writeEnvVars({ [ENV_FINGERPRINT_KEY]: fingerprint });
    } catch (e) {
      // Persist failure isn't fatal — return the generated value and let
      // the boot orchestrator decide what to do.
      console.warn(`[License] Could not persist fingerprint to .env: ${e.message}`);
    }
  }

  process.env[ENV_FINGERPRINT_KEY] = fingerprint;
  return fingerprint;
}

// ─── Token retrieval ────────────────────────────────────────────────────

/**
 * Returns the LICENSE_TOKEN from process.env, or null if unset.
 */
function getEnvToken() {
  const t = process.env[ENV_LICENSE_TOKEN_KEY];
  return t && t.trim() ? t.trim() : null;
}

/**
 * Returns the LICENSE_TOKEN from the sidecar cache file, or null if the
 * cache doesn't exist / is unreadable / malformed.
 *
 * The cache schema (v1):
 *   {
 *     "schema_version": 1,
 *     "token": "<jwt>",
 *     "cached_at": "<ISO 8601>",
 *     "claims_summary": {
 *       "license_id": <int>,
 *       "msp_name": "<string>",
 *       "billing_mode": "<paid|nfr>",
 *       "exp": <unix sec>
 *     }
 *   }
 *
 * `claims_summary` is denormalized for human-readability only — the
 * authoritative claims come from re-verifying the token. Validator does
 * not read claims_summary; it re-runs jose.jwtVerify on `.token`.
 */
function getCachedToken() {
  try {
    if (!fs.existsSync(CACHE_PATH)) return null;
    const raw = fs.readFileSync(CACHE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.token !== 'string' || parsed.token.length < 20) {
      return null;
    }
    return parsed.token;
  } catch {
    return null;
  }
}

/**
 * Write the verified token + denormalized claims summary to the sidecar.
 * Creates data/state/ if it doesn't exist. chmod 600 on Linux/macOS.
 *
 * `claims` is the verified JWT payload object from validator.js.
 */
function writeCachedToken(token, claims) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }

  const cache = {
    schema_version: 1,
    token,
    cached_at: new Date().toISOString(),
    claims_summary: {
      license_id: claims?.license_id ?? null,
      msp_name: claims?.msp_name ?? null,
      billing_mode: claims?.billing_mode ?? null,
      exp: claims?.exp ?? null,
    },
  };

  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8');
  // Restrict to owner-read/write. No-op on Windows; harmless on macOS/Linux.
  try {
    fs.chmodSync(CACHE_PATH, 0o600);
  } catch {
    // Ignore — chmod may fail on bind-mounted filesystems with restrictive
    // host policies. The file is in data/ which should be operator-only
    // already.
  }
}

/**
 * Persist a freshly-issued token to BOTH .env and the cache. Called by
 * the refresh client in Stage B after a successful weekly refresh.
 * Falls back gracefully if .env can't be written (logs but keeps the
 * cache write — the operator can drop the new token into .env manually
 * later).
 */
function persistRotatedToken(newToken, newClaims) {
  let envWritten = false;
  try {
    writeEnvVars({ [ENV_LICENSE_TOKEN_KEY]: newToken });
    envWritten = true;
  } catch (e) {
    console.warn(`[License] Could not write rotated token to .env: ${e.message}`);
  }

  // Always update the cache, even if .env write failed.
  writeCachedToken(newToken, newClaims);

  return { envWritten, cacheWritten: true };
}

module.exports = {
  // Fingerprint
  getOrCreateFingerprint,
  // Token storage
  getEnvToken,
  getCachedToken,
  writeCachedToken,
  persistRotatedToken,
  // Path constants — surfaced for the boot-error-message formatter
  ENV_PATH,
  CACHE_PATH,
  ENV_LICENSE_TOKEN_KEY,
  ENV_FINGERPRINT_KEY,
  // Test seam
  _readEnvFile: readEnvFile,
  _writeEnvVars: writeEnvVars,
};
