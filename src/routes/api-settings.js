/**
 * Panoptica365 — Settings API Routes
 * Read/write SMTP and notification settings to .env with live reload.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const Anthropic = require('@anthropic-ai/sdk');
const { createAiClient } = require('../lib/ai-client');
const auth = require('../auth');
const config = require('../../config/default');
const mspAudit = require('../msp-audit');
const db = require('../db/database');
const { fetchWithTimeout } = require('../lib/http-timeout');

const router = express.Router();
router.use(auth.requireAuth);

// A3 (May 9, 2026): the entire /api/settings surface is admin-only.
// SMTP, notifications, Anthropic key, access-control group mapping are all
// MSP-wide configuration — viewer/operator can neither read nor write.
// Stacked AFTER requireAuth so unauthenticated callers get the 401 redirect
// path instead of the 403 + audit row.
router.use(auth.requireAdmin);

const GUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const ENV_PATH = path.join(__dirname, '..', '..', '.env');

// ─── Helpers ───

/**
 * Parse .env file into a Map preserving order, comments, and blank lines.
 * Returns { lines: string[], vars: Map<string, { lineIdx, value }> }
 */
function parseEnvFile() {
  let content = '';
  try {
    content = fs.readFileSync(ENV_PATH, 'utf-8');
  } catch {
    content = '';
  }

  const lines = content.split('\n');
  const vars = new Map();

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match) {
      vars.set(match[1], { lineIdx: i, value: match[2] });
    }
  }

  return { lines, vars };
}

/**
 * Update (or append) env vars and write back to .env file.
 * Also updates process.env and the live config object.
 */
function updateEnvVars(updates) {
  const { escapeEnvValue } = require('../lib/env-file');
  const { lines, vars } = parseEnvFile();

  for (const [key, value] of Object.entries(updates)) {
    const safeVal = String(value);
    // File line is quote-escaped so a value containing '#'/spaces/etc.
    // round-trips through dotenv instead of being truncated at the '#'.
    const fileVal = escapeEnvValue(value);
    if (vars.has(key)) {
      lines[vars.get(key).lineIdx] = `${key}=${fileVal}`;
    } else {
      lines.push(`${key}=${fileVal}`);
    }
    // Update process.env in place with the RAW (unquoted) value.
    process.env[key] = safeVal;
  }

  fs.writeFileSync(ENV_PATH, lines.join('\n'), 'utf-8');
}

/**
 * Reload the live config.smtp object from current process.env values.
 * Also invalidates any cached nodemailer transporter in notifier/briefing.
 */
function reloadSmtpConfig() {
  config.smtp.host = process.env.SMTP_HOST || 'mail.smtp2go.com';
  config.smtp.port = parseInt(process.env.SMTP_PORT, 10) || 2525;
  config.smtp.auth.user = process.env.SMTP_USER || '';
  config.smtp.auth.pass = process.env.SMTP_PASS || '';
  // May 20, 2026 — MSP-agnostic. Mirror the fallback used at module load
  // in config/default.js so reload + initial-load behavior stay aligned.
  config.smtp.from = process.env.SMTP_FROM || '';

  // Invalidate cached transporters so next send creates a fresh one
  try {
    const notifier = require('../notifier');
    if (notifier._resetTransporter) notifier._resetTransporter();
  } catch { /* ignore */ }
  try {
    const briefing = require('../morning-briefing');
    if (briefing._resetTransporter) briefing._resetTransporter();
  } catch { /* ignore */ }
}

/**
 * Reload notification config from process.env.
 */
function reloadNotificationConfig() {
  config.notification = config.notification || {};
  config.notification.psaEmail = process.env.PSA_EMAIL || '';
  config.notification.psaAttribution = process.env.PSA_ATTRIBUTION || '//${PSA_NAME}//';
  config.notification.notifyEmails = process.env.NOTIFY_EMAILS || '';
}
// PSA integration config (Feature 8.3) live-reloads via its own route file
// (src/routes/api-psa.js reloadPsaConfig). config/default.js parses it at boot.

// ─── SMTP Settings ───

router.get('/smtp', (req, res) => {
  res.json({
    host: config.smtp.host,
    port: config.smtp.port,
    user: config.smtp.auth.user,
    pass_set: !!config.smtp.auth.pass,  // Don't expose actual password
    from: config.smtp.from,
  });
});

