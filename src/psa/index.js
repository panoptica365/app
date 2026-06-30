/**
 * Panoptica365 — PSA provider abstraction (Feature 8.3)
 *
 * The ONLY module the alert engine, notifier, worker, and settings routes talk
 * to for PSA work. Autotask is the only provider today; everything Autotask-
 * specific is behind autotask-client.js so ConnectWise Manage can be added
 * later without touching callers (decision 1).
 *
 * Responsibilities:
 *   - resolve the active provider + "is this alert ours to handle" gating
 *   - dedup (append to an open ticket vs create a new one) — decision 3
 *   - persist alert↔ticket link rows + error rows for the worker to retry
 *   - poll linked tickets and auto-resolve alerts on ticket close — decision 4
 *   - close / note tickets from the resolve-modal + drift paths — decisions 5,7
 *   - audit every mutation with template keys (§9)
 *   - track auth health (persistent 401 → email fallback, §7)
 *
 * House rules: toMysqlDatetime for DATETIME writes; UTC_TIMESTAMP() for "now"
 * in SQL; never PATCH a ticket description (decision 11) — only status + notes.
 */

const config = require('../../config/default');
const db = require('../db/database');
const store = require('./store');
const client = require('./autotask-client');
const mspAudit = require('../msp-audit');
const changeLog = require('../change-log');
const i18n = require('../i18n');
const { toMysqlDatetime } = require('./util');

// In-memory auth-health flag (decision §7). Reset on restart by design — the
// next poll or dispatch re-detects. Persisted "since" is informational only.
const authState = { healthy: true, failedSince: null };
// Last successful poll timestamp (for the settings health strip).
let lastPollAt = null;

// ─── Provider resolution + gating ───

function activeProvider() {
  const p = (config.psa && config.psa.provider) || '';
  return p === 'autotask' ? 'autotask' : null;
}

/** True when a provider is selected AND its credentials + zone are present. */
function isConfigured() {
  if (activeProvider() !== 'autotask') return false;
  const at = (config.psa && config.psa.autotask) || {};
  return !!(at.username && at.secret && at.integrationCode && at.zoneUrl);
}

function isAuthHealthy() { return authState.healthy; }
function getAuthState() { return { ...authState }; }
function getLastPollAt() { return lastPollAt; }

/** Autotask Companies.id mapped to this tenant, or null (email fallback). */
async function getTenantCompanyId(tenantId) {
  if (!tenantId) return null;
  try {
    const row = await db.queryOne(
      'SELECT psa_company_id FROM tenants WHERE id = ? LIMIT 1',
      [tenantId]
    );
    return row && row.psa_company_id != null ? Number(row.psa_company_id) : null;
  } catch {
    return null;
  }
}

/** A tenant is "mapped" when it has a non-NULL psa_company_id. */
async function isTenantMapped(tenant) {
  if (!tenant) return false;
  if (tenant.psa_company_id !== undefined) return tenant.psa_company_id != null;
  return (await getTenantCompanyId(tenant.id)) != null;
}

/** Resolve the Autotask companyID for an alert (msp-scope → default company). */
async function resolveCompanyId(alert, tenant) {
  if (alert.alert_scope === 'msp') {
    return config.psa.defaultCompanyId != null ? Number(config.psa.defaultCompanyId) : null;
  }
  if (tenant && tenant.psa_company_id != null) return Number(tenant.psa_company_id);
  return getTenantCompanyId(tenant && tenant.id);
}

/**
 * Should the 'support' channel for this alert go to the PSA API (vs email)?
 * Gated on: configured + auth healthy + (msp-scope with a default company OR a
 * mapped tenant). Anything false → caller uses the existing email-to-ticket path.
 */
async function shouldHandleSupport(alert, tenant) {
  if (!isConfigured() || !isAuthHealthy()) return false;
  if (alert && alert.isAutoResolved) return false; // hard invariant (decision 6)
  const companyId = await resolveCompanyId(alert, tenant);
  return companyId != null;
}

// ─── Ticket content rendering ───

function ticketLang() { return (config.psa && config.psa.ticketLanguage) || 'en'; }

function tc() { return (config.psa && config.psa.ticketConfig) || {}; }

function dashboardLink() {
  return config.baseUrl ? `${config.baseUrl}/?page=alerts` : '';
}

/** Deep link to the Autotask ticket detail page, derived from the zone host. */
function ticketWebUrl(ticketId) {
  try {
    const zone = (config.psa.autotask && config.psa.autotask.zoneUrl) || '';
    // zone is the REST host, e.g. https://webservices16.autotask.net/atservicesrest
    // The web UI lives on the matching ww16.autotask.net host. Verify the exact
    // pattern during live build; this is the documented standard shape.
    const m = zone.match(/webservices(\d+)\.autotask\.net/i);
    if (m) {
      return `https://ww${m[1]}.autotask.net/Mvc/ServiceDesk/TicketDetail.mvc?ticketId=${ticketId}`;
    }
  } catch { /* fall through */ }
  return '';
}

function severityLabel(severity, lang) {
  const key = 'alerts.' + severity;
  const v = i18n.t(key, { lang });
  return v === key ? String(severity || '').toUpperCase() : String(v).toUpperCase();
}

function categoryLabel(category, lang) {
  const key = 'alerts.category.' + category;
  const v = i18n.t(key, { lang });
  return v === key ? category : v;
}

