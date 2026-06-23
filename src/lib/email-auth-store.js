/**
 * Panoptica365 — Email-auth store (Feature A6 §5)
 *
 * Persistence + pure drift logic for the Email Auth tab. Owns two tables:
 *   dns_posture        — one row per (tenant, domain): current snapshot +
 *                        deterministic score + cached AI narrative.
 *   dns_posture_drift  — drift events (the acknowledge flow + history).
 *
 * Also owns the idempotent bootstrap of the `Email Auth drift` alert policy
 * (slug `email_auth_drift`, category `config_changes`), modelled on
 * known-good-store.ensureDriftPolicy(). The slug is load-bearing: it is the
 * alert-explainer / i18n key namespace — do NOT rename without a migration.
 *
 * Conventions (house rules): eager single-flight ensureSchema; mysql2 wants raw
 * ISO strings not Date objects + DATETIME rejects the 'Z' suffix (toMysqlDatetime);
 * UTC via UTC_TIMESTAMP(); JSON columns auto-parse on read (guard with safeParse).
 * Drift compares are STRUCTURAL, never JSON.stringify (canonical-json helpers).
 */

'use strict';

const db = require('../db/database');
const { canonicalHash } = require('./canonical-json');

// slugify('Email Auth drift') === 'email_auth_drift' (the explainer/i18n namespace).
const DRIFT_POLICY_NAME = 'Email Auth drift';
const DRIFT_POLICY_DESCRIPTION =
  'A monitored domain\'s public email-authentication DNS regressed since the last snapshot — ' +
  'DMARC policy weakened, an expected DKIM selector disappeared or was revoked, SPF loosened, ' +
  'or a transport-security record was removed. Panoptica reads public DNS only; it cannot change ' +
  'the records — the operator fixes them at the registrar, or accepts the change to set a new baseline. ' +
  'Source: public DNS (MX/SPF/DKIM/DMARC + MTA-STS/TLS-RPT/DNSSEC), compared on Refresh and on the daily re-check.';

let schemaReady = false;
let schemaPromise = null;
let _driftPolicyId = null;

/** Strip ISO 'Z'/fractional + T→space for MySQL DATETIME params. */
function toMysqlDatetime(value) {
  if (value === null || value === undefined) return null;
  const iso = value instanceof Date ? value.toISOString() : String(value);
  return iso.replace('T', ' ').replace(/Z$/, '').replace(/\.\d+$/, '');
}

function safeParse(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== 'string') return value; // mysql2 already parsed the JSON column
  try { return JSON.parse(value); } catch { return fallback; }
}

// ──────────────────────────────────────────────────────────────────────
// Pure logic (no I/O — unit-testable)
// ──────────────────────────────────────────────────────────────────────

/**
 * Hash of the DETERMINISTIC findings — gates AI narrative regeneration. The
 * narrative is regenerated only when this changes, not on every daily poll
 * (cost control, §9). Hashes the operator-visible substance (status + message
 * template + params + score/grade), not volatile fields like timestamps.
 */
function computeFindingsHash(scored) {
  if (!scored) return null;
  const f = scored.findings || {};
  const stable = {};
  for (const mech of Object.keys(f).sort()) {
    const x = f[mech] || {};
    stable[mech] = { status: x.status, detail_key: x.detail_key, detail_params: x.detail_params || {}, excluded: !!x.excluded };
  }
  return canonicalHash({ overall: scored.overall_score, grade: scored.grade, non_mail: !!scored.non_mail, findings: stable });
}

const DMARC_RANK = { reject: 3, quarantine: 2, none: 1 };
const SPF_RANK = { '-all': 3, '~all': 2, '?all': 1, '+all': 0 };

function dmarcRank(dmarc) {
  if (!dmarc || !dmarc.present) return 0;
  return DMARC_RANK[(dmarc.p || '').toLowerCase()] || 0;
}
function spfRank(spf) {
  if (!spf || !spf.present || !spf.terminal) return -1;
  return SPF_RANK[spf.terminal] != null ? SPF_RANK[spf.terminal] : 1;
}
function mxKey(mx) {
  if (!mx || !mx.present) return '';
  return (mx.hosts || []).map(h => h.exchange).sort().join(',');
}

/**
 * Compare a prior snapshot against the new one and return regression drift
 * events (and positive improvements, flagged so the caller logs but never
 * alerts). Each event: { mechanism, change_type, before_value, after_value,
 * severity, positive }.
 *
 * Robustness (v0.1.23 guard): a mechanism whose CURRENT read failed
 * (read_error) is SKIPPED — never diffed as "removed". DKIM only regresses on a
 * CONFIRMED fail (dns-reader returns `indeterminate`, not `fail`, when it could
 * not confirm absence), so a transient SERVFAIL never manufactures drift.
 */
