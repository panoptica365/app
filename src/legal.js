/**
 * Panoptica365 — Legal / EULA acceptance service
 *
 * Owns the End User License Agreement: versioned content on disk, the
 * `eula_acceptances` ledger in MySQL, and the "is this instance compliant?"
 * checks consumed by the wizard gate (§5.3) and the login-time re-acceptance
 * check (§5.4).
 *
 * Locked design (do not relitigate here — see the build spec):
 *
 *   1. Acceptance is PER-INSTANCE, not per-user. One acceptance row for the
 *      manifest's current version satisfies the whole install. The Licensee
 *      is the MSP organization, not the individual operator.
 *   2. The ledger is APPEND-ONLY. Re-acceptance of a new version inserts a
 *      new row; we never UPDATE or DELETE.
 *   3. HASH WHAT WAS SHOWN. The server re-reads the exact markdown it served
 *      and computes the SHA-256 itself. A client-supplied hash is never
 *      trusted (it isn't even accepted as input).
 *   4. VERSIONED CONTENT. The current version lives in manifest.json; bumping
 *      it is what triggers the re-acceptance flow — no code change needed.
 *      The manifest is therefore read fresh (not cached at module load), so a
 *      deploy that ships a new version directory + bumped manifest takes
 *      effect on the next request without a restart.
 *   5. ENGLISH IS CANONICAL. If a locale file is missing for the current
 *      version we serve en.md and record locale_viewed='en'.
 *
 * Schema convention (Decision #89): the table this module owns is created via
 * an idempotent ensure*() run on module load, not a manual SQL script.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db/database');
const setupState = require('./lib/setup/state');

// content/legal/eula/{manifest.json, v<version>/<locale>.md}
const CONTENT_ROOT = path.join(__dirname, '..', 'content', 'legal', 'eula');
const MANIFEST_PATH = path.join(CONTENT_ROOT, 'manifest.json');

const SUPPORTED_LOCALES = ['en', 'fr', 'es'];
const DEFAULT_LOCALE = 'en';

// ─── Schema (idempotent, runs on module load) ──────────────────────────────
async function ensureEulaSchema() {
  // entra_object_id / user_email are NULL during the pre-auth fresh-install
  // acceptance (the operator isn't logged in yet). content_sha256 is the hash
  // of the EXACT markdown served, computed server-side. No status column and
  // no state machine — compliance is "does a row exist for the current
  // version?" (see isCompliant).
  await db.query(`
    CREATE TABLE IF NOT EXISTS eula_acceptances (
      id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
      eula_version      VARCHAR(16)  NOT NULL,
      typed_name        VARCHAR(255) NOT NULL,
      entra_object_id   VARCHAR(64)  NULL,
      user_email        VARCHAR(320) NULL,
      locale_viewed     VARCHAR(5)   NOT NULL,
      content_sha256    CHAR(64)     NOT NULL,
      context           VARCHAR(16)  NOT NULL,
      accepted_at       DATETIME     NOT NULL,
      PRIMARY KEY (id),
      KEY idx_version (eula_version)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}
ensureEulaSchema().catch((err) =>
  console.error('[Legal] ensureEulaSchema failed:', err.message)
);

// ─── Content helpers ───────────────────────────────────────────────────────

/** Normalize a requested locale to one we ship, else the canonical default. */
function resolveLocale(lang) {
  const l = String(lang || '').trim().toLowerCase().slice(0, 2);
  return SUPPORTED_LOCALES.includes(l) ? l : DEFAULT_LOCALE;
}

/**
 * Read manifest.json fresh on every call. Bumping "current" is the entire
 * re-acceptance trigger, so we must NOT cache this at module load — a deploy
 * that swaps the manifest takes effect on the next request, no restart.
 * Falls back to DEFAULT_VERSION only if the manifest is unreadable, which
 * would be a packaging error; logged loudly.
 */
function getCurrentVersion() {
  try {
    const raw = fs.readFileSync(MANIFEST_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.current === 'string' && parsed.current.trim()) {
      return parsed.current.trim();
    }
    console.error('[Legal] manifest.json missing a string "current" field:', MANIFEST_PATH);
  } catch (err) {
    console.error('[Legal] Failed to read EULA manifest:', err.message);
  }
  // Last-resort default so the app still boots; the read error above is the
  // real signal that content shipped wrong.
  return '1.0';
}

/**
 * Read the EULA markdown for a version + locale, with English fallback.
 * Returns { content, localeServed, version } — localeServed records which
 * file was actually read (so the caller stores the truthful locale_viewed
 * even when it fell back to en).
 * Throws if even the English file is missing for the version (packaging error).
 */
function readEulaContent(version, requestedLocale) {
  const wanted = resolveLocale(requestedLocale);
  const dir = path.join(CONTENT_ROOT, `v${version}`);

  const tryRead = (locale) => {
    const file = path.join(dir, `${locale}.md`);
    try {
      return fs.readFileSync(file, 'utf8');
    } catch {
      return null;
    }
  };

  let localeServed = wanted;
  let content = tryRead(wanted);
  if (content === null && wanted !== DEFAULT_LOCALE) {
    // Locale fallback: serve English, but still record en as what was shown.
    localeServed = DEFAULT_LOCALE;
    content = tryRead(DEFAULT_LOCALE);
  }
  if (content === null) {
    throw new Error(`EULA content missing for version ${version} (locale ${wanted}, no en fallback at ${dir})`);
  }
  return { content, localeServed, version };
}