/** Localized headline (no //NAME// tag — that's an email-parser artifact). */
function buildTitle(alert) {
  const lang = ticketLang();
  const notifier = require('../notifier');
  const msg = notifier.renderAlertMessageForLocale(alert, lang) || alert.message || '';
  const title = `[${severityLabel(alert.severity, lang)}] ${msg}`;
  return title.slice(0, 255);
}

/** Plain-text ticket body (Autotask description is plain text, 8000 cap). */
function buildDescription(alert, tenant) {
  const lang = ticketLang();
  const notifier = require('../notifier');
  const msg = notifier.renderAlertMessageForLocale(alert, lang) || alert.message || '';
  const L = (k, params) => i18n.t('psa.ticket.' + k, { ...(params || {}), lang });

  const lines = [];
  lines.push(msg);
  lines.push('');
  lines.push(`${L('severity')}: ${severityLabel(alert.severity, lang)}`);
  lines.push(`${L('category')}: ${categoryLabel(alert.category, lang)}`);
  if (alert.policy_name) lines.push(`${L('policy')}: ${alert.policy_name}`);

  if (alert.alert_scope === 'msp') {
    let raw = alert.raw_data;
    if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { raw = {}; } }
    const names = (raw && (raw.affectedTenantNames || raw.affected_tenant_names)) || '';
    if (names) lines.push(`${L('affected_tenants')}: ${names}`);
  } else if (tenant && tenant.display_name) {
    lines.push(`${L('tenant')}: ${tenant.display_name}`);
  }

  const triggered = alert.triggered_at || alert.created_at;
  if (triggered) lines.push(`${L('triggered')}: ${toMysqlDatetime(triggered)} UTC`);

  const ai = (lang === 'fr' && alert.ai_analysis_fr)
    || (lang === 'es' && alert.ai_analysis_es)
    || alert.ai_analysis_en || alert.ai_analysis;
  if (ai) {
    lines.push('');
    lines.push(`${L('ai_analysis')}:`);
    lines.push(String(ai));
  }

  const link = dashboardLink();
  if (link) {
    lines.push('');
    lines.push(`${L('view_in_dashboard')}: ${link}`);
  }

  let body = lines.join('\n');
  if (body.length > 8000) body = body.slice(0, 7980) + '\n…(truncated)';
  return body;
}

function buildTicketPayload(alert, companyId) {
  const c = tc();
  const offsetH = Number(c.dueDateOffsetHours) || 24;
  const due = new Date(Date.now() + offsetH * 3600 * 1000).toISOString();
  const sev = alert.severity || 'info';
  const priority = (c.priorityBySeverity && c.priorityBySeverity[sev]) != null
    ? Number(c.priorityBySeverity[sev]) : undefined;
  const scopeTag = alert.alert_scope === 'msp' ? 'msp' : alert.tenant_id;

  const payload = {
    companyID: Number(companyId),
    title: buildTitle(alert),
    description: buildDescription(alert, null),
    status: Number(c.newStatusId),
    externalID: `panoptica:tenant:${scopeTag}:policy:${alert.policy_id}`.slice(0, 50),
  };
  if (priority !== undefined) payload.priority = priority;
  if (c.queueId != null) payload.queueID = Number(c.queueId);
  if (c.sourceId != null) payload.source = Number(c.sourceId);
  payload.dueDateTime = due;
  return payload;
}

// ─── Outbound: create / append (decision 3, §6) ───

/**
 * Dispatch an alert to the PSA. Dedups against an open linked ticket for the
 * same (tenant, policy): append a TicketNote if one exists, else create a new
 * ticket. Persists a link row on success, an error row on transient failure
 * (worker retries — never falls back to email mid-flight, decision §6.4).
 *
 * Returns one of: 'created' | 'appended' | 'deferred' | 'auth_failed' | 'skipped'.
 * Only 'auth_failed' should make the caller fall back to email (§7).
 */
async function dispatchAlert(alert, tenant) {
  if (!alert || !alert.id) return 'skipped';
  if (alert.isAutoResolved) return 'skipped'; // decision 6 — hard invariant
  if (!isConfigured()) return 'skipped';

  const companyId = await resolveCompanyId(alert, tenant);
  if (companyId == null) return 'skipped';

  const dedupTenantId = alert.alert_scope === 'msp' ? null : (alert.tenant_id ?? null);
  const policyId = alert.policy_id != null ? alert.policy_id : null;

  let existing = null;
  try {
    existing = await store.findOpenLinkForDedup(dedupTenantId, policyId);
  } catch (err) {
    console.warn(`[PSA] dedup lookup failed for alert ${alert.id}: ${err.message}`);
  }

  if (existing) {
    return appendToTicket(existing, alert, tenant, dedupTenantId, policyId);
  }
  return createForAlert(alert, tenant, companyId, dedupTenantId, policyId);
}

async function createForAlert(alert, tenant, companyId, dedupTenantId, policyId) {
  try {
    const payload = buildTicketPayload(alert, companyId);
    const ticketId = await client.createTicket(payload);
    if (!ticketId) throw new client.AutotaskError(0, 'createTicket returned no itemId');

    // Capture the human ticketNumber for display + deep link.
    let ticketNumber = null;
    try {
      const t = await client.getTicket(ticketId);
      ticketNumber = t && t.ticketNumber ? String(t.ticketNumber) : null;
    } catch { /* number is cosmetic — link still works without it */ }

    await store.insertLink({
      alert_id: alert.id,
      tenant_id: dedupTenantId,
      policy_id: policyId,
      ticket_id: ticketId,
      ticket_number: ticketNumber,
      link_role: 'primary',
      state: 'open',
      last_synced_at: toMysqlDatetime(new Date()),
    });
    await markEmailSent(alert.id);
    recoverAuthIfNeeded();

    await auditTicketCreated(alert, tenant, ticketId, ticketNumber);
    console.log(`[PSA] Created Autotask ticket ${ticketNumber || ticketId} for alert ${alert.id}`);
    return 'created';
  } catch (err) {
    return handleOutboundError(err, alert, dedupTenantId, policyId, 0, 'create');
  }
}