router.put('/smtp', (req, res) => {
  try {
    const { host, port, user, pass, from } = req.body;

    const updates = {};
    // Snapshot which fields the operator actually changed. Never store the
    // password itself in the audit metadata — just note "password_rotated: true".
    const changed = [];
    if (host !== undefined && host.trim() !== config.smtp.host) { updates.SMTP_HOST = host.trim(); changed.push('host'); }
    if (port !== undefined && (parseInt(port, 10) || 2525) !== config.smtp.port) { updates.SMTP_PORT = String(parseInt(port, 10) || 2525); changed.push('port'); }
    if (user !== undefined && user.trim() !== config.smtp.auth.user) { updates.SMTP_USER = user.trim(); changed.push('user'); }
    if (pass !== undefined && pass !== '') { updates.SMTP_PASS = pass; changed.push('password'); }
    if (from !== undefined && from.trim() !== config.smtp.from) { updates.SMTP_FROM = from.trim(); changed.push('from'); }

    // Short-circuit no-op saves — don't write an audit row for a redundant save.
    if (Object.keys(updates).length === 0) {
      return res.json({ success: true, no_changes: true });
    }

    updateEnvVars(updates);
    reloadSmtpConfig();

    console.log(`[Settings] SMTP updated by ${req.session.user.email}`);
    mspAudit.logMspAudit({
      category: mspAudit.CATEGORY.SETTINGS_CHANGE,
      action: 'settings.smtp.update',
      description: `SMTP settings changed (${changed.join(', ')})`,
      templateKey: 'settings.smtp.update',
      templateParams: { fields: changed.join(', ') },
      targetType: 'setting',
      targetId: 'smtp',
      targetName: 'SMTP',
      metadata: {
        fields_changed: changed,
        password_rotated: changed.includes('password'),
        // Non-secret values that are safe to record:
        new_host: updates.SMTP_HOST || undefined,
        new_port: updates.SMTP_PORT || undefined,
        new_user: updates.SMTP_USER || undefined,
        new_from: updates.SMTP_FROM || undefined,
      },
      req,
    }).catch(() => {});
    res.json({ success: true });
  } catch (err) {
    console.error('[Settings] SMTP save failed:', err.message);
    mspAudit.logMspAudit({
      category: mspAudit.CATEGORY.SETTINGS_CHANGE,
      action: 'settings.smtp.update',
      description: `SMTP settings save failed: ${err.message}`,
      templateKey: 'settings.smtp.update_failed',
      templateParams: { error: err.message },
      success: false,
      errorMessage: err.message,
      targetType: 'setting',
      targetId: 'smtp',
      req,
    }).catch(() => {});
    res.status(500).json({ error: 'Failed to save SMTP settings' });
  }
});