/** SHA-256 (hex) of the exact text we served — never a client-supplied hash. */
function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

// ─── Acceptance ledger ─────────────────────────────────────────────────────

/**
 * DB DATETIME (stored UTC via UTC_TIMESTAMP()) → ISO-8601 with explicit Z.
 * The pool returns DATETIME as 'YYYY-MM-DD HH:MM:SS'; we make the UTC instant
 * explicit for the JSON API (matches the spec's "2026-06-05T14:12:00Z").
 */
function dbDatetimeToIso(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const s = String(v);
  return s.includes(' ') ? s.replace(' ', 'T') + 'Z' : s + 'T00:00:00Z';
}

function rowToAcceptance(r) {
  if (!r) return null;
  return {
    typed_name: r.typed_name,
    accepted_at: dbDatetimeToIso(r.accepted_at),
    eula_version: r.eula_version,
    locale_viewed: r.locale_viewed,
    context: r.context,
  };
}

/** Count acceptance rows for a version. Used by the compliance checks. */
async function countAcceptances(version) {
  const row = await db.queryOne(
    'SELECT COUNT(*) AS n FROM eula_acceptances WHERE eula_version = ?',
    [version]
  );
  return row ? Number(row.n) : 0;
}

/** Is the instance compliant for the current (manifest) version? */
async function isCompliant(version = getCurrentVersion()) {
  return (await countAcceptances(version)) > 0;
}

/**
 * Re-acceptance required = the manifest's current version has zero acceptance
 * rows AND setup is complete. During the first-boot wizard (setup incomplete)
 * the wizard gate handles acceptance, so we never report "reaccept" then.
 * Fails OPEN (false) on any error so a transient DB hiccup can't lock admins
 * out of the app over legal text.
 */
async function isReacceptRequired() {
  try {
    if (setupState.isInSetupMode()) return false;
    return !(await isCompliant());
  } catch (err) {
    console.error('[Legal] isReacceptRequired check failed (failing open):', err.message);
    return false;
  }
}

/**
 * Full acceptance state for the current version: the latest acceptance plus
 * the complete history (newest first), for the GET endpoint + Settings tile.
 */
async function getAcceptanceState() {
  const version = getCurrentVersion();
  const rows = await db.queryRows(
    `SELECT eula_version, typed_name, locale_viewed, context, accepted_at
       FROM eula_acceptances
      WHERE eula_version = ?
      ORDER BY accepted_at DESC, id DESC`,
    [version]
  );
  return {
    version,
    accepted: rows.length > 0,
    acceptance: rows.length > 0 ? rowToAcceptance(rows[0]) : null,
    history: rows.map(rowToAcceptance),
  };
}

/**
 * Record an acceptance for the current version. Idempotent per the spec: if a
 * row for the current version already exists, return { alreadyAccepted:true }
 * without inserting (protects against double-click and the second-admin race).
 *
 * The server re-reads the served markdown for `locale` (with en fallback),
 * hashes it itself, and stores locale_viewed = the locale actually shown.
 *
 * @param {object} opts
 * @param {string}  opts.typedName       — the signature (validated by caller)
 * @param {string}  opts.locale          — locale the operator was reading
 * @param {string}  opts.context         — 'install' | 'reaccept'
 * @param {string} [opts.entraObjectId]  — session oid when authenticated
 * @param {string} [opts.userEmail]      — session email when authenticated
 * @returns {Promise<{alreadyAccepted:boolean, version:string, localeViewed:string, contentSha256:string}>}
 */
async function recordAcceptance(opts) {
  const {
    typedName,
    locale,
    context,
    entraObjectId = null,
    userEmail = null,
  } = opts || {};

  const version = getCurrentVersion();

  // Idempotency: one acceptance per version satisfies the instance.
  if (await isCompliant(version)) {
    return { alreadyAccepted: true, version, localeViewed: null, contentSha256: null };
  }

  const { content, localeServed } = readEulaContent(version, locale);
  const contentSha256 = sha256(content);

  // accepted_at via UTC_TIMESTAMP() — the DB writes the UTC instant directly,
  // sidestepping mysql2's rejection of Date/ISO-Z params and matching the
  // user_lesson_views precedent. (The spec's toMysqlDatetime route is the
  // alternative for caller-supplied timestamps; "now" is cleaner DB-side.)
  await db.execute(
    `INSERT INTO eula_acceptances
       (eula_version, typed_name, entra_object_id, user_email,
        locale_viewed, content_sha256, context, accepted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
    [
      version,
      String(typedName).trim().slice(0, 255),
      entraObjectId ? String(entraObjectId).slice(0, 64) : null,
      userEmail ? String(userEmail).slice(0, 320) : null,
      localeServed,
      contentSha256,
      context === 'reaccept' ? 'reaccept' : 'install',
    ]
  );

  return { alreadyAccepted: false, version, localeViewed: localeServed, contentSha256 };
}

module.exports = {
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  resolveLocale,
  getCurrentVersion,
  readEulaContent,
  sha256,
  countAcceptances,
  isCompliant,
  isReacceptRequired,
  getAcceptanceState,
  recordAcceptance,
  ensureEulaSchema,
};
