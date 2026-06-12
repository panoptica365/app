/**
 * Panoptica365 — Audit-Only Tenant Expiry Scheduler
 *
 * Daily cron job that handles the audit_only tenant lifecycle:
 *   Day 14: send "expires in 7 days" warning email to the MSP admin
 *   Day 21 (audit_expires_at + 7-day grace): cascade-delete the tenant +
 *          send "tenant deleted, advise customer to revoke Panoptica365
 *          enterprise app" email with revocation steps.
 *
 * Idempotent: safe to run multiple times in a day (tracks audit_expiry_warned_at
 * for the warning pass; the delete pass is naturally idempotent because the
 * tenant row disappears).
 */

const cron = require('node-cron');
const nodemailer = require('nodemailer');
const config = require('../config/default');
const db = require('./db/database');
const tenantMode = require('./lib/tenant-mode');
const cascadeDelete = require('./lib/tenant-cascade-delete');
const workerHeartbeat = require('./worker-heartbeat');

let cronJob = null;
let transporter = null;

const GRACE_DAYS = 7;

function getTransporter() {
  if (!transporter && config.smtp && config.smtp.host) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.auth ? {
        user: config.smtp.auth.user,
        pass: config.smtp.auth.pass,
      } : undefined,
    });
  }
  return transporter;
}

function getOperatorEmails() {
  const raw = (config.notification && config.notification.notifyEmails) || '';
  return raw.split(',').map(e => e.trim()).filter(Boolean);
}

async function sendMail({ subject, html, text }) {
  const recipients = getOperatorEmails();
  if (recipients.length === 0) {
    console.warn('[AuditExpiry] No operator emails configured — skipping send.');
    return false;
  }
  const t = getTransporter();
  if (!t) {
    console.warn('[AuditExpiry] No SMTP transporter — skipping send.');
    return false;
  }
  try {
    await t.sendMail({
      from: (config.smtp && config.smtp.from) || 'panoptica@localhost',
      to: recipients.join(', '),
      subject,
      text,
      html,
    });
    return true;
  } catch (e) {
    console.error('[AuditExpiry] sendMail failed:', e.message);
    return false;
  }
}

// ─── Email bodies ───────────────────────────────────────────────────────────

function buildWarningEmail(tenant) {
  const expiresAt = new Date(tenant.audit_expires_at + 'Z');
  const deleteAt  = new Date(expiresAt.getTime() + GRACE_DAYS * 24 * 60 * 60 * 1000);
  const fmtDate = d => d.toLocaleString('en-CA', { dateStyle: 'long', timeStyle: 'short' });

  const subject = `[Panoptica365] Audit-only tenant "${tenant.display_name}" expires in ${GRACE_DAYS} days`;
  const text = [
    `The audit-only tenant "${tenant.display_name}" (${tenant.tenant_id}) is now past its 14-day audit window.`,
    ``,
    `It will be HARD DELETED from Panoptica365 on:`,
    `  ${fmtDate(deleteAt)}`,
    ``,
    `If you want to keep monitoring this tenant beyond the grace period, convert it to Managed mode in Panoptica before that date (Tenants → Edit).`,
    ``,
    `If you do nothing, all data Panoptica has collected for this tenant — snapshots, alerts, audit log entries, change events — will be permanently removed at the deletion time. The Panoptica365 enterprise application consent in the customer's Microsoft 365 tenant is NOT removed automatically; see the post-deletion email for revocation steps.`,
    ``,
    `— Panoptica365`,
  ].join('\n');

  const html = `
    <div style="font-family:Arial,sans-serif; font-size:14px; color:#1a1a1a; line-height:1.5;">
      <p>The audit-only tenant <strong>${escapeHtml(tenant.display_name)}</strong>
      (<code>${escapeHtml(tenant.tenant_id)}</code>) is now past its 14-day audit window.</p>

      <p style="background:#FFF4E5; border-left:4px solid #E65100; padding:12px 16px;">
        <strong>It will be HARD DELETED from Panoptica365 on:</strong><br>
        <span style="font-size:16px;">${fmtDate(deleteAt)}</span>
      </p>

      <p>If you want to keep monitoring this tenant beyond the grace period,
      convert it to <strong>Managed</strong> mode in Panoptica before that date
      (Tenants → Edit).</p>

      <p>If you do nothing, all data Panoptica has collected for this tenant —
      snapshots, alerts, audit log entries, change events — will be permanently
      removed at the deletion time. The Panoptica365 enterprise application
      consent in the customer's Microsoft 365 tenant is <strong>not</strong>
      removed automatically; see the post-deletion email for revocation steps.</p>

      <p style="color:#888; font-size:12px;">— Panoptica365</p>
    </div>
  `;
  return { subject, text, html };
}