async function appendToTicket(existing, alert, tenant, dedupTenantId, policyId) {
  try {
    const c = tc();
    const lang = ticketLang();
    const title = i18n.t('psa.ticket.related_alert', { n: alert.id, lang });
    const headline = require('../notifier').renderAlertMessageForLocale(alert, lang) || alert.message || '';
    const noteTitle = `${title}: ${headline}`.slice(0, 250);
    await client.createTicketNote(existing.ticket_id, {
      title: noteTitle,
      description: buildDescription(alert, tenant),
      noteType: c.noteTypeId,
      publish: c.publishId,
    });

    await store.insertLink({
      alert_id: alert.id,
      tenant_id: dedupTenantId,
      policy_id: policyId,
      ticket_id: existing.ticket_id,
      ticket_number: existing.ticket_number,
      link_role: 'appended',
      state: 'open',
      last_synced_at: toMysqlDatetime(new Date()),
    });
    await markEmailSent(alert.id);
    recoverAuthIfNeeded();

    await auditNoteAppended(alert, tenant, existing.ticket_id, existing.ticket_number);
    console.log(`[PSA] Appended alert ${alert.id} to ticket ${existing.ticket_number || existing.ticket_id}`);
    return 'appended';
  } catch (err) {
    return handleOutboundError(err, alert, dedupTenantId, policyId, existing.ticket_id, 'append');
  }
}

/**
 * Classify an outbound failure. 401 → flip auth health + return 'auth_failed'
 * (caller emails as fallback, §7). Anything else → persist an error link row
 * for the worker's retry pass and return 'deferred' (no email, decision §6.4).
 */
async function handleOutboundError(err, alert, dedupTenantId, policyId, ticketId, op) {
  const statusCode = (err && err.statusCode) || 0;
  const msg = (err && err.message) || String(err);
  console.error(`[PSA] Outbound ${op} failed for alert ${alert.id} (status ${statusCode}): ${msg}`);

  if (statusCode === 401) {
    await flipAuthUnhealthy(msg);
    return 'auth_failed';
  }

  try {
    await store.insertLink({
      alert_id: alert.id,
      tenant_id: dedupTenantId,
      policy_id: policyId,
      ticket_id: ticketId || 0,
      link_role: op === 'append' ? 'appended' : 'primary',
      state: 'error',
      pending_op: op,
      last_error: msg.slice(0, 512),
      retry_count: 0,
    });
    await auditSyncError(alert, op, msg);
  } catch (insErr) {
    console.error(`[PSA] Failed to persist error row for alert ${alert.id}: ${insErr.message}`);
  }
  return 'deferred';
}

async function markEmailSent(alertId) {
  // Mirror notifier — a dispatched ticket/note counts against the same per-policy
  // daily notification_limit (decision §6.5) and lights the "notified" indicator.
  try {
    await db.execute('UPDATE alerts SET email_sent = TRUE WHERE id = ?', [alertId]);
  } catch (err) {
    console.warn(`[PSA] Could not mark alert ${alertId} email_sent: ${err.message}`);
  }
}

// ─── Worker entry points: retry + poll ───

/** Re-attempt a single error-state link row. Returns true if it cleared. */
async function retryErroredLink(linkRow) {
  // Reconstruct the alert from its row — the original in-memory object is gone.
  const alert = await db.queryOne(
    `SELECT a.*, p.name AS policy_name, p.notification_limit
       FROM alerts a LEFT JOIN alert_policies p ON p.id = a.policy_id
      WHERE a.id = ? LIMIT 1`,
    [linkRow.alert_id]
  );
  if (!alert) {
    // Orphaned error row (alert deleted) — drop it so it stops retrying.
    await store.updateLink(linkRow.id, { state: 'closed', last_error: 'alert_missing' });
    return false;
  }
  // If the alert is no longer open, there's nothing to ticket — close the row.
  if (alert.status === 'resolved' || alert.status === 'false_positive') {
    await store.updateLink(linkRow.id, { state: 'closed', last_error: 'alert_resolved_before_retry' });
    return false;
  }

  const tenant = alert.tenant_id ? await db.queryOne(
    'SELECT id, tenant_id, display_name, psa_name, psa_company_id, language FROM tenants WHERE id = ? LIMIT 1',
    [alert.tenant_id]
  ) : null;

  const dedupTenantId = alert.alert_scope === 'msp' ? null : (alert.tenant_id ?? null);
  const policyId = alert.policy_id != null ? alert.policy_id : null;

  try {
    if (linkRow.pending_op === 'append' && linkRow.ticket_id) {
      const c = tc();
      const lang = ticketLang();
      const title = i18n.t('psa.ticket.related_alert', { n: alert.id, lang });
      const headline = require('../notifier').renderAlertMessageForLocale(alert, lang) || alert.message || '';
      await client.createTicketNote(linkRow.ticket_id, {
        title: `${title}: ${headline}`.slice(0, 250),
        description: buildDescription(alert, tenant),
        noteType: c.noteTypeId,
        publish: c.publishId,
      });
      await store.updateLink(linkRow.id, {
        state: 'open', last_error: null,
        last_synced_at: toMysqlDatetime(new Date()),
      });
    } else {
      const companyId = await resolveCompanyId(alert, tenant);
      if (companyId == null) {
        await store.updateLink(linkRow.id, { state: 'closed', last_error: 'tenant_unmapped_on_retry' });
        return false;
      }
      const payload = buildTicketPayload(alert, companyId);
      const ticketId = await client.createTicket(payload);
      let ticketNumber = null;
      try { const t = await client.getTicket(ticketId); ticketNumber = t && t.ticketNumber; } catch { /* cosmetic */ }
      await store.updateLink(linkRow.id, {
        state: 'open', last_error: null, pending_op: null,
        ticket_id: ticketId, ticket_number: ticketNumber || null,
        last_synced_at: toMysqlDatetime(new Date()),
      });
    }
    await markEmailSent(alert.id);
    recoverAuthIfNeeded();
    return true;
  } catch (err) {
    const statusCode = (err && err.statusCode) || 0;
    if (statusCode === 401) { await flipAuthUnhealthy(err.message); }
    await store.updateLink(linkRow.id, {
      retry_count: (linkRow.retry_count || 0) + 1,
      last_error: String(err.message || err).slice(0, 512),
      // Stamp the attempt time so the worker can gate the next retry by the
      // 2^retry_count-minute backoff window.
      last_synced_at: toMysqlDatetime(new Date()),
    });
    return false;
  }
}