router.post('/smtp/test', async (req, res) => {
  try {
    const testTransporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: {
        user: config.smtp.auth.user,
        pass: config.smtp.auth.pass,
      },
    });

    // Send a test email to the configured from address
    const testTo = req.body.to || config.smtp.from;

    await testTransporter.sendMail({
      from: config.smtp.from,
      to: testTo,
      subject: 'Panoptica365 — SMTP Test',
      html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="background:#0a0a1a;color:#e0e0e0;font-family:Segoe UI,Arial,sans-serif;margin:0;padding:20px">
  <div style="max-width:480px;margin:0 auto;background:#1a1a2e;border:1px solid #334477;border-radius:8px;padding:24px;text-align:center">
    <div style="font-size:11px;color:#9999cc;text-transform:uppercase;letter-spacing:2px;margin-bottom:12px">SMTP Configuration Test</div>
    <div style="font-size:18px;font-weight:600;color:#27ae60;margin-bottom:8px">Connection Successful</div>
    <div style="font-size:13px;color:#9999cc">
      Host: ${config.smtp.host}:${config.smtp.port}<br>
      From: ${config.smtp.from}<br>
      Time: ${new Date().toLocaleString('en-CA', { timeZone: config.timezone })}
    </div>
    <div style="font-size:11px;color:#666;margin-top:16px">Panoptica365 — Multi-Tenant M365 Monitoring</div>
  </div>
</body>
</html>`,
    });

    console.log(`[Settings] SMTP test email sent to ${testTo} by ${req.session.user.email}`);
    res.json({ success: true, sent_to: testTo });
  } catch (err) {
    console.error('[Settings] SMTP test failed:', err.message);
    res.status(400).json({ error: `SMTP test failed: ${err.message}` });
  }
});

// ─── Notification Settings ───

router.get('/notifications', (req, res) => {
  // Ensure notification config is loaded
  reloadNotificationConfig();

  res.json({
    psa_email: config.notification.psaEmail,
    psa_attribution: config.notification.psaAttribution,
    notify_emails: config.notification.notifyEmails,
  });
});

router.put('/notifications', (req, res) => {
  try {
    const { psa_email, psa_attribution, notify_emails } = req.body;

    // Capture before-state so the audit row is a real diff, not just "something changed".
    reloadNotificationConfig();
    const before = {
      psa_email: config.notification.psaEmail,
      psa_attribution: config.notification.psaAttribution,
      notify_emails: config.notification.notifyEmails,
    };

    const updates = {};
    if (psa_email !== undefined) updates.PSA_EMAIL = psa_email.trim();
    if (psa_attribution !== undefined) updates.PSA_ATTRIBUTION = psa_attribution.trim();
    if (notify_emails !== undefined) updates.NOTIFY_EMAILS = notify_emails.trim();

    updateEnvVars(updates);
    reloadNotificationConfig();

    const diff = {};
    if (updates.PSA_EMAIL !== undefined && updates.PSA_EMAIL !== before.psa_email) {
      diff.psa_email = { from: before.psa_email, to: updates.PSA_EMAIL };
    }
    if (updates.PSA_ATTRIBUTION !== undefined && updates.PSA_ATTRIBUTION !== before.psa_attribution) {
      diff.psa_attribution = { from: before.psa_attribution, to: updates.PSA_ATTRIBUTION };
    }
    if (updates.NOTIFY_EMAILS !== undefined && updates.NOTIFY_EMAILS !== before.notify_emails) {
      diff.notify_emails = { from: before.notify_emails, to: updates.NOTIFY_EMAILS };
    }

    console.log(`[Settings] Notification settings updated by ${req.session.user.email}`);
    if (Object.keys(diff).length > 0) {
      mspAudit.logMspAudit({
        category: mspAudit.CATEGORY.SETTINGS_CHANGE,
        action: 'settings.notifications.update',
        description: `Notification settings changed (${Object.keys(diff).join(', ')})`,
        templateKey: 'settings.notifications.update',
        templateParams: { fields: Object.keys(diff).join(', ') },
        targetType: 'setting',
        targetId: 'notifications',
        targetName: 'Notifications',
        metadata: { diff },
        req,
      }).catch(() => {});
    }
    res.json({ success: true });
  } catch (err) {
    console.error('[Settings] Notification save failed:', err.message);
    res.status(500).json({ error: 'Failed to save notification settings' });
  }
});

// Initialize notification config on module load
reloadNotificationConfig();

// ─── Daily Summary (Morning Briefing) Settings ───
//
// Currently a single tunable: minimum severity threshold for what gets
// surfaced in the daily summary email. MSP-wide setting, admin-only (the
// whole /api/settings surface is admin-only per A3 RBAC). Stored as
// BRIEFING_MIN_SEVERITY in .env; reloaded into config.briefing live so the
// next briefing run picks up the new value without a process restart.
//
// Default 'info' preserves prior behavior (include everything). MSPs with
// many tenants typically dial up to 'medium' or 'high' to cut noise.

const VALID_BRIEFING_SEVERITIES = ['info', 'low', 'medium', 'high', 'severe'];

function reloadBriefingConfig() {
  config.briefing = config.briefing || {};
  config.briefing.minSeverity = (process.env.BRIEFING_MIN_SEVERITY || 'info').toLowerCase();
  // Mirror into the briefing module so the cron-loaded copy refreshes too.
  try {
    const briefing = require('../morning-briefing');
    if (briefing._reloadBriefingConfig) briefing._reloadBriefingConfig();
  } catch { /* ignore */ }
}

router.get('/briefing', (req, res) => {
  reloadBriefingConfig();
  res.json({
    min_severity: config.briefing.minSeverity || 'info',
    valid_severities: VALID_BRIEFING_SEVERITIES,
  });
});

router.put('/briefing', (req, res) => {
  try {
    const { min_severity } = req.body || {};
    if (min_severity === undefined) {
      return res.status(400).json({ error: 'min_severity is required' });
    }
    const next = String(min_severity).trim().toLowerCase();
    if (!VALID_BRIEFING_SEVERITIES.includes(next)) {
      return res.status(400).json({
        error: `min_severity must be one of: ${VALID_BRIEFING_SEVERITIES.join(', ')}`,
      });
    }

    reloadBriefingConfig();
    const before = config.briefing.minSeverity || 'info';

    if (next === before) {
      return res.json({ success: true, no_changes: true });
    }

    updateEnvVars({ BRIEFING_MIN_SEVERITY: next });
    reloadBriefingConfig();

    console.log(`[Settings] Daily summary min severity: ${before} → ${next} (by ${req.session.user.email})`);
    mspAudit.logMspAudit({
      category: mspAudit.CATEGORY.SETTINGS_CHANGE,
      action: 'settings.briefing.update',
      description: `Daily summary minimum severity changed: ${before} → ${next}`,
      templateKey: 'settings.briefing.update',
      templateParams: { from: before, to: next },
      targetType: 'setting',
      targetId: 'briefing',
      targetName: 'Daily Summary',
      metadata: { diff: { min_severity: { from: before, to: next } } },
      req,
    }).catch(() => {});

    res.json({ success: true });
  } catch (err) {
    console.error('[Settings] Briefing save failed:', err.message);
    mspAudit.logMspAudit({
      category: mspAudit.CATEGORY.SETTINGS_CHANGE,
      action: 'settings.briefing.update',
      description: `Daily summary settings save failed: ${err.message}`,
      templateKey: 'settings.briefing.update_failed',
      templateParams: { error: err.message },
      success: false,
      errorMessage: err.message,
      targetType: 'setting',
      targetId: 'briefing',
      req,
    }).catch(() => {});
    res.status(500).json({ error: 'Failed to save daily summary settings' });
  }
});

// Initialize briefing config on module load
reloadBriefingConfig();

// ─── Microsoft Message Center Feed (Feature 8.8) ───
//
// MSP-level setting: the Azure tenant GUID the daily Message Center worker
// pulls from. Empty/unset = None / disabled (default — no pull, no alerts).
// Stored as MESSAGE_CENTER_SOURCE_TENANT in .env; reloaded into
// config.messageCenter.sourceTenant live so the next daily cycle reads the
// new value without a restart. Admin-only (the whole surface is requireAdmin).
//
// Mirrors the BRIEFING_MIN_SEVERITY flow above; the only extra step is
// validating that the chosen GUID belongs to a tenant Panoptica365 knows.

function reloadMessageCenterConfig() {
  config.messageCenter = config.messageCenter || {};
  config.messageCenter.sourceTenant = process.env.MESSAGE_CENTER_SOURCE_TENANT || '';
}

router.get('/message-center', async (req, res) => {
  reloadMessageCenterConfig();
  const guid = config.messageCenter.sourceTenant || '';
  let sourceTenantName = null;
  if (guid) {
    try {
      const row = await db.queryOne(
        'SELECT display_name FROM tenants WHERE tenant_id = ? LIMIT 1',
        [guid]
      );
      sourceTenantName = row ? row.display_name : null;
    } catch (err) {
      console.warn('[Settings] message-center tenant name lookup failed:', err.message);
    }
  }
  res.json({
    source_tenant: guid || null,
    source_tenant_name: sourceTenantName,
  });
});

router.put('/message-center', async (req, res) => {
  try {
    let { source_tenant } = req.body || {};
    if (source_tenant === undefined) {
      return res.status(400).json({ error: 'source_tenant is required (use null/empty for None)' });
    }

    // Normalize: null / '' / 'none' all mean "disable".
    let next = (source_tenant === null) ? '' : String(source_tenant).trim();
    if (next.toLowerCase() === 'none') next = '';

    // If enabling/switching, validate the GUID format AND that it belongs to a
    // tenant we know. Empty = disable (always allowed).
    let nextName = null;
    if (next) {
      if (!GUID_RE.test(next)) {
        return res.status(400).json({ error: 'source_tenant is not a valid tenant GUID' });
      }
      const row = await db.queryOne(
        'SELECT display_name FROM tenants WHERE tenant_id = ? LIMIT 1',
        [next]
      );
      if (!row) {
        return res.status(400).json({ error: 'source_tenant does not match any known tenant' });
      }
      nextName = row.display_name;
    }

    reloadMessageCenterConfig();
    const before = config.messageCenter.sourceTenant || '';
    if (next === before) {
      return res.json({ success: true, no_changes: true });
    }

    // Resolve the previous GUID to a display name for the audit "from" param.
    let beforeName = null;
    if (before) {
      try {
        const prev = await db.queryOne(
          'SELECT display_name FROM tenants WHERE tenant_id = ? LIMIT 1',
          [before]
        );
        beforeName = prev ? prev.display_name : before;
      } catch { beforeName = before; }
    }

    updateEnvVars({ MESSAGE_CENTER_SOURCE_TENANT: next });
    reloadMessageCenterConfig();

    const fromLabel = beforeName || 'None';
    const toLabel = nextName || 'None';
    console.log(`[Settings] Message Center source tenant: ${fromLabel} → ${toLabel} (by ${req.session.user.email})`);
    mspAudit.logMspAudit({
      category: mspAudit.CATEGORY.SETTINGS_CHANGE,
      action: 'settings.message_center.update',
      description: `Microsoft Message Center source tenant changed: ${fromLabel} → ${toLabel}`,
      templateKey: 'settings.message_center.update',
      templateParams: { from: fromLabel, to: toLabel },
      targetType: 'setting',
      targetId: 'message_center',
      targetName: 'Microsoft message feed',
      metadata: { diff: { source_tenant: { from: before || null, to: next || null } } },
      req,
    }).catch(() => {});

    res.json({ success: true, source_tenant: next || null, source_tenant_name: nextName });
  } catch (err) {
    console.error('[Settings] Message Center save failed:', err.message);
    res.status(500).json({ error: 'Failed to save Microsoft message feed settings' });
  }
});

// Initialize message-center config on module load
reloadMessageCenterConfig();

// ─── Access Control (3 Entra group Object IDs) ───
//
// Stored in .env as ENTRA_ADMIN_GROUP_ID / ENTRA_MEMBER_GROUP_ID / ENTRA_VIEWER_GROUP_ID.
// admin falls back to ENTRA_AUTHORIZED_GROUP_ID (legacy single-tier var) when unset.
// Route-level enforcement is NOT yet wired — this card only persists and verifies IDs.

function reloadAccessControlConfig() {
  config.entra.adminGroupId  = process.env.ENTRA_ADMIN_GROUP_ID  || process.env.ENTRA_AUTHORIZED_GROUP_ID || '';
  config.entra.memberGroupId = process.env.ENTRA_MEMBER_GROUP_ID || '';
  config.entra.viewerGroupId = process.env.ENTRA_VIEWER_GROUP_ID || '';
}

router.get('/access-control', (req, res) => {
  reloadAccessControlConfig();
  res.json({
    admin_group_id:  config.entra.adminGroupId  || '',
    member_group_id: config.entra.memberGroupId || '',
    viewer_group_id: config.entra.viewerGroupId || '',
    enforced: false, // flip to true when middleware enforcement ships
  });
});

router.put('/access-control', (req, res) => {
  try {
    const { admin_group_id, member_group_id, viewer_group_id } = req.body || {};

    // Empty string is valid (clears the group).
    for (const [label, v] of [['admin', admin_group_id], ['member', member_group_id], ['viewer', viewer_group_id]]) {
      if (v === undefined || v === null) continue;
      const trimmed = String(v).trim();
      if (trimmed !== '' && !GUID_RE.test(trimmed)) {
        return res.status(400).json({ error: `${label} group ID is not a valid GUID` });
      }
    }

    reloadAccessControlConfig();
    const before = {
      admin:  config.entra.adminGroupId  || '',
      member: config.entra.memberGroupId || '',
      viewer: config.entra.viewerGroupId || '',
    };

    const updates = {};
    if (admin_group_id  !== undefined) updates.ENTRA_ADMIN_GROUP_ID  = String(admin_group_id).trim();
    if (member_group_id !== undefined) updates.ENTRA_MEMBER_GROUP_ID = String(member_group_id).trim();
    if (viewer_group_id !== undefined) updates.ENTRA_VIEWER_GROUP_ID = String(viewer_group_id).trim();

    updateEnvVars(updates);
    reloadAccessControlConfig();

    // Group IDs are not secrets — they're tenant-scoped directory identifiers,
    // safe to log in full. A change here is a privilege-grant event and needs
    // to be visible in the audit journal with before/after for forensic review.
    const diff = {};
    if (updates.ENTRA_ADMIN_GROUP_ID  !== undefined && updates.ENTRA_ADMIN_GROUP_ID  !== before.admin)  diff.admin  = { from: before.admin  || null, to: updates.ENTRA_ADMIN_GROUP_ID  || null };
    if (updates.ENTRA_MEMBER_GROUP_ID !== undefined && updates.ENTRA_MEMBER_GROUP_ID !== before.member) diff.member = { from: before.member || null, to: updates.ENTRA_MEMBER_GROUP_ID || null };
    if (updates.ENTRA_VIEWER_GROUP_ID !== undefined && updates.ENTRA_VIEWER_GROUP_ID !== before.viewer) diff.viewer = { from: before.viewer || null, to: updates.ENTRA_VIEWER_GROUP_ID || null };

    console.log(`[Settings] Access-control groups updated by ${req.session.user.email}`);
    if (Object.keys(diff).length > 0) {
      mspAudit.logMspAudit({
        category: mspAudit.CATEGORY.RBAC_CHANGE,
        action: 'rbac.group_mapping.update',
        description: `Access-control group mapping changed (${Object.keys(diff).join(', ')}) — takes effect on next login`,
        templateKey: 'rbac.group_mapping.update',
        templateParams: { fields: Object.keys(diff).join(', ') },
        targetType: 'setting',
        targetId: 'access_control',
        targetName: 'RBAC Group Mapping',
        metadata: { diff },
        req,
      }).catch(() => {});
    }
    res.json({ success: true });
  } catch (err) {
    console.error('[Settings] Access-control save failed:', err.message);
    res.status(500).json({ error: 'Failed to save access control settings' });
  }
});

/**
 * Verify that an Object ID resolves to an Entra group in the MSP's own tenant.
 * Uses the existing app-only client-credentials flow (acquireTokenForTenant) —
 * requires Group.Read.All or Directory.Read.All Application permission on the
 * Panoptica app registration, granted and consented in the MSP tenant.
 */
router.get('/access-control/verify-group/:id', async (req, res) => {
  const id = String(req.params.id || '').trim();
  if (!GUID_RE.test(id)) {
    return res.status(400).json({ error: 'Not a valid GUID' });
  }

  const mspTenantId = config.entra.tenantId;
  if (!mspTenantId) {
    return res.status(500).json({ error: 'ENTRA_TENANT_ID is not configured' });
  }

  try {
    const token = await auth.acquireTokenForTenant(mspTenantId);
    const url = `${config.graph.baseUrl}/groups/${encodeURIComponent(id)}?$select=id,displayName,description,mailNickname,securityEnabled`;
    const graphRes = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${token}` } });

    if (graphRes.status === 404) {
      return res.status(404).json({ error: 'Group not found in your tenant' });
    }
    if (graphRes.status === 403) {
      return res.status(403).json({
        error: 'Panoptica app lacks Group.Read.All (or Directory.Read.All) permission on your tenant. Add it in Entra → App registrations → API permissions and grant admin consent.',
      });
    }
    if (!graphRes.ok) {
      const text = await graphRes.text().catch(() => '');
      return res.status(graphRes.status).json({ error: `Graph ${graphRes.status}: ${text.slice(0, 200)}` });
    }

    const data = await graphRes.json();
    res.json({
      id: data.id,
      display_name: data.displayName || '(unnamed)',
      description: data.description || '',
      mail_nickname: data.mailNickname || '',
      security_enabled: !!data.securityEnabled,
    });
  } catch (err) {
    console.error('[Settings] Group verify failed:', err.message);
    res.status(500).json({ error: `Verify failed: ${err.message}` });
  }
});

