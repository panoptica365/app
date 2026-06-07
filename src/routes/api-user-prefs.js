/**
 * Panoptica — User preferences API
 *
 * Per-operator preferences (language, theme) and personal mute schedules.
 * Replaces the prior localStorage-only approach so prefs persist across
 * devices/browsers.
 *
 * All endpoints scoped to the logged-in operator (req.session.user). The
 * admin-only `/admin/active-mutes` view (in Step 3) is the only path that
 * crosses the per-user boundary.
 *
 * Mounted at /api/user-prefs in server.js.
 */

const express = require('express');
const auth = require('../auth');
const db = require('../db/database');
const usersStore = require('../users-store');
const mspAudit = require('../msp-audit');
const notifier = require('../notifier');
const config = require('../../config/default');

const router = express.Router();
router.use(auth.requireAuth);

// Mute window cap — operators going on >60-day leave should be removed from
// notification recipient lists by an admin, not silenced via this mechanism.
const MAX_MUTE_DAYS = 60;
const MAX_MUTE_MS = MAX_MUTE_DAYS * 24 * 60 * 60 * 1000;

/**
 * Case-insensitive check whether `email` is on any of the configured
 * notification recipient lists (PSA + personal). Used to surface a warning
 * in the modal when an operator's mute would have no effect.
 */
function isEmailOnNotificationList(email) {
  if (!email) return false;
  const target = email.toLowerCase();
  const psa = (config.notification?.psaEmail || '').trim().toLowerCase();
  const personal = (config.notification?.notifyEmails || '')
    .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  return target === psa || personal.includes(target);
}

/**
 * GET /api/user-prefs
 * Returns the logged-in user's row plus active mute (if any). Single
 * round-trip so the modal can render in one fetch.
 */
router.get('/', async (req, res) => {
  try {
    const internalId = req.session?.user?.internal_user_id;
    if (!internalId) {
      // No row in the users table — most commonly because login predates this
      // feature. Return safe defaults so the UI works; the next login will
      // create the row.
      return res.json({
        user: {
          email: req.session?.user?.email_for_alerts || null,
          upn: req.session?.user?.email || null,
          display_name: req.session?.user?.name || null,
          role: req.session?.user?.role || 'viewer',
          language: 'en',
          theme: 'dark',
          last_seen_version: null,
          first_login_at: null,
          last_login_at: null,
        },
        active_mute: null,
        mute_max_days: MAX_MUTE_DAYS,
      });
    }

    const user = await usersStore.getUserById(internalId);
    if (!user) {
      return res.status(404).json({ error: 'User row missing — try logging out and back in to recreate.' });
    }

    // Look up active mute. Single-row query — only one mute can be active
    // per user at a time (POST mute revokes any prior active row).
    // UTC_TIMESTAMP() (not NOW()): see users-store.js::getMutedEmails for
    // the reasoning. starts_at/ends_at are stored UTC; the MySQL session
    // timezone might not be UTC, so NOW() would compare wrong-zone values.
    const activeMute = await db.queryOne(
      `SELECT id, starts_at, ends_at, reason, created_at
         FROM operator_mute_periods
        WHERE user_id = ?
          AND starts_at <= UTC_TIMESTAMP()
          AND ends_at   >  UTC_TIMESTAMP()
          AND revoked_at IS NULL
        ORDER BY id DESC
        LIMIT 1`,
      [internalId]
    );

    // Check whether the operator's email is on any current notification
    // recipient list. The modal uses this to show a warning if mute would
    // have no effect (because they wouldn't get alerts in the first place).
    const emailInRecipientList = isEmailOnNotificationList(user.email);

    res.json({
      user: {
        email: user.email,
        upn: user.upn,
        display_name: user.display_name,
        role: user.role,
        language: user.language,
        theme: user.theme,
        last_seen_version: user.last_seen_version || null,
        first_login_at: user.first_login_at,
        last_login_at: user.last_login_at,
      },
      active_mute: activeMute || null,
      mute_max_days: MAX_MUTE_DAYS,
      email_in_recipient_list: emailInRecipientList,
    });
  } catch (err) {
    console.error('[UserPrefs] GET failed:', err.message);
    res.status(500).json({ error: 'Failed to load preferences' });
  }
});

/**
 * PUT /api/user-prefs
 * Updates language + theme. Both required in the body; partial updates
 * could be added later but the current modal always sends both.
 */