/**
 * Poll all open linked tickets in one batched query. Any ticket whose status is
 * in completeStatusIds → close its link rows + auto-resolve its open alerts
 * (decision 4). Tickets that 404 → treat as closed (decision §7).
 */
async function pollLinkedTickets() {
  if (!isConfigured()) return { polled: 0, closed: 0 };
  const ticketIds = await store.getOpenTicketIds();
  if (ticketIds.length === 0) { lastPollAt = new Date(); return { polled: 0, closed: 0 }; }

  const completeSet = new Set((tc().completeStatusIds || []).map(Number));
  let closed = 0;
  const liveById = new Map();

  // Batch in chunks of ≤500 ids (Autotask `in` filter cap, §3.4).
  for (let i = 0; i < ticketIds.length; i += 500) {
    const chunk = ticketIds.slice(i, i + 500);
    let items = [];
    try {
      items = await client.queryTickets(chunk);
      recoverAuthIfNeeded();
    } catch (err) {
      const statusCode = (err && err.statusCode) || 0;
      if (statusCode === 401) await flipAuthUnhealthy(err.message);
      console.error(`[PSA] poll query failed: ${err.message}`);
      continue; // try the next chunk; leave these open for the next cycle
    }
    for (const it of items) liveById.set(Number(it.id), it);
  }

  for (const ticketId of ticketIds) {
    const live = liveById.get(ticketId);
    if (live === undefined) {
      // Not returned by the query → deleted/inaccessible. Don't poll forever.
      closed += await closeTicketLinks(ticketId, null, 'ticket_missing');
      continue;
    }
    if (completeSet.has(Number(live.status))) {
      closed += await closeTicketLinks(ticketId, live, null);
    }
  }

  lastPollAt = new Date();
  return { polled: ticketIds.length, closed };
}

/**
 * Mark every link row for a ticket closed and auto-resolve its open alerts.
 * Returns the number of alerts auto-resolved.
 */
async function closeTicketLinks(ticketId, liveTicket, missingReason) {
  const links = await store.getLinksForTicket(ticketId);
  const number = (links[0] && links[0].ticket_number) || (liveTicket && liveTicket.ticketNumber) || ticketId;
  const nowSql = toMysqlDatetime(new Date());
  let resolved = 0;

  for (const link of links) {
    if (link.state !== 'open') continue;
    await store.updateLink(link.id, {
      state: 'closed',
      closed_at: nowSql,
      last_synced_at: nowSql,
      last_error: missingReason || null,
    });

    // Auto-resolve the linked alert if still open (decision 4). Alerts already
    // resolved by other means get link bookkeeping only (no status change).
    const alert = await db.queryOne(
      'SELECT id, tenant_id, status, policy_id FROM alerts WHERE id = ? LIMIT 1',
      [link.alert_id]
    );
    if (!alert) continue;
    if (alert.status === 'new' || alert.status === 'investigating') {
      const lang = 'en';
      const note = i18n.t(
        missingReason ? 'psa.ticket.note.auto_resolved_missing' : 'psa.ticket.note.auto_resolved',
        { number, lang }
      );
      await db.execute(
        `UPDATE alerts
            SET status = 'resolved',
                resolution_reason = 'psa_ticket_closed',
                closed_at = UTC_TIMESTAMP(),
                notes = CONCAT(COALESCE(notes, ''), ?)
          WHERE id = ? AND status IN ('new','investigating')`,
        [`\n[${nowSql} UTC] ${note}`, alert.id]
      );
      resolved += 1;
      await auditAlertAutoResolved(alert, number, missingReason);
    }
  }
  if (resolved > 0) {
    console.log(`[PSA] Ticket ${number} closed${missingReason ? ` (${missingReason})` : ''} → auto-resolved ${resolved} alert(s)`);
  }
  return resolved;
}

// ─── Inbound from operator actions: close / note (decisions 5, 7) ───

/**
 * Close the Autotask ticket linked to an alert (resolve-modal "Yes"). Sets the
 * configured close status + writes a closing note. Returns true on success.
 */