// ─── Anthropic API Key ───
//
// Stored in .env as ANTHROPIC_API_KEY. Returned to the UI as a preview only
// (prefix + last 4). Save writes .env and updates process.env so the running
// process picks up the new key immediately. Test fires a tiny Claude call.
// TODO(pre-GA): envelope-encrypt at rest. Today the key is plain in .env on
// the server, protected only by filesystem permissions.

function maskKey(k) {
  if (!k) return '';
  const s = String(k);
  if (s.length <= 12) return s.slice(0, 4) + '…';
  const prefix = s.startsWith('sk-ant-') ? 'sk-ant-' : s.slice(0, 7);
  return `${prefix}…${s.slice(-4)}`;
}

router.get('/anthropic-key', (req, res) => {
  const key = process.env.ANTHROPIC_API_KEY || '';
  res.json({
    key_set: !!key,
    key_preview: maskKey(key),
  });
});

router.post('/anthropic-key/test', async (req, res) => {
  // Test either a key the user has pasted (req.body.key) or the currently-configured one.
  const provided = (req.body && typeof req.body.key === 'string') ? req.body.key.trim() : '';
  const keyToTest = provided || process.env.ANTHROPIC_API_KEY || '';

  if (!keyToTest) {
    return res.status(400).json({ error: 'No key to test' });
  }
  if (!keyToTest.startsWith('sk-ant-')) {
    return res.status(400).json({ error: 'Key does not look like an Anthropic key (expected sk-ant- prefix)' });
  }

  try {
    const client = createAiClient(keyToTest, { timeoutMs: 30000 }); // operator is waiting on a spinner
    const result = await client.messages.create({
      model: config.ai.haikuModel || 'claude-haiku-4-5-20251001',
      max_tokens: 8,
      messages: [{ role: 'user', content: 'ping' }],
    });
    const replied = !!(result && result.content && result.content.length);
    console.log(`[Settings] Anthropic key test OK by ${req.session.user.email} (model=${result.model})`);
    res.json({ success: true, model: result.model, replied });
  } catch (err) {
    const status = err && err.status ? err.status : 500;
    const msg = err && err.message ? err.message : String(err);
    // Avoid echoing any key fragment back
    const safeMsg = msg.replace(/sk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-[REDACTED]');
    console.warn(`[Settings] Anthropic key test failed (${status}): ${safeMsg}`);
    res.status(status >= 400 && status < 600 ? status : 500).json({ error: safeMsg });
  }
});

router.put('/anthropic-key', (req, res) => {
  try {
    const key = req.body && typeof req.body.key === 'string' ? req.body.key.trim() : '';
    if (!key) {
      return res.status(400).json({ error: 'Key is required' });
    }
    if (!key.startsWith('sk-ant-')) {
      return res.status(400).json({ error: 'Key does not look like an Anthropic key (expected sk-ant- prefix)' });
    }

    const oldPreview = maskKey(process.env.ANTHROPIC_API_KEY || '');
    const newPreview = maskKey(key);

    updateEnvVars({ ANTHROPIC_API_KEY: key });
    // Also refresh the live config pointer so callers who read config.ai.apiKey
    // (instead of process.env) see the new value.
    if (config.ai) config.ai.apiKey = key;

    console.log(`[Settings] Anthropic key rotated by ${req.session.user.email} (preview=${newPreview})`);
    // NEVER store the full key in audit metadata. Store only masked previews
    // of old and new so a reviewer can confirm "the key changed" without
    // exposing any secret material.
    mspAudit.logMspAudit({
      category: mspAudit.CATEGORY.SETTINGS_CHANGE,
      action: 'settings.anthropic_key.rotate',
      description: `Anthropic API key rotated (preview: ${oldPreview || '(unset)'} → ${newPreview})`,
      templateKey: 'settings.anthropic_key.rotate',
      templateParams: { oldPreview: oldPreview || '(unset)', newPreview },
      targetType: 'setting',
      targetId: 'anthropic_key',
      targetName: 'Anthropic API Key',
      metadata: {
        old_preview: oldPreview || null,
        new_preview: newPreview,
        was_set: !!process.env.ANTHROPIC_API_KEY,
      },
      req,
    }).catch(() => {});
    res.json({ success: true, key_preview: newPreview });
  } catch (err) {
    console.error('[Settings] Anthropic key save failed:', err.message);
    mspAudit.logMspAudit({
      category: mspAudit.CATEGORY.SETTINGS_CHANGE,
      action: 'settings.anthropic_key.rotate',
      description: `Anthropic API key rotation failed: ${err.message}`,
      templateKey: 'settings.anthropic_key.rotate_failed',
      templateParams: { error: err.message },
      success: false,
      errorMessage: err.message,
      targetType: 'setting',
      targetId: 'anthropic_key',
      req,
    }).catch(() => {});
    res.status(500).json({ error: 'Failed to save Anthropic key' });
  }
});

// Initialize access-control config on module load
reloadAccessControlConfig();

// ─── Report Branding ───
//
// Two pieces of MSP-facing branding that appear on customer report PDFs:
//   1. Company name — drives the "Prepared by ___" footer line (see
//      scripts/generate-pdf-report.py and config.report.mspName). Stored as
//      MSP_NAME in .env and mirrored into config.report.mspName so the next
//      report picks it up with no process restart.
//   2. Logo — a transparent PNG written to data/branding/logo.png. Lives on
//      disk (not .env) because it's binary; the report generator reads it from
//      that fixed path. The cover-page rendering is a separate, later task —
//      this card only stores the asset.
//
// The logo arrives as a base64 data URL in the JSON body (keeps us off a
// multer dependency). server.js mounts a higher-limit express.json() for this
// path so the encoded PNG clears the default ~100kb body cap.

const BRANDING_DIR = path.join(__dirname, '..', '..', 'data', 'branding');
const LOGO_PATH = path.join(BRANDING_DIR, 'logo.png');
const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2 MB decoded
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function reloadReportConfig() {
  config.report = config.report || {};
  config.report.mspName = process.env.MSP_NAME || '';
}

router.get('/branding', (req, res) => {
  reloadReportConfig();
  let logoSet = false;
  let logoMtime = 0;
  try {
    const st = fs.statSync(LOGO_PATH);
    logoSet = st.isFile() && st.size > 0;
    logoMtime = Math.floor(st.mtimeMs);
  } catch { /* no logo yet */ }
  res.json({
    company_name: config.report.mspName || '',
    logo_set: logoSet,
    // Cache-busted by mtime so the <img> preview refreshes after a re-upload.
    logo_url: logoSet ? `/api/settings/branding/logo?v=${logoMtime}` : null,
  });
});

// Stream the stored logo back for the Settings preview. Admin-only like the
// whole /api/settings surface (requireAuth + requireAdmin above).
router.get('/branding/logo', (req, res) => {
  fs.stat(LOGO_PATH, (err, st) => {
    if (err || !st.isFile() || st.size === 0) {
      return res.status(404).json({ error: 'No logo uploaded' });
    }
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'no-store');
    fs.createReadStream(LOGO_PATH).pipe(res);
  });
});