function detectRegressions(prev, next) {
  const events = [];
  if (!prev || !next) return events;
  const pr = prev.records || {}, nx = next.records || {};
  const pf = prev.findings || {}, nf = next.findings || {};

  const readErr = (rec) => !!(rec && rec.read_error);

  // DMARC policy strength
  if (!readErr(nx.dmarc)) {
    const before = dmarcRank(pr.dmarc), after = dmarcRank(nx.dmarc);
    if (after < before) {
      events.push({ mechanism: 'dmarc', change_type: after === 0 ? 'removed' : 'downgraded',
        before_value: dmarcDesc(pr.dmarc), after_value: dmarcDesc(nx.dmarc), severity: 'high', positive: false });
    } else if (after > before) {
      events.push({ mechanism: 'dmarc', change_type: 'improved', before_value: dmarcDesc(pr.dmarc), after_value: dmarcDesc(nx.dmarc), severity: 'low', positive: true });
    }
  }

  // DKIM — only a CONFIRMED pass→fail regresses (→indeterminate never does).
  if (pf.dkim && nf.dkim) {
    if (pf.dkim.status === 'pass' && nf.dkim.status === 'fail') {
      const revoked = !!(nx.dkim && nx.dkim.revoked);
      events.push({ mechanism: 'dkim', change_type: revoked ? 'revoked' : 'removed',
        before_value: 'DKIM signing valid', after_value: revoked ? 'DKIM key revoked (p= empty)' : 'expected selector not resolving',
        severity: 'high', positive: false });
    } else if (pf.dkim.status === 'fail' && nf.dkim.status === 'pass') {
      events.push({ mechanism: 'dkim', change_type: 'improved', before_value: 'DKIM failing', after_value: 'DKIM signing valid', severity: 'low', positive: true });
    }
  }

  // SPF terminal strength + lookup overflow
  if (!readErr(nx.spf)) {
    const before = spfRank(pr.spf), after = spfRank(nx.spf);
    if (nx.spf && nx.spf.terminal === '+all' && (!pr.spf || pr.spf.terminal !== '+all')) {
      events.push({ mechanism: 'spf', change_type: 'weakened', before_value: spfDesc(pr.spf), after_value: 'v=spf1 ... +all (accepts all senders)', severity: 'high', positive: false });
    } else if (before >= 0 && after < before) {
      events.push({ mechanism: 'spf', change_type: after < 0 ? 'removed' : 'weakened', before_value: spfDesc(pr.spf), after_value: spfDesc(nx.spf), severity: 'high', positive: false });
    } else if (before >= 0 && after > before) {
      events.push({ mechanism: 'spf', change_type: 'improved', before_value: spfDesc(pr.spf), after_value: spfDesc(nx.spf), severity: 'low', positive: true });
    }
    const pOver = !!(pr.spf && pr.spf.lookup_overflow), nOver = !!(nx.spf && nx.spf.lookup_overflow);
    if (nOver && !pOver) {
      events.push({ mechanism: 'spf', change_type: 'weakened', before_value: `${pr.spf ? pr.spf.lookups : '?'} SPF lookups`, after_value: `${nx.spf.lookups} SPF lookups (exceeds RFC limit of 10)`, severity: 'medium', positive: false });
    }
  }

  // MX change (provider migration — a heads-up, not a failure)
  if (!readErr(nx.mx)) {
    const before = mxKey(pr.mx), after = mxKey(nx.mx);
    if (before && after && before !== after) {
      events.push({ mechanism: 'mx', change_type: 'changed', before_value: before, after_value: after, severity: 'medium', positive: false });
    }
  }

  // Lighter transport-security records removed
  for (const mech of ['mta_sts', 'tls_rpt', 'dnssec']) {
    if (readErr(nx[mech])) continue;
    const had = mech === 'dnssec' ? (pr.dnssec && pr.dnssec.status === 'enabled') : (pr[mech] && pr[mech].present);
    const has = mech === 'dnssec' ? (nx.dnssec && nx.dnssec.status === 'enabled') : (nx[mech] && nx[mech].present);
    if (had && !has) {
      events.push({ mechanism: mech, change_type: 'removed', before_value: 'present', after_value: 'absent', severity: 'low', positive: false });
    }
  }

  return events;
}

function dmarcDesc(d) { return d && d.present ? `p=${d.p || 'none'}` : 'no DMARC record'; }
function spfDesc(s) { return s && s.present ? `v=spf1 ... ${s.terminal || '?all'}` : 'no SPF record'; }