async function closeTicketForAlert(linkRow, alert, operatorEmail, req) {
  if (!isConfigured() || !linkRow || linkRow.state !== 'open') return false;
  const c = tc();
  try {
    if (c.closeStatusId != null) {
      await client.patchTicketStatus(linkRow.ticket_id, c.closeStatusId);
    }
    const lang = ticketLang();
    const note = i18n.t('psa.ticket.note.closed_by_operator', { operator: operatorEmail || 'operator', lang });
    await client.createTicketNote(linkRow.ticket_id, {
      title: i18n.t('psa.ticket.note.closed_title', { lang }),
      description: note,
      noteType: c.noteTypeId,
      publish: c.publishId,
    });
    const nowSql = toMysqlDatetime(new Date());
    // Close ALL link rows for this ticket — the whole grouped ticket is done.
    const links = await store.getLinksForTicket(linkRow.ticket_id);
    for (const l of links) {
      if (l.state === 'open') {
        await store.updateLink(l.id, { state: 'closed', closed_at: nowSql, last_synced_at: nowSql });
      }
    }
    recoverAuthIfNeeded();
    await auditTicketClosedByOperator(alert, linkRow, operatorEmail, req);
    return true;
  } catch (err) {
    const statusCode = (err && err.statusCode) || 0;
    if (statusCode === 401) await flipAuthUnhealthy(err.message);
    console.error(`[PSA] closeTicket failed for ticket ${linkRow.ticket_id}: ${err.message}`);
    return false;
  }
}

/**
 * Append an informational note to a still-open ticket (resolve-modal "No" and
 * drift_cleared, decisions 5/7). Best-effort — never throws to the caller.
 */
async function noteTicketForAlert(linkRow, i18nKey, params) {
  if (!isConfigured() || !linkRow || linkRow.state !== 'open' || !linkRow.ticket_id) return false;
  const c = tc();
  const lang = ticketLang();
  try {
    await client.createTicketNote(linkRow.ticket_id, {
      title: i18n.t('psa.ticket.note.info_title', { lang }),
      description: i18n.t(i18nKey, { ...(params || {}), lang }),
      noteType: c.noteTypeId,
      publish: c.publishId,
    });
    await store.updateLink(linkRow.id, { last_synced_at: toMysqlDatetime(new Date()) });
    recoverAuthIfNeeded();
    return true;
  } catch (err) {
    const statusCode = (err && err.statusCode) || 0;
    if (statusCode === 401) await flipAuthUnhealthy(err.message);
    console.warn(`[PSA] noteTicket failed for ticket ${linkRow.ticket_id}: ${err.message}`);
    return false;
  }
}

/**
 * Close the linked OPEN ticket(s) for a set of just-resolved drift alerts
 * (Feature 8.3, decision-7 refinement 2026-06-06): a linked ticket exists only
 * to track its drift alert, so when the drift clears — operator Accept /
 * Remediate / Match, Apply-then-poll, or a passive portal revert — close the
 * ticket rather than orphan it. (The manual alert-resolve "leave open" choice
 * is a separate path and is unaffected.) Acts once per distinct ticket.
 * Best-effort; never throws to the caller. Returns the number of tickets closed.
 */
async function closeTicketsForResolvedAlerts(alertIds, opts = {}) {
  if (!isConfigured()) return 0;
  let map;
  try { map = await store.getOpenLinksForAlertIds(alertIds); }
  catch (err) { console.warn(`[PSA] resolved-alert link lookup failed: ${err.message}`); return 0; }
  if (map.size === 0) return 0;

  const c = tc();
  const lang = ticketLang();
  const operator = opts.operatorEmail || null;
  const nowSql = toMysqlDatetime(new Date());
  const done = new Set();
  let closed = 0;

  for (const [alertId, link] of map) {
    if (link.state !== 'open' || done.has(link.ticket_id)) continue;
    done.add(link.ticket_id);
    try {
      if (c.closeStatusId != null) await client.patchTicketStatus(link.ticket_id, c.closeStatusId);
      await client.createTicketNote(link.ticket_id, {
        title: i18n.t('psa.ticket.note.closed_title', { lang }),
        description: i18n.t('psa.ticket.note.closed_drift_cleared', { operator: operator || '', lang }),
        noteType: c.noteTypeId,
        publish: c.publishId,
      });
      const links = await store.getLinksForTicket(link.ticket_id);
      for (const l of links) {
        if (l.state === 'open') {
          await store.updateLink(l.id, { state: 'closed', closed_at: nowSql, last_synced_at: nowSql });
        }
      }
      recoverAuthIfNeeded();
      await auditTicketClosedByOperator({ id: alertId, tenant_id: link.tenant_id }, link, operator || 'Panoptica365', null);
      closed += 1;
    } catch (err) {
      const statusCode = (err && err.statusCode) || 0;
      if (statusCode === 401) await flipAuthUnhealthy(err.message);
      console.warn(`[PSA] auto-close on drift-clear failed for ticket ${link.ticket_id}: ${err.message}`);
    }
  }
  if (closed > 0) console.log(`[PSA] Auto-closed ${closed} ticket(s) — linked drift alert(s) resolved`);
  return closed;
}