router.put('/branding', (req, res) => {
  try {
    const { company_name, logo, remove_logo } = req.body || {};
    const changed = [];

    // ── Company name → MSP_NAME ──
    if (company_name !== undefined) {
      reloadReportConfig();
      const next = String(company_name).trim();
      if (next !== (config.report.mspName || '')) {
        updateEnvVars({ MSP_NAME: next });
        reloadReportConfig();
        changed.push('company_name');
      }
    }

    // ── Logo ── (remove takes precedence over upload)
    if (remove_logo === true) {
      try {
        fs.unlinkSync(LOGO_PATH);
        changed.push('logo_removed');
      } catch (e) {
        if (e.code !== 'ENOENT') throw e; // already absent is fine
      }
    } else if (logo !== undefined && logo !== null && logo !== '') {
      // Accept a data URL (data:image/png;base64,...) or bare base64.
      const m = String(logo).match(/^data:([^;]+);base64,(.*)$/s);
      const declaredType = m ? m[1] : null;
      const b64 = m ? m[2] : String(logo);
      if (declaredType && declaredType !== 'image/png') {
        return res.status(400).json({ error: 'Logo must be a PNG' });
      }
      const buf = Buffer.from(b64, 'base64');
      if (!buf || buf.length === 0) {
        return res.status(400).json({ error: 'Logo is empty or not valid base64' });
      }
      if (buf.length > MAX_LOGO_BYTES) {
        return res.status(400).json({ error: 'Logo exceeds the 2 MB limit' });
      }
      // Validate the PNG magic number — don't trust the declared type alone.
      if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
        return res.status(400).json({ error: 'Logo must be a PNG' });
      }
      fs.mkdirSync(BRANDING_DIR, { recursive: true });
      fs.writeFileSync(LOGO_PATH, buf);
      changed.push('logo');
    }

    if (changed.length === 0) {
      return res.json({ success: true, no_changes: true });
    }

    console.log(`[Settings] Branding updated by ${req.session.user.email} (${changed.join(', ')})`);
    mspAudit.logMspAudit({
      category: mspAudit.CATEGORY.SETTINGS_CHANGE,
      action: 'settings.branding.update',
      description: `Report branding changed (${changed.join(', ')})`,
      templateKey: 'settings.branding.update',
      templateParams: { fields: changed.join(', ') },
      targetType: 'setting',
      targetId: 'branding',
      targetName: 'Report Branding',
      metadata: {
        fields_changed: changed,
        company_name: config.report.mspName || null,
      },
      req,
    }).catch(() => {});

    res.json({ success: true });
  } catch (err) {
    console.error('[Settings] Branding save failed:', err.message);
    res.status(500).json({ error: 'Failed to save branding settings' });
  }
});