router.put('/', async (req, res) => {
  try {
    const internalId = req.session?.user?.internal_user_id;
    if (!internalId) {
      return res.status(409).json({ error: 'No user row — log out and back in to initialize.' });
    }

    const { language, theme } = req.body || {};
    try {
      await usersStore.updatePrefs(internalId, { language, theme });
    } catch (validationErr) {
      return res.status(400).json({ error: validationErr.message });
    }

    res.json({ ok: true, language, theme });
  } catch (err) {
    console.error('[UserPrefs] PUT failed:', err.message);
    res.status(500).json({ error: 'Failed to save preferences' });
  }
});

/**
 * POST /api/user-prefs/whats-new-seen
 * Body: { version }
 * Marks the given app version as "seen" by this operator. Drives the
 * unread-dot + one-time toast in the v0.1.7 What's New flow.
 */
router.post('/whats-new-seen', async (req, res) => {
  try {
    const internalId = req.session?.user?.internal_user_id;
    if (!internalId) return res.status(404).json({ error: 'User row missing — log out and back in.' });
    const version = (req.body && typeof req.body.version === 'string') ? req.body.version.trim() : '';
    if (!version) return res.status(400).json({ error: 'version is required' });
    await usersStore.setLastSeenVersion(internalId, version);
    res.json({ ok: true, last_seen_version: version.slice(0, 20) });
  } catch (err) {
    console.error('[UserPrefs] whats-new-seen failed:', err.message);
    res.status(500).json({ error: 'Failed to update' });
  }
});

/**
 * POST /api/user-prefs/mute
 * Body: { starts_at, ends_at, reason? }
 * Creates a new active mute. If an existing mute is active, it's revoked
 * first — operators only have one active mute at a time. Server-side
 * enforces the 60-day cap regardless of client-side picker constraints.
 *
 * Audit-logged: a missed alert investigation needs a clean answer to "who
 * silenced what window."
 */
router.post('/mute', async (req, res) => {
  try {
    const internalId = req.session?.user?.internal_user_id;
    if (!internalId) {
      return res.status(409).json({ error: 'No user row — log out and back in to initialize.' });
    }

    // Reject mute creation for users with no email — the mute would have no
    // effect anyway (notifier filters NULL emails) and would just clutter
    // the audit log. Better UX is to disable the action client-side, but
    // defend in depth.
    const user = await usersStore.getUserById(internalId);
    if (!user) return res.status(404).json({ error: 'User row missing' });
    if (!user.email) {
      return res.status(409).json({
        error: 'Your account has no email address; muting has no effect. Contact your administrator if you should be receiving alert emails.',
      });
    }

    const { starts_at, ends_at, reason } = req.body || {};
    if (!starts_at || !ends_at) {
      return res.status(400).json({ error: 'starts_at and ends_at are required (ISO datetime strings)' });
    }

    const startMs = Date.parse(starts_at);
    const endMs = Date.parse(ends_at);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      return res.status(400).json({ error: 'starts_at and ends_at must be valid ISO datetime strings' });
    }
    if (endMs <= startMs) {
      return res.status(400).json({ error: 'ends_at must be after starts_at' });
    }
    if (endMs - startMs > MAX_MUTE_MS) {
      return res.status(400).json({ error: `Mute duration cannot exceed ${MAX_MUTE_DAYS} days` });
    }
    // Also bound how far in the future the start can be — beyond the cap
    // doesn't make sense.
    if (startMs - Date.now() > MAX_MUTE_MS) {
      return res.status(400).json({ error: `Mute cannot start more than ${MAX_MUTE_DAYS} days from now` });
    }

    const reasonClean = (reason || '').toString().substring(0, 500) || null;

    // Revoke any existing active mute before creating the new one (single-
    // active-mute invariant). Done in-band so the new mute INSERT is atomic
    // for the operator's POV. UTC_TIMESTAMP() for ends_at comparison; for
    // revoked_at we use UTC_TIMESTAMP() too so the column has a consistent
    // UTC value (rather than mixing session-tz NOW() with stored UTC).
    await db.execute(
      `UPDATE operator_mute_periods
          SET revoked_at = UTC_TIMESTAMP()
        WHERE user_id = ?
          AND ends_at > UTC_TIMESTAMP()
          AND revoked_at IS NULL`,
      [internalId]
    );

    // Use raw ISO strings for mysql2 — the feedback memory at
    // feedback_mysql2_execute_date_objects warns about Date object arguments.
    const newId = await db.insert(
      `INSERT INTO operator_mute_periods (user_id, starts_at, ends_at, reason)
       VALUES (?, ?, ?, ?)`,
      [internalId, new Date(startMs).toISOString().slice(0, 19).replace('T', ' '),
                   new Date(endMs).toISOString().slice(0, 19).replace('T', ' '),
                   reasonClean]
    );

    // Invalidate the notifier's 60s mute cache so the new mute takes effect
    // on the next alert without waiting up to a minute.
    try { notifier.invalidateMuteCache(); } catch (_) {}

    // Audit-log
    try {
      await mspAudit.logMspAudit({
        category: mspAudit.CATEGORY.USER_PREFS,
        action: 'mute.create',
        description: `${user.upn} muted alerts from ${starts_at} until ${ends_at}${reasonClean ? ` (${reasonClean})` : ''}`,
        templateKey: reasonClean ? 'mute.create_with_reason' : 'mute.create',
        templateParams: { email: user.upn, startsAt: starts_at, endsAt: ends_at, reason: reasonClean },
        req,
        metadata: {
          mute_id: newId,
          user_id: internalId,
          email: user.email,
          starts_at,
          ends_at,
          reason: reasonClean,
        },
      });
    } catch (auditErr) {
      console.warn('[UserPrefs] Mute audit log failed (non-fatal):', auditErr.message);
    }

    res.json({ ok: true, mute_id: newId });
  } catch (err) {
    console.error('[UserPrefs] POST mute failed:', err.message);
    res.status(500).json({ error: 'Failed to create mute' });
  }
});