/**
 * Roll-up ticket consolidation (Feature 8.3 — 2026-06-09, supersedes the §4.1
 * "link parent only when exactly one shared ticket" rule). Autotask has no merge
 * API (merge is UI-only), so we emulate it: when the operator rolls up N alerts,
 * keep the OLDEST of the children's open tickets as the survivor (most history),
 * rename it to the roll-up title, link it to the parent roll-up alert, and close
 * every other child ticket with a note pointing at the survivor. Best-effort;
 * never throws to the caller. Returns { survivor, survivorNumber, closed } | null.
 */
async function consolidateRollupTickets(childAlertIds, opts = {}) {
  if (!isConfigured()) return null;
  const { parentAlertId, parentTenantId, title, operatorEmail } = opts;

  let map;
  try { map = await store.getOpenLinksForAlertIds(childAlertIds); }
  catch (err) { console.warn(`[PSA] roll-up link lookup failed: ${err.message}`); return null; }
  if (map.size === 0) return null;

  // One link per distinct open ticket; survivor = lowest ticket_id (oldest).
  const byTicket = new Map();
  for (const link of map.values()) {
    const tid = Number(link.ticket_id);
    if (tid > 0 && !byTicket.has(tid)) byTicket.set(tid, link);
  }
  if (byTicket.size === 0) return null;
  const ticketIds = [...byTicket.keys()].sort((a, b) => a - b);
  const survivorId = ticketIds[0];
  const survivorLink = byTicket.get(survivorId);
  const survivorNumber = survivorLink.ticket_number || ('#' + survivorId);

  const c = tc();
  const lang = ticketLang();
  const nowSql = toMysqlDatetime(new Date());

  // The children's existing OPEN links to the survivor are superseded by the
  // parent link below (the survivor now belongs to the roll-up), so close them.
  try {
    const survLinks = await store.getLinksForTicket(survivorId);
    for (const l of survLinks) {
      if (l.state === 'open') await store.updateLink(l.id, { state: 'closed', last_synced_at: nowSql });
    }
  } catch (_) { /* best-effort */ }

  // Link the parent roll-up alert to the survivor (its new owner) so the chip
  // points there and resolving the roll-up later closes it.
  try {
    await store.insertLink({
      alert_id: parentAlertId,
      tenant_id: parentTenantId == null ? null : parentTenantId,
      policy_id: null,
      ticket_id: survivorId,
      ticket_number: survivorLink.ticket_number || null,
      link_role: 'appended',
      state: 'open',
      last_synced_at: nowSql,
    });
  } catch (err) {
    console.warn(`[PSA] roll-up parent link failed for ticket ${survivorId}: ${err.message}`);
  }

  // Rename + note the survivor.
  try {
    if (title) await client.patchTicketTitle(survivorId, title);
    await client.createTicketNote(survivorId, {
      title: i18n.t('psa.ticket.note.rollup_survivor_title', { lang }),
      description: i18n.t('psa.ticket.note.rollup_survivor', { title: title || '', count: childAlertIds.length, lang }),
      noteType: c.noteTypeId,
      publish: c.publishId,
    });
    recoverAuthIfNeeded();
  } catch (err) {
    if ((err && err.statusCode) === 401) await flipAuthUnhealthy(err.message);
    console.warn(`[PSA] roll-up survivor update failed for ticket ${survivorId}: ${err.message}`);
  }

  // Close every other child ticket with a cross-reference note.
  let closed = 0;
  for (const tid of ticketIds.slice(1)) {
    try {
      if (c.closeStatusId != null) await client.patchTicketStatus(tid, c.closeStatusId);
      await client.createTicketNote(tid, {
        title: i18n.t('psa.ticket.note.rollup_absorbed_title', { lang }),
        description: i18n.t('psa.ticket.note.rollup_absorbed', { survivor: survivorNumber, lang }),
        noteType: c.noteTypeId,
        publish: c.publishId,
      });
      const links = await store.getLinksForTicket(tid);
      for (const l of links) {
        if (l.state === 'open') await store.updateLink(l.id, { state: 'closed', closed_at: nowSql, last_synced_at: nowSql });
      }
      recoverAuthIfNeeded();
      closed += 1;
    } catch (err) {
      if ((err && err.statusCode) === 401) await flipAuthUnhealthy(err.message);
      console.warn(`[PSA] roll-up absorb-close failed for ticket ${tid}: ${err.message}`);
    }
  }

  mspAudit.logMspAudit({
    category: mspAudit.CATEGORY.OTHER,
    action: 'psa.rollup_consolidated',
    description: `Roll-up #${parentAlertId}: kept Autotask ticket ${survivorNumber}, closed ${closed} absorbed ticket(s)`,
    templateKey: 'psa.rollup_consolidated',
    templateParams: { survivor: survivorNumber, closed, alertId: parentAlertId, operator: operatorEmail || '' },
    targetType: 'alert', targetId: String(parentAlertId), targetName: survivorNumber,
  }).catch(() => {});

  console.log(`[PSA] Roll-up #${parentAlertId}: survivor ticket ${survivorNumber}, closed ${closed} absorbed`);
  return { survivor: survivorId, survivorNumber, closed };
}

/**
 * Append newly-added children to an EXISTING roll-up's survivor ticket (Add to
 * Roll-up, 2026-06-29). Unlike consolidateRollupTickets — which picks a survivor
 * from the passed child ids — this resolves the survivor from the PARENT's open
 * 'appended' link (inserted at consolidation time), then closes each newly-added
 * child's open ticket with a pointer note and records the additions on the
 * survivor. NEVER opens a second survivor.
 *
 * Fallback: if the parent has no survivor link (roll-up created while PSA was
 * off, or all original children were ticketless), establish one from the new
 * children via consolidateRollupTickets. Best-effort; never throws.
 * Returns { survivor, survivorNumber, closed } | null.
 */