// ─── Data retention (Reliability P0, 2026-06-12; editable same day) ───
//
// The Settings → Data retention card shows AND edits the windows the nightly
// retention worker enforces. Values persist as RETENTION_* vars in .env (via
// the quote-safe updateEnvVars) and live-reload into config.retention, so
// the next 03:30 cycle uses them without a restart.
//
// Bounds are guardrails against foot-guns: 0 = keep forever where allowed;
// the metric raw window has NO forever option (unbounded raw poll history is
// the 20 GB-in-2-months failure mode) and needs ≥2 days so the snapshot-delta
// alert engine always has a previous poll across the day boundary; the
// Secure Score daily history must cover the longest report period (90 days).
const RETENTION_FIELDS = [
  { key: 'defender_incidents',         env: 'RETENTION_DEFENDER_INCIDENTS_DAYS', def: 395, min: 30, max: 3650, allowZero: true },
  { key: 'identity_timeline_analysis', env: 'RETENTION_IDENTITY_TIMELINE_DAYS',  def: 90,  min: 7,  max: 3650, allowZero: true },
  { key: 'heatmap_posture_daily',      env: 'RETENTION_HEATMAP_DAYS',            def: 730, min: 30, max: 3650, allowZero: true },
  { key: 'message_center_items',       env: 'RETENTION_MESSAGE_CENTER_DAYS',     def: 365, min: 30, max: 3650, allowZero: true },
  { key: 'msp_audit_events',           env: 'RETENTION_MSP_AUDIT_DAYS',          def: 730, min: 90, max: 3650, allowZero: true },
  { key: 'tenant_change_events',       env: 'RETENTION_TENANT_CHANGES_DAYS',     def: 730, min: 90, max: 3650, allowZero: true },
  // No keep-forever: unbounded raw UAL is the growth footgun this caps (same
  // posture as metric_snapshots_raw). 30-day floor keeps the identity timeline
  // useful. Purview holds anything longer.
  { key: 'ual_events',                 env: 'RETENTION_UAL_EVENTS_DAYS',         def: 90,  min: 30, max: 3650, allowZero: false },
  { key: 'metric_snapshots_raw',       env: 'RETENTION_METRIC_RAW_DAYS',         def: 7,   min: 2,  max: 90,   allowZero: false },
  { key: 'metric_snapshots_agg',       env: 'RETENTION_METRIC_AGG_DAYS',         def: 730, min: 90, max: 3650, allowZero: true },
];

