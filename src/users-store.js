/**
 * Panoptica — Users persistence
 *
 * The `users` table stores per-operator preferences and identity, populated
 * on every login via `upsertUserOnLogin()`. Replaces the prior localStorage-
 * only approach for theme/language and provides the foundation for per-
 * operator features (mute schedules, future on-call rotations, last-seen
 * tracking).
 *
 * Identity model:
 *   - oid   (Entra object ID) — IMMUTABLE primary identifier. Survives UPN
 *           rename, mailbox swap, role change. UNIQUE in the table.
 *   - upn   (user principal name) — login name. Mutable. Useful for display.
 *   - email (primary SMTP) — what alerts go to. NULLABLE: unlicensed admin
 *           accounts (e.g., a Microsoft 365 Global Admin without an Exchange
 *           license) have a UPN but no email. The notifier integration
 *           filters out NULL emails from any recipient list.
 *
 * Admin-failsafe note: when a notification's recipient list is empty after
 * mute filtering, the failsafe sends to all `role='admin'` users with a
 * non-NULL email. Admin accounts without an email are silently skipped from
 * that fallback. If ALL admins are unlicensed, the failsafe also fails;
 * `/api/health` surfaces that condition.
 */

const db = require('./db/database');

let schemaReady = null;

async function ensureSchema() {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    try {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS users (
          id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          oid VARCHAR(36) NOT NULL UNIQUE COMMENT 'Entra object ID — immutable identifier',
          upn VARCHAR(255) NOT NULL COMMENT 'User principal name (login); mutable',
          email VARCHAR(255) DEFAULT NULL COMMENT 'Primary SMTP — NULL for unlicensed accounts',
          display_name VARCHAR(255) DEFAULT NULL,
          role ENUM('admin','member','viewer') NOT NULL DEFAULT 'viewer' COMMENT 'Cached from resolveUserRole at last login',
          language ENUM('en','fr','es') NOT NULL DEFAULT 'en',
          theme ENUM('light','dark') NOT NULL DEFAULT 'dark',
          last_seen_version VARCHAR(20) DEFAULT NULL COMMENT 'Most recent version the operator viewed in What''s New (v0.1.7+)',
          first_login_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          last_login_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_users_role (role),
          INDEX idx_users_email (email)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log('[UsersStore] Ensured users table exists');
    } catch (e) {
      console.error('[UsersStore] Schema ensure failed:', e.message);
      throw e;
    }

    // v0.1.7 migration — add last_seen_version to existing installs that
    // pre-date the CREATE TABLE update above. Column-existence check first
    // because MySQL 8 has no ADD COLUMN IF NOT EXISTS.
    try {
      const colExists = await db.queryOne(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'users'
            AND COLUMN_NAME = 'last_seen_version'`
      );
      if (!colExists) {
        await db.execute(
          "ALTER TABLE users ADD COLUMN last_seen_version VARCHAR(20) DEFAULT NULL AFTER theme"
        );
        console.log('[UsersStore] Added last_seen_version column to users');
      }
    } catch (e) {
      console.error('[UsersStore] last_seen_version migration failed:', e.message);
      // Non-fatal — the app still works; the What's New "unread dot" just
      // won't track per-user state until this column exists.
    }

    try {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS operator_mute_periods (
          id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          user_id INT UNSIGNED NOT NULL,
          starts_at DATETIME NOT NULL,
          ends_at DATETIME NOT NULL,
          reason VARCHAR(500) DEFAULT NULL COMMENT 'Operator-supplied note (vacation, conference, etc.)',
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          revoked_at DATETIME DEFAULT NULL COMMENT 'Set when operator cancels mute early',
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          INDEX idx_active_mutes (user_id, ends_at, revoked_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log('[UsersStore] Ensured operator_mute_periods table exists');
    } catch (e) {
      console.error('[UsersStore] Mute schema ensure failed:', e.message);
      throw e;
    }
  })();
  return schemaReady;
}

/**
 * Upsert a user row on login. INSERT on first login (defaults to en/dark);
 * UPDATE last_login_at + role + upn + email + display_name on subsequent.
 *
 * Notably does NOT touch language/theme — those are operator-managed via
 * the prefs modal and would otherwise be reset on every login.
 *
 * Returns the users.id for the row (so the caller can store it in session).
 */
async function upsertUserOnLogin({ oid, upn, email, displayName, role }) {
  await ensureSchema();
  if (!oid) throw new Error('upsertUserOnLogin: oid is required');

  // INSERT ... ON DUPLICATE KEY UPDATE pattern. The UNIQUE on oid is the
  // upsert key; we never want two rows for the same Entra account.
  await db.execute(
    `INSERT INTO users (oid, upn, email, display_name, role, language, theme,
                        first_login_at, last_login_at)
     VALUES (?, ?, ?, ?, ?, 'en', 'dark', NOW(), NOW())
     ON DUPLICATE KEY UPDATE
       upn = VALUES(upn),
       email = VALUES(email),
       display_name = VALUES(display_name),
       role = VALUES(role),
       last_login_at = NOW()`,
    [oid, upn, email || null, displayName || null, role || 'viewer']
  );

  const row = await db.queryOne('SELECT id FROM users WHERE oid = ? LIMIT 1', [oid]);
  return row ? row.id : null;
}

async function getUserById(id) {
  if (!id) return null;
  await ensureSchema();
  return db.queryOne(
    `SELECT id, oid, upn, email, display_name, role, language, theme,
            last_seen_version, first_login_at, last_login_at
       FROM users WHERE id = ? LIMIT 1`,
    [id]
  );
}

async function updatePrefs(id, { language, theme }) {
  await ensureSchema();
  // Validate inputs before touching DB; defense against a malformed request
  // body. ENUM constraint would catch it at MySQL layer, but a clear 400 is
  // better UX than a 500.
  const validLanguages = new Set(['en', 'fr', 'es']);
  const validThemes = new Set(['light', 'dark']);
  if (!validLanguages.has(language)) throw new Error(`Invalid language: ${language}`);
  if (!validThemes.has(theme)) throw new Error(`Invalid theme: ${theme}`);

  const affected = await db.execute(
    'UPDATE users SET language = ?, theme = ? WHERE id = ?',
    [language, theme, id]
  );
  return affected;
}

/**
 * Record the most-recent WHATS-NEW.md version this operator has viewed
 * (v0.1.7+). Used to drive the "unread dot" + one-time toast: when the
 * app's current version is newer than this value, the user sees the
 * notification until they open the modal (or dismiss the toast).
 */
async function setLastSeenVersion(id, version) {
  if (!id || !version) return;
  await ensureSchema();
  // VARCHAR(20) — trim defensively in case a caller passes something long.
  await db.execute(
    'UPDATE users SET last_seen_version = ? WHERE id = ?',
    [String(version).slice(0, 20), id]
  );
}

/**
 * Return the list of email addresses currently muted (active mute, not
 * revoked, time window includes NOW). Used by notifier.js to subtract from
 * the recipient list. Returns lowercased emails for case-insensitive match.
 */
async function getMutedEmails() {
  await ensureSchema();
  // UTC_TIMESTAMP() vs. NOW(): we store starts_at/ends_at as UTC ISO strings
  // (the API layer converts datetime-local input via Date.toISOString().slice).
  // NOW() returns the MySQL SESSION timezone's current time — on a non-UTC
  // server this gives a stale comparison. UTC_TIMESTAMP() always returns
  // UTC regardless of session timezone, matching the stored values.
  const rows = await db.queryRows(
    `SELECT u.email
       FROM users u
       JOIN operator_mute_periods m ON m.user_id = u.id
      WHERE m.starts_at <= UTC_TIMESTAMP()
        AND m.ends_at   >  UTC_TIMESTAMP()
        AND m.revoked_at IS NULL
        AND u.email IS NOT NULL`
  );
  return rows.map(r => (r.email || '').toLowerCase());
}

/**
 * Return all users with role='admin' AND email IS NOT NULL. Used by the
 * notifier failsafe when all configured recipients are muted. Failsafe
 * intentionally ignores admins' OWN active mutes — when a SEVERE alert
 * happens during full-team mute, *somebody* needs to see it.
 */
async function getAdminFailsafeRecipients() {
  await ensureSchema();
  const rows = await db.queryRows(
    `SELECT email FROM users WHERE role = 'admin' AND email IS NOT NULL ORDER BY email`
  );
  return rows.map(r => r.email);
}

module.exports = {
  ensureSchema,
  upsertUserOnLogin,
  getUserById,
  updatePrefs,
  setLastSeenVersion,
  getMutedEmails,
  getAdminFailsafeRecipients,
};