async function appendToRollupTicket(parentAlertId, newChildIds, opts = {}) {
  if (!isConfigured()) return null;
  const { parentTenantId, title, operatorEmail } = opts;
  const childIds = (newChildIds || []).map(Number).filter(Number.isFinite);
  if (childIds.length === 0) return null;

  // Resolve the parent's existing survivor ticket from its open link.
  let survivorId = null;
  let survivorNumber = null;
  try {
    const parentLinks = await store.getOpenLinksForAlertIds([parentAlertId]);
    const pl = parentLinks.get(Number(parentAlertId));
    if (pl && Number(pl.ticket_id) > 0) {
      survivorId = Number(pl.ticket_id);
      survivorNumber = pl.ticket_number || ('#' + survivorId);
    }
  } catch (err) {
    console.warn(`[PSA] append: parent link lookup failed for #${parentAlertId}: ${err.message}`);
  }

  // No survivor yet → establish one from the new children (creates the parent link).
  if (!survivorId) {
    return consolidateRollupTickets(childIds, { parentAlertId, parentTenantId, title, operatorEmail });
  }

  const c = tc();
  const lang = ticketLang();
  const nowSql = toMysqlDatetime(new Date());

  // Close each newly-added child's open ticket (other than the survivor) with a
  // cross-reference note, and close its open links.
  let map;
  try { map = await store.getOpenLinksForAlertIds(childIds); }
  catch (err) { console.warn(`[PSA] append: child link lookup failed: ${err.message}`); map = new Map(); }
  const byTicket = new Map();
  for (const link of map.values()) {
    const tid = Number(link.ticket_id);
    if (tid > 0 && tid !== survivorId && !byTicket.has(tid)) byTicket.set(tid, link);
  }

  let closed = 0;
  for (const tid of byTicket.keys()) {
    try {
      if (c.closeStatusId != null) await client.patchTicketStatus(tid, c.closeStatusId);
      await client.createTicketNote(tid, {
        title: i18n.t('psa.ticket.note.rollup_absorbed_title', { lang }),
        description: i18n.t('psa.ticket.note.rollup_absorbed', { survivor: survivorNumber, lang }),
        noteType: c.noteTypeId,
        publish: c.publishId,
      });
      const links = await store.getLinksForTicket(tid);
      for (const l of links) {
        if (l.state === 'open') await store.updateLink(l.id, { state: 'closed', closed_at: nowSql, last_synced_at: nowSql });
      }
      recoverAuthIfNeeded();
      closed += 1;
    } catch (err) {
      if ((err && err.statusCode) === 401) await flipAuthUnhealthy(err.message);
      console.warn(`[PSA] append: absorb-close failed for ticket ${tid}: ${err.message}`);
    }
  }

  // Record the additions on the survivor.
  try {
    await client.createTicketNote(survivorId, {
      title: i18n.t('psa.ticket.note.rollup_survivor_title', { lang }),
      description: i18n.t('psa.ticket.note.rollup_appended', { count: childIds.length, lang }),
      noteType: c.noteTypeId,
      publish: c.publishId,
    });
    recoverAuthIfNeeded();
  } catch (err) {
    if ((err && err.statusCode) === 401) await flipAuthUnhealthy(err.message);
    console.warn(`[PSA] append: survivor note failed for ticket ${survivorId}: ${err.message}`);
  }

  mspAudit.logMspAudit({
    category: mspAudit.CATEGORY.OTHER,
    action: 'psa.rollup_appended',
    description: `Roll-up #${parentAlertId}: appended ${childIds.length} alert(s) to ticket ${survivorNumber}, closed ${closed} absorbed`,
    templateKey: 'psa.rollup_appended',
    templateParams: { survivor: survivorNumber, count: childIds.length, closed, alertId: parentAlertId, operator: operatorEmail || '' },
    targetType: 'alert', targetId: String(parentAlertId), targetName: survivorNumber,
  }).catch(() => {});

  console.log(`[PSA] Roll-up #${parentAlertId}: appended ${childIds.length} to survivor ${survivorNumber}, closed ${closed} absorbed`);
  return { survivor: survivorId, survivorNumber, closed };
}

// ─── Auth health (§7) ───

async function flipAuthUnhealthy(reason) {
  if (!authState.healthy) return; // already flagged — audit once
  authState.healthy = false;
  authState.failedSince = new Date();
  console.error(`[PSA] Autotask authentication failing — falling back to email. ${reason || ''}`);
  await mspAudit.logMspAudit({
    category: mspAudit.CATEGORY.SETTINGS_CHANGE,
    action: 'psa.auth_failed',
    description: `Autotask authentication failing (${reason || 'unknown'})`,
    templateKey: 'psa.auth_failed',
    templateParams: { reason: reason || '' },
    success: false,
    targetType: 'setting',
    targetId: 'psa',
    targetName: 'PSA Integration',
  }).catch(() => {});
}

function recoverAuthIfNeeded() {
  if (authState.healthy) return;
  authState.healthy = true;
  const since = authState.failedSince;
  authState.failedSince = null;
  console.log('[PSA] Autotask authentication recovered.');
  mspAudit.logMspAudit({
    category: mspAudit.CATEGORY.SETTINGS_CHANGE,
    action: 'psa.auth_recovered',
    description: 'Autotask authentication recovered',
    templateKey: 'psa.auth_recovered',
    templateParams: { since: since ? since.toISOString() : '' },
    targetType: 'setting',
    targetId: 'psa',
    targetName: 'PSA Integration',
  }).catch(() => {});
}