// Mirror config/default.js's retention block from current process.env so a
// save takes effect on the next nightly cycle without a restart.
function reloadRetentionConfig() {
  const val = (env, def) => {
    const n = parseInt(process.env[env], 10);
    return Number.isFinite(n) && n >= 0 ? n : def;
  };
  config.retention = config.retention || { days: {}, metricSnapshots: {} };
  for (const f of RETENTION_FIELDS) {
    if (f.key === 'metric_snapshots_raw') {
      config.retention.metricSnapshots.rawDays = parseInt(process.env[f.env], 10) || f.def;
    } else if (f.key === 'metric_snapshots_agg') {
      config.retention.metricSnapshots.aggDays = val(f.env, f.def);
    } else {
      config.retention.days[f.key] = val(f.env, f.def);
    }
  }
}

function currentRetentionDays(field) {
  const retentionWorker = require('../retention-worker');
  if (field.key === 'metric_snapshots_raw') return retentionWorker.metricRawDays();
  if (field.key === 'metric_snapshots_agg') return retentionWorker.metricAggDays();
  return config.retention?.days?.[field.key] ?? field.def;
}

router.get('/retention', (req, res) => {
  const windows = RETENTION_FIELDS.map(f => ({
    table: f.key,
    days: currentRetentionDays(f),
    default: f.def,
    min: f.min,
    max: f.max,
    allow_zero: f.allowZero,
  }));
  res.json({ windows });
});