// ──────────────────────────────────────────────────────────────────────
// Schema + policy bootstrap
// ──────────────────────────────────────────────────────────────────────

async function ensureSchema() {
  if (schemaReady) return;
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS dns_posture (
        id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
        tenant_id          INT UNSIGNED NOT NULL,
        domain             VARCHAR(255) NOT NULL,
        is_primary         BOOLEAN NOT NULL DEFAULT FALSE,
        records            JSON NOT NULL,
        findings           JSON NOT NULL,
        detected_providers JSON NULL,
        overall_score      TINYINT NOT NULL DEFAULT 0,
        grade              CHAR(1) NOT NULL DEFAULT 'F',
        non_mail           BOOLEAN NOT NULL DEFAULT FALSE,
        narrative          JSON NULL,
        narrative_hash     CHAR(64) NULL,
        first_retrieved_at DATETIME NULL,
        last_checked_at    DATETIME NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_tenant_domain (tenant_id, domain),
        KEY idx_tenant (tenant_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await db.execute(`
      CREATE TABLE IF NOT EXISTS dns_posture_drift (
        id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
        tenant_id       INT UNSIGNED NOT NULL,
        domain          VARCHAR(255) NOT NULL,
        mechanism       VARCHAR(32) NOT NULL,
        change_type     VARCHAR(32) NOT NULL,
        before_value    TEXT NULL,
        after_value     TEXT NULL,
        severity        VARCHAR(16) NOT NULL DEFAULT 'medium',
        status          VARCHAR(16) NOT NULL DEFAULT 'open',
        acknowledged_by INT UNSIGNED NULL,
        acknowledged_at DATETIME NULL,
        ack_note        VARCHAR(512) NULL,
        alert_id        INT UNSIGNED NULL,
        detected_at     DATETIME NOT NULL,
        PRIMARY KEY (id),
        KEY idx_tenant_domain (tenant_id, domain),
        KEY idx_tenant_status (tenant_id, status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await ensureDriftPolicy();
    schemaReady = true;
  })();
  try { await schemaPromise; }
  catch (err) { schemaPromise = null; throw err; }
}

async function ensureDriftPolicy() {
  const existing = await db.queryOne('SELECT id FROM alert_policies WHERE name = ? LIMIT 1', [DRIFT_POLICY_NAME]);
  if (existing) { _driftPolicyId = existing.id; return _driftPolicyId; }
  const id = await db.insert(
    `INSERT INTO alert_policies
       (name, description, category, severity, polling_tier, notification_target, detection_logic, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      DRIFT_POLICY_NAME, DRIFT_POLICY_DESCRIPTION,
      'config_changes', 'high', 'low', 'both',
      JSON.stringify({ threshold_type: 'imperative', email_auth_drift: true }),
    ]
  );
  console.log(`[EmailAuth] Created alert policy "${DRIFT_POLICY_NAME}" id=${id}`);
  _driftPolicyId = id;
  return _driftPolicyId;
}

async function getDriftPolicy() {
  await ensureSchema();
  if (!_driftPolicyId) await ensureDriftPolicy();
  return db.queryOne(
    'SELECT id, name, severity, category, notification_target, notification_limit, enabled FROM alert_policies WHERE id = ? LIMIT 1',
    [_driftPolicyId]
  );
}

// ──────────────────────────────────────────────────────────────────────
// Posture CRUD
// ──────────────────────────────────────────────────────────────────────

function hydrate(row) {
  if (!row) return null;
  row.records = safeParse(row.records, {});
  row.findings = safeParse(row.findings, {});
  row.detected_providers = safeParse(row.detected_providers, null);
  row.narrative = safeParse(row.narrative, null);
  return row;
}

/** All posture rows for a tenant (cache-first read for the tab). */
async function getPosture(tenantId) {
  await ensureSchema();
  const rows = await db.queryRows('SELECT * FROM dns_posture WHERE tenant_id = ? ORDER BY is_primary DESC, domain', [tenantId]);
  return rows.map(hydrate);
}

async function getPostureDomain(tenantId, domain) {
  await ensureSchema();
  return hydrate(await db.queryOne('SELECT * FROM dns_posture WHERE tenant_id = ? AND domain = ? LIMIT 1', [tenantId, domain]));
}

/**
 * Upsert one domain's snapshot. first_retrieved_at is set once and preserved;
 * last_checked_at always advances. Narrative is written only when provided
 * (the worker passes it only when the hash changed).
 */
async function upsertPosture(tenantId, snap) {
  await ensureSchema();
  const now = 'UTC_TIMESTAMP()';
  await db.executeWithDeadlockRetry(
    `INSERT INTO dns_posture
       (tenant_id, domain, is_primary, records, findings, detected_providers,
        overall_score, grade, non_mail, narrative, narrative_hash,
        first_retrieved_at, last_checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${now}, ${now})
     ON DUPLICATE KEY UPDATE
       is_primary         = VALUES(is_primary),
       records            = VALUES(records),
       findings           = VALUES(findings),
       detected_providers = VALUES(detected_providers),
       overall_score      = VALUES(overall_score),
       grade              = VALUES(grade),
       non_mail           = VALUES(non_mail),
       narrative          = COALESCE(VALUES(narrative), narrative),
       narrative_hash     = COALESCE(VALUES(narrative_hash), narrative_hash),
       first_retrieved_at = COALESCE(first_retrieved_at, VALUES(first_retrieved_at)),
       last_checked_at    = ${now}`,
    [
      tenantId, snap.domain, snap.is_primary ? 1 : 0,
      JSON.stringify(snap.records || {}),
      JSON.stringify(snap.findings || {}),
      snap.detected_providers ? JSON.stringify(snap.detected_providers) : null,
      clampScore(snap.overall_score), (snap.grade || 'F').slice(0, 1), snap.non_mail ? 1 : 0,
      snap.narrative ? JSON.stringify(snap.narrative) : null,
      snap.narrative_hash || null,
    ]
  );
  return getPostureDomain(tenantId, snap.domain);
}

function clampScore(n) { const v = parseInt(n, 10); return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0; }

/** Drop posture rows for domains no longer in the tenant's accepted set. */
async function pruneDomains(tenantId, keepDomains) {
  await ensureSchema();
  const rows = await db.queryRows('SELECT domain FROM dns_posture WHERE tenant_id = ?', [tenantId]);
  const keep = new Set((keepDomains || []).map(d => String(d).toLowerCase()));
  for (const r of rows) {
    if (!keep.has(String(r.domain).toLowerCase())) {
      await db.execute('DELETE FROM dns_posture WHERE tenant_id = ? AND domain = ?', [tenantId, r.domain]);
    }
  }
}

// ──────────────────────────────────────────────────────────────────────
// Drift CRUD
// ──────────────────────────────────────────────────────────────────────

async function insertDrift(tenantId, ev) {
  await ensureSchema();
  return db.insert(
    `INSERT INTO dns_posture_drift
       (tenant_id, domain, mechanism, change_type, before_value, after_value, severity, status, alert_id, detected_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, UTC_TIMESTAMP())`,
    [tenantId, ev.domain, ev.mechanism, ev.change_type,
     ev.before_value != null ? String(ev.before_value).slice(0, 4000) : null,
     ev.after_value != null ? String(ev.after_value).slice(0, 4000) : null,
     ev.severity || 'medium', ev.alert_id || null]
  );
}

async function linkAlert(driftId, alertId) {
  await ensureSchema();
  return db.execute('UPDATE dns_posture_drift SET alert_id = ? WHERE id = ?', [alertId, driftId]);
}

/** Open drift for a tenant (optionally one domain). */
async function getOpenDrift(tenantId, domain = null) {
  await ensureSchema();
  if (domain) {
    return db.queryRows("SELECT * FROM dns_posture_drift WHERE tenant_id = ? AND domain = ? AND status = 'open' ORDER BY detected_at DESC", [tenantId, domain]);
  }
  return db.queryRows("SELECT * FROM dns_posture_drift WHERE tenant_id = ? AND status = 'open' ORDER BY detected_at DESC", [tenantId]);
}

async function getDrift(driftId) {
  await ensureSchema();
  return db.queryOne('SELECT * FROM dns_posture_drift WHERE id = ? LIMIT 1', [driftId]);
}

/** Accept ("I made this change"): mark acknowledged + stamp who/when/note. */
async function acknowledgeDrift(driftId, { acknowledgedBy = null, ackNote = null } = {}) {
  await ensureSchema();
  return db.execute(
    `UPDATE dns_posture_drift
        SET status = 'acknowledged', acknowledged_by = ?, acknowledged_at = UTC_TIMESTAMP(), ack_note = ?
      WHERE id = ? AND status = 'open'`,
    [acknowledgedBy, ackNote ? String(ackNote).slice(0, 512) : null, driftId]
  );
}

module.exports = {
  // schema + policy
  ensureSchema, getDriftPolicy, ensureDriftPolicy, DRIFT_POLICY_NAME,
  // posture CRUD
  getPosture, getPostureDomain, upsertPosture, pruneDomains,
  // drift CRUD
  insertDrift, linkAlert, getOpenDrift, getDrift, acknowledgeDrift,
  // pure helpers (exported for the worker + unit tests)
  computeFindingsHash, detectRegressions, toMysqlDatetime, safeParse,
};