// ─── Audit helpers (§9) ───

async function auditTicketCreated(alert, tenant, ticketId, ticketNumber) {
  const tn = ticketNumber || String(ticketId);
  mspAudit.logMspAudit({
    category: mspAudit.CATEGORY.OTHER,
    action: 'psa.ticket_created',
    description: `Autotask ticket ${tn} created for alert #${alert.id}`,
    templateKey: 'psa.ticket_created',
    templateParams: { ticket: tn, alertId: alert.id, tenant: tenant ? tenant.display_name : 'MSP' },
    targetType: 'alert', targetId: String(alert.id), targetName: tn,
  }).catch(() => {});
  if (alert.tenant_id) {
    changeLog.logPanopticaChange({
      tenantId: alert.tenant_id,
      category: changeLog.CATEGORY.ALERT_STATUS_CHANGE,
      surfaces: [changeLog.SURFACE.OTHER],
      description: `Autotask ticket ${tn} created for alert #${alert.id}`,
      templateKey: 'psa.ticket_created',
      templateParams: { ticket: tn, alertId: alert.id },
      createdBy: 'psa-integration',
    }).catch(() => {});
  }
}

async function auditNoteAppended(alert, tenant, ticketId, ticketNumber) {
  const tn = ticketNumber || String(ticketId);
  if (alert.tenant_id) {
    changeLog.logPanopticaChange({
      tenantId: alert.tenant_id,
      category: changeLog.CATEGORY.ALERT_STATUS_CHANGE,
      surfaces: [changeLog.SURFACE.OTHER],
      description: `Alert #${alert.id} appended to Autotask ticket ${tn}`,
      templateKey: 'psa.note_appended',
      templateParams: { ticket: tn, alertId: alert.id },
      createdBy: 'psa-integration',
    }).catch(() => {});
  } else {
    mspAudit.logMspAudit({
      category: mspAudit.CATEGORY.OTHER,
      action: 'psa.note_appended',
      description: `Alert #${alert.id} appended to Autotask ticket ${tn}`,
      templateKey: 'psa.note_appended',
      templateParams: { ticket: tn, alertId: alert.id, tenant: 'MSP' },
      targetType: 'alert', targetId: String(alert.id), targetName: tn,
    }).catch(() => {});
  }
}

async function auditTicketClosedByOperator(alert, linkRow, operatorEmail, req) {
  const tn = linkRow.ticket_number || String(linkRow.ticket_id);
  mspAudit.logMspAudit({
    category: mspAudit.CATEGORY.OTHER,
    action: 'psa.ticket_closed_by_operator',
    description: `Autotask ticket ${tn} closed by operator (alert #${alert.id})`,
    templateKey: 'psa.ticket_closed_by_operator',
    templateParams: { ticket: tn, alertId: alert.id, operator: operatorEmail || '' },
    targetType: 'alert', targetId: String(alert.id), targetName: tn,
    req,
  }).catch(() => {});
}

async function auditAlertAutoResolved(alert, ticketNumber, missingReason) {
  const tn = String(ticketNumber);
  mspAudit.logMspAudit({
    category: mspAudit.CATEGORY.OTHER,
    action: 'psa.alert_autoresolved_ticket_closed',
    description: `Alert #${alert.id} auto-resolved — Autotask ticket ${tn} ${missingReason || 'closed'}`,
    templateKey: 'psa.alert_autoresolved_ticket_closed',
    templateParams: { ticket: tn, alertId: alert.id, reason: missingReason || 'closed' },
    targetType: 'alert', targetId: String(alert.id), targetName: tn,
  }).catch(() => {});
  if (alert.tenant_id) {
    changeLog.logPanopticaChange({
      tenantId: alert.tenant_id,
      category: changeLog.CATEGORY.ALERT_STATUS_CHANGE,
      surfaces: [changeLog.SURFACE.OTHER],
      description: `Alert #${alert.id} auto-resolved — Autotask ticket ${tn} closed`,
      templateKey: 'psa.alert_autoresolved_ticket_closed',
      templateParams: { ticket: tn, alertId: alert.id, reason: missingReason || 'closed' },
      createdBy: 'psa-worker',
    }).catch(() => {});
  }
}

async function auditSyncError(alert, op, message) {
  mspAudit.logMspAudit({
    category: mspAudit.CATEGORY.OTHER,
    action: 'psa.sync_error',
    description: `Autotask ${op} failed for alert #${alert.id}: ${message}`.slice(0, 480),
    templateKey: 'psa.sync_error',
    templateParams: { op, alertId: alert.id, error: String(message).slice(0, 200) },
    success: false,
    targetType: 'alert', targetId: String(alert.id),
  }).catch(() => {});
}

module.exports = {
  // gating
  activeProvider,
  isConfigured,
  isAuthHealthy,
  getAuthState,
  getLastPollAt,
  isTenantMapped,
  getTenantCompanyId,
  resolveCompanyId,
  shouldHandleSupport,
  // outbound
  dispatchAlert,
  // operator-driven
  closeTicketForAlert,
  noteTicketForAlert,
  closeTicketsForResolvedAlerts,
  consolidateRollupTickets,
  appendToRollupTicket,
  // worker
  retryErroredLink,
  pollLinkedTickets,
  // settings-UI passthroughs (thin wrappers over the client)
  client,
  store,
  ticketWebUrl,
};