router.put('/retention', (req, res) => {
  try {
    const body = (req.body && req.body.windows) || {};
    const updates = {};
    const changed = [];

    for (const f of RETENTION_FIELDS) {
      if (body[f.key] === undefined) continue;
      const v = Number(body[f.key]);
      const valid = Number.isInteger(v)
        && ((f.allowZero && v === 0) || (v >= f.min && v <= f.max));
      if (!valid) {
        return res.status(400).json({
          error: 'invalid_value',
          field: f.key,
          min: f.min,
          max: f.max,
          allow_zero: f.allowZero,
        });
      }
      if (v !== currentRetentionDays(f)) {
        updates[f.env] = String(v);
        changed.push(`${f.key}=${v}`);
      }
    }

    if (changed.length === 0) {
      return res.json({ success: true, no_changes: true });
    }

    updateEnvVars(updates);
    reloadRetentionConfig();

    console.log(`[Settings] Data retention updated by ${req.session.user.email} (${changed.join(', ')})`);
    mspAudit.logMspAudit({
      category: mspAudit.CATEGORY.SETTINGS_CHANGE,
      action: 'settings.retention.update',
      description: `Data retention windows changed (${changed.join(', ')})`,
      templateKey: 'settings.retention.update',
      templateParams: { fields: changed.join(', ') },
      targetType: 'setting',
      targetId: 'retention',
      targetName: 'Data Retention',
      metadata: { fields_changed: changed },
      req,
    }).catch(() => {});

    res.json({ success: true });
  } catch (err) {
    console.error('[Settings] Retention save failed:', err.message);
    res.status(500).json({ error: 'Failed to save retention settings' });
  }
});

// Initialize report config on module load
reloadReportConfig();

module.exports = router;
