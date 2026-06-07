/**
 * Panoptica365 — Session secret guarantee (MF-3, 2026-06-07)
 *
 * The session cookie is signed with SESSION_SECRET. If that secret is ever the
 * old hardcoded fallback ('change-me-in-production'), the unfilled template
 * placeholder, blank, or too short, an attacker who knows the value could forge
 * a signed session cookie. This module makes a weak/missing secret IMPOSSIBLE to
 * run with — WITHOUT ever failing closed (we never want to lock an MSP out of
 * their own box and tell them to SSH in).
 *
 * Behaviour (self-healing, fail-OPEN-safely):
 *   - Strong secret already set        → no-op.
 *   - Missing / placeholder / < 32 chars → generate a strong one (32 random
 *     bytes → 64 hex chars), set it on process.env, and PERSIST it to .env so it
 *     survives restarts (existing sessions stay valid). If the .env write fails
 *     (read-only fs, perms), we STILL boot with the in-memory secret — the app
 *     comes up either way — and log that it wasn't persisted (it would then
 *     regenerate, logging users out, on the next restart until .env is writable).
 *
 * Must run AFTER dotenv and BEFORE config/express-session are loaded. See the
 * call site near the top of src/server.js.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { escapeEnvValue } = require('./env-file');

const KEY = 'SESSION_SECRET';
const MIN_LEN = 32;
const DEFAULT_ENV_PATH = path.join(__dirname, '..', '..', '.env');

// Values that look set but must NEVER be trusted as a real secret.
const KNOWN_WEAK = new Set([
  'change-me-in-production',                 // the old hardcoded config fallback
  'GENERATE_WITH_openssl_rand_-hex_32',      // the .env.template placeholder (34 chars — would pass a naive length check)
]);

/** True if the value can't be trusted as a signing secret. */
function isWeak(value) {
  if (typeof value !== 'string') return true;
  const v = value.trim();
  if (v.length < MIN_LEN) return true;
  if (KNOWN_WEAK.has(v)) return true;
  return false;
}

/**
 * Replace or append KEY=value in the .env file at envPath. Uses the shared
 * escapeEnvValue() so the value round-trips losslessly. Returns true on success.
 */
function persistToEnv(key, value, envPath) {
  const line = `${key}=${escapeEnvValue(value)}`;
  let content = '';
  try {
    content = fs.readFileSync(envPath, 'utf8');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e; // missing file is fine — we'll create it
  }
  const lines = content.length ? content.split(/\r?\n/) : [];
  let replaced = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith(key + '=')) {
      lines[i] = line;
      replaced = true;
      break;
    }
  }
  if (!replaced) {
    if (lines.length && lines[lines.length - 1] === '') lines[lines.length - 1] = line;
    else lines.push(line);
    lines.push('');
  }
  fs.writeFileSync(envPath, lines.join('\n'), { mode: 0o600 });
  try { fs.chmodSync(envPath, 0o600); } catch (_) { /* best-effort on hosts that allow it */ }
  return true;
}

/**
 * Guarantee a strong SESSION_SECRET is present on process.env. Self-healing.
 * @param {string} [envPath] override for testing; defaults to the repo-root .env.
 * @returns {{ generated: boolean, persisted: boolean, reason: string|null }}
 */
function ensureSessionSecret(envPath = DEFAULT_ENV_PATH) {
  const current = process.env[KEY];
  if (!isWeak(current)) {
    return { generated: false, persisted: true, reason: null };
  }

  const reason = !current ? 'missing'
    : KNOWN_WEAK.has(String(current).trim()) ? 'a known placeholder/default'
    : 'too short';

  const fresh = crypto.randomBytes(32).toString('hex'); // 64 hex chars
  process.env[KEY] = fresh; // app boots with a strong secret THIS run no matter what

  let persisted = false;
  try {
    persisted = persistToEnv(KEY, fresh, envPath);
  } catch (e) {
    console.error(
      `[SessionSecret] ${KEY} was ${reason}; generated a strong one in memory but FAILED to persist to .env (${e.message}). ` +
      `The app is up and secure now, but the secret will regenerate (logging users out) on the next restart until .env is writable.`
    );
    return { generated: true, persisted: false, reason };
  }

  console.warn(`[SessionSecret] ${KEY} was ${reason}; generated a strong 64-char secret and saved it to .env. No action needed.`);
  return { generated: true, persisted, reason };
}

module.exports = { ensureSessionSecret, isWeak, persistToEnv };