function buildDeletedEmail(tenant, deleteResult) {
  const subject = `[Panoptica365] Audit-only tenant "${tenant.display_name}" deleted — please advise customer to revoke enterprise app`;

  const revokeStepsText = [
    `The customer (or their admin) must remove the Panoptica365 enterprise app from their tenant:`,
    `  1. Sign in to https://entra.microsoft.com as a Global Administrator of the customer tenant.`,
    `  2. Identity → Applications → Enterprise applications.`,
    `  3. Search for "Panoptica365" and select it.`,
    `  4. Properties → Delete (then confirm).`,
    `  5. Optionally: Identity → Applications → App registrations → search for "Panoptica365" and delete that too if present.`,
  ].join('\n');

  const text = [
    `The audit-only tenant "${tenant.display_name}" (${tenant.tenant_id}) has been hard-deleted from Panoptica365.`,
    ``,
    `Cascade delete summary:`,
    `  - Total rows removed: ${deleteResult.totalRowsDeleted}`,
    `  - Tables touched: ${deleteResult.perTable.length}`,
    `  - Errors: ${deleteResult.errors.length}`,
    ``,
    `IMPORTANT: the Panoptica365 enterprise app consent is STILL present in the customer's Microsoft 365 tenant. Until they revoke it, the app remains visible to them and could be re-onboarded.`,
    ``,
    revokeStepsText,
    ``,
    `Forward these steps to the customer if you don't have direct access to their tenant.`,
    ``,
    `— Panoptica365`,
  ].join('\n');

  const errorsHtml = deleteResult.errors.length
    ? `<details style="margin-top:8px;"><summary style="cursor:pointer; color:#888;">${deleteResult.errors.length} error(s) during cascade — click to expand</summary><pre style="background:#f5f5f5; padding:8px; font-size:11px; overflow:auto;">${escapeHtml(JSON.stringify(deleteResult.errors, null, 2))}</pre></details>`
    : '';

  const html = `
    <div style="font-family:Arial,sans-serif; font-size:14px; color:#1a1a1a; line-height:1.5;">
      <p>The audit-only tenant <strong>${escapeHtml(tenant.display_name)}</strong>
      (<code>${escapeHtml(tenant.tenant_id)}</code>) has been hard-deleted from Panoptica365.</p>

      <p style="background:#F5F9FC; border-left:4px solid #1565C0; padding:12px 16px;">
        <strong>Cascade delete summary</strong><br>
        Total rows removed: <strong>${deleteResult.totalRowsDeleted}</strong><br>
        Tables touched: ${deleteResult.perTable.length}<br>
        Errors: ${deleteResult.errors.length}
        ${errorsHtml}
      </p>

      <p style="background:#FFF4E5; border-left:4px solid #E65100; padding:12px 16px;">
        <strong>Action required:</strong> the Panoptica365 enterprise app consent is
        <strong>still present</strong> in the customer's Microsoft 365 tenant.
        Until they revoke it, the app remains visible to them and could be
        re-onboarded.
      </p>

      <p><strong>Steps to revoke (forward these to the customer if you don't
      have direct access):</strong></p>
      <ol style="line-height:1.8;">
        <li>Sign in to <a href="https://entra.microsoft.com">https://entra.microsoft.com</a>
            as a Global Administrator of the customer tenant.</li>
        <li>Identity → Applications → Enterprise applications.</li>
        <li>Search for <strong>Panoptica365</strong> and select it.</li>
        <li>Properties → <strong>Delete</strong> (then confirm).</li>
        <li>Optionally: Identity → Applications → App registrations → search
            for <strong>Panoptica365</strong> and delete that too if present.</li>
      </ol>

      <p style="color:#888; font-size:12px;">— Panoptica365</p>
    </div>
  `;
  return { subject, text, html };
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Pass 1: Warning ────────────────────────────────────────────────────────

async function processWarnings() {
  const warnings = await db.queryRows(
    `SELECT id, tenant_id, display_name, audit_expires_at
     FROM tenants
     WHERE mode = 'audit_only'
       AND enabled = TRUE
       AND audit_expires_at IS NOT NULL
       AND audit_expires_at <= UTC_TIMESTAMP()
       AND audit_expiry_warned_at IS NULL`
  );

  if (warnings.length === 0) return { warned: 0 };

  let sent = 0;
  for (const t of warnings) {
    try {
      console.log(`[AuditExpiry] Warning send: tenant id=${t.id} name="${t.display_name}"`);
      const { subject, text, html } = buildWarningEmail(t);
      const ok = await sendMail({ subject, text, html });

      // Set warned_at regardless of email success — we don't want to spam the
      // operator with retries every day if SMTP is broken; that's a separate
      // ops problem visible in the logs. The audit log captures the attempt.
      await db.execute(
        `UPDATE tenants SET audit_expiry_warned_at = UTC_TIMESTAMP() WHERE id = ?`,
        [t.id]
      );
      tenantMode.invalidateCache(t.id);
      if (ok) sent++;
    } catch (e) {
      console.error(`[AuditExpiry] Warning failed for tenant ${t.id}:`, e.message);
    }
  }
  return { warned: warnings.length, sent };
}

// ─── Pass 2: Hard delete ────────────────────────────────────────────────────

async function processDeletions() {
  const due = await db.queryRows(
    `SELECT id, tenant_id, display_name, audit_expires_at
     FROM tenants
     WHERE mode = 'audit_only'
       AND audit_expires_at IS NOT NULL
       AND DATE_ADD(audit_expires_at, INTERVAL ? DAY) <= UTC_TIMESTAMP()`,
    [GRACE_DAYS]
  );

  if (due.length === 0) return { deleted: 0 };

  let succeeded = 0;
  for (const t of due) {
    try {
      console.log(`[AuditExpiry] Hard delete: tenant id=${t.id} name="${t.display_name}"`);
      const result = await cascadeDelete.cascadeDeleteTenant(t.id, {
        reason: 'audit_expired',
      });

      // Send the post-deletion email AFTER the cascade so the row counts
      // reflect what actually happened. Send even if the cascade reported
      // partial errors — the operator needs to know.
      const { subject, text, html } = buildDeletedEmail(t, result);
      await sendMail({ subject, text, html });

      console.log(`[AuditExpiry] Deleted tenant id=${t.id}: ${result.totalRowsDeleted} rows across ${result.perTable.length} tables (${result.errors.length} errors)`);
      succeeded++;
    } catch (e) {
      console.error(`[AuditExpiry] Hard delete failed for tenant ${t.id}:`, e.message);
    }
  }
  return { deleted: due.length, succeeded };
}

// ─── Run-once + scheduler ───────────────────────────────────────────────────

async function runOnce() {
  const t0 = Date.now();
  console.log('[AuditExpiry] Cycle start');
  workerHeartbeat.stampStart('audit_expiry');
  let warning = { warned: 0, sent: 0 };
  let deletion = { deleted: 0, succeeded: 0 };
  try { warning  = await processWarnings();  } catch (e) { console.error('[AuditExpiry] Warning pass error:', e.message); }
  try { deletion = await processDeletions(); } catch (e) { console.error('[AuditExpiry] Deletion pass error:', e.message); }
  console.log(`[AuditExpiry] Cycle end (+${Date.now() - t0}ms) — warned=${warning.warned} (sent=${warning.sent}), deleted=${deletion.deleted} (ok=${deletion.succeeded})`);
  workerHeartbeat.stampSuccess('audit_expiry', Date.now() - t0);
  return { warning, deletion };
}

// Daily at 09:00 server time. Early enough that the operator sees notifications
// when they start their day, late enough to have collected overnight activity.
function start() {
  if (cronJob) return;
  cronJob = cron.schedule('0 9 * * *', () => {
    runOnce().catch(err => console.error('[AuditExpiry] Unhandled cycle error:', err.message));
  });
  console.log('[AuditExpiry] Scheduler started — daily at 09:00');
}

function stop() {
  if (cronJob) { cronJob.stop(); cronJob = null; }
  console.log('[AuditExpiry] Scheduler stopped');
}

module.exports = { start, stop, runOnce, processWarnings, processDeletions };