/**
 * DELETE /api/user-prefs/mute
 * Revokes the operator's currently active mute (if any). Sets revoked_at,
 * does NOT delete the row — historical record preserved for audit.
 */
router.delete('/mute', async (req, res) => {
  try {
    const internalId = req.session?.user?.internal_user_id;
    if (!internalId) {
      return res.status(409).json({ error: 'No user row — log out and back in to initialize.' });
    }
    const user = await usersStore.getUserById(internalId);
    if (!user) return res.status(404).json({ error: 'User row missing' });

    const affected = await db.execute(
      `UPDATE operator_mute_periods
          SET revoked_at = UTC_TIMESTAMP()
        WHERE user_id = ?
          AND ends_at > UTC_TIMESTAMP()
          AND revoked_at IS NULL`,
      [internalId]
    );
    if (affected === 0) {
      return res.json({ ok: true, revoked: 0, message: 'No active mute to revoke' });
    }

    // Invalidate notifier cache so the unmute takes effect immediately.
    try { notifier.invalidateMuteCache(); } catch (_) {}

    try {
      await mspAudit.logMspAudit({
        category: mspAudit.CATEGORY.USER_PREFS,
        action: 'mute.revoke',
        description: `${user.upn} cancelled their active mute early`,
        templateKey: 'mute.revoke',
        templateParams: { email: user.upn },
        req,
        metadata: { user_id: internalId, email: user.email, affected_rows: affected },
      });
    } catch (auditErr) {
      console.warn('[UserPrefs] Mute revoke audit log failed (non-fatal):', auditErr.message);
    }

    res.json({ ok: true, revoked: affected });
  } catch (err) {
    console.error('[UserPrefs] DELETE mute failed:', err.message);
    res.status(500).json({ error: 'Failed to revoke mute' });
  }
});

/**
 * GET /api/user-prefs/admin/active-mutes
 * Admin-only. Lists every operator currently in an active mute window —
 * supports the multi-operator visibility view in the admin Settings.
 */
router.get('/admin/active-mutes', auth.requireAdmin, async (req, res) => {
  try {
    const rows = await db.queryRows(
      `SELECT m.id, m.user_id, m.starts_at, m.ends_at, m.reason, m.created_at,
              u.upn, u.email, u.display_name, u.role
         FROM operator_mute_periods m
         JOIN users u ON u.id = m.user_id
        WHERE m.starts_at <= UTC_TIMESTAMP()
          AND m.ends_at   >  UTC_TIMESTAMP()
          AND m.revoked_at IS NULL
        ORDER BY m.ends_at ASC`
    );
    res.json({ count: rows.length, mutes: rows });
  } catch (err) {
    console.error('[UserPrefs] admin/active-mutes failed:', err.message);
    res.status(500).json({ error: 'Failed to list active mutes' });
  }
});

module.exports = router;
