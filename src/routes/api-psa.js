/**
 * Panoptica365 — PSA Integration API routes (Feature 8.3)
 *
 * Admin-only (A3). Backs the Settings → PSA Integration card: provider + creds,
 * test connection, live picklists, company search, tenant→company mapping, and
 * the health strip. All Autotask calls go through the provider/client; this file
 * is request/response shaping + .env persistence + audit only.
 *
 * .env writes mirror api-settings.js's parseEnvFile/updateEnvVars (the same
 * local-copy convention api-setup.js uses) so config.psa.* live-reloads without
 * a restart.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const auth = require('../auth');
const config = require('../../config/default');
const mspAudit = require('../msp-audit');
const db = require('../db/database');
const psa = require('../psa');

const router = express.Router();
router.use(auth.requireAuth);
router.use(auth.requireAdmin); // entire PSA settings surface is admin-only (A3)

const ENV_PATH = path.join(__dirname, '..', '..', '.env');

// ─── .env helpers (parseEnvFile / updateEnvVars pattern) ───
function parseEnvFile() {
  let content = '';
  try { content = fs.readFileSync(ENV_PATH, 'utf-8'); } catch { content = ''; }
  const lines = content.split('\n');
  const vars = new Map();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) vars.set(m[1], { lineIdx: i, value: m[2] });
  }
  return { lines, vars };
}
function updateEnvVars(updates) {
  const { escapeEnvValue } = require('../lib/env-file');
  const { lines, vars } = parseEnvFile();
  for (const [key, value] of Object.entries(updates)) {
    const safeVal = String(value);
    // Quote-escape the FILE line (so '#'/spaces/special chars in a secret or in
    // the AUTOTASK_TICKET_CONFIG JSON survive dotenv re-parse on restart); keep
    // the RAW value in process.env for immediate in-memory use.
    const fileVal = escapeEnvValue(value);
    if (vars.has(key)) lines[vars.get(key).lineIdx] = `${key}=${fileVal}`;
    else lines.push(`${key}=${fileVal}`);
    process.env[key] = safeVal;
  }
  fs.writeFileSync(ENV_PATH, lines.join('\n'), 'utf-8');
}

/** Re-derive config.psa.* from process.env (mirrors api-settings.reloadPsaConfig). */
function reloadPsaConfig() {
  config.psa = config.psa || {};
  config.psa.provider = (process.env.PSA_PROVIDER || '').toLowerCase();
  config.psa.pollIntervalMin = parseInt(process.env.PSA_POLL_INTERVAL_MIN, 10) || 10;
  config.psa.ticketLanguage = (process.env.PSA_TICKET_LANGUAGE || 'en').toLowerCase();
  config.psa.defaultCompanyId = process.env.PSA_DEFAULT_COMPANY_ID
    ? Number(process.env.PSA_DEFAULT_COMPANY_ID) : null;
  config.psa.autotask = {
    username:        process.env.AUTOTASK_USERNAME || '',
    secret:          process.env.AUTOTASK_SECRET || '',
    integrationCode: process.env.AUTOTASK_INTEGRATION_CODE || '',
    zoneUrl:         process.env.AUTOTASK_ZONE_URL || '',
  };
  try { config.psa.ticketConfig = JSON.parse(process.env.AUTOTASK_TICKET_CONFIG || '{}'); }
  catch { config.psa.ticketConfig = {}; }
}

// ─── Config read/write ───

router.get('/config', (req, res) => {
  const at = (config.psa && config.psa.autotask) || {};
  res.json({
    provider: (config.psa && config.psa.provider) || '',
    username: at.username || '',
    integration_code: at.integrationCode || '',
    secret_set: !!at.secret,
    zone_url: at.zoneUrl || '',
    default_company_id: config.psa.defaultCompanyId,
    ticket_language: config.psa.ticketLanguage || 'en',
    poll_interval_min: config.psa.pollIntervalMin || 10,
    ticket_config: config.psa.ticketConfig || {},
    // The email-to-ticket fallback needs PSA_EMAIL set while any tenant is
    // unmapped or auth is unhealthy. Surface its presence so the UI can warn.
    psa_email_set: !!(config.notification && config.notification.psaEmail),
  });
});

router.put('/config', (req, res) => {
  try {
    const b = req.body || {};
    const updates = {};
    const changed = [];

    if (b.provider !== undefined) {
      const prov = String(b.provider || '').toLowerCase() === 'autotask' ? 'autotask' : '';
      updates.PSA_PROVIDER = prov; changed.push('provider');
    }
    if (b.username !== undefined) { updates.AUTOTASK_USERNAME = String(b.username).trim(); changed.push('username'); }
    if (b.integration_code !== undefined) { updates.AUTOTASK_INTEGRATION_CODE = String(b.integration_code).trim(); changed.push('integration_code'); }
    // Secret only written when a non-empty value is supplied (write-only field).
    if (b.secret !== undefined && b.secret !== '') { updates.AUTOTASK_SECRET = String(b.secret); changed.push('secret'); }
    if (b.default_company_id !== undefined) {
      updates.PSA_DEFAULT_COMPANY_ID = b.default_company_id == null || b.default_company_id === ''
        ? '' : String(parseInt(b.default_company_id, 10) || '');
      changed.push('default_company');
    }
    if (b.ticket_language !== undefined) {
      const lang = ['en', 'fr', 'es'].includes(b.ticket_language) ? b.ticket_language : 'en';
      updates.PSA_TICKET_LANGUAGE = lang; changed.push('ticket_language');
    }
    if (b.poll_interval_min !== undefined) {
      updates.PSA_POLL_INTERVAL_MIN = String(Math.max(1, parseInt(b.poll_interval_min, 10) || 10));
      changed.push('poll_interval');
    }
    if (b.ticket_config !== undefined && b.ticket_config && typeof b.ticket_config === 'object') {
      // Guard: a status Panoptica sets on close MUST register as "closed" to the
      // poller, or the close flow self-deadlocks. Enforce closeStatusId ∈
      // completeStatusIds before persisting.
      const cfg = b.ticket_config;
      if (cfg.closeStatusId != null && Array.isArray(cfg.completeStatusIds)
          && !cfg.completeStatusIds.map(Number).includes(Number(cfg.closeStatusId))) {
        return res.status(400).json({ error: 'close_status_not_in_complete', message: 'The close status must be one of the statuses treated as closed.' });
      }
      updates.AUTOTASK_TICKET_CONFIG = JSON.stringify(cfg);
      changed.push('ticket_config');
    }

    if (Object.keys(updates).length === 0) return res.json({ success: true, no_changes: true });

    updateEnvVars(updates);
    reloadPsaConfig();

    mspAudit.logMspAudit({
      category: mspAudit.CATEGORY.SETTINGS_CHANGE,
      action: 'psa.config.update',
      description: `PSA integration settings changed (${changed.join(', ')})`,
      templateKey: 'settings.psa.update',
      templateParams: { fields: changed.join(', ') },
      targetType: 'setting', targetId: 'psa', targetName: 'PSA Integration',
      metadata: { fields_changed: changed, secret_rotated: changed.includes('secret') },
      req,
    }).catch(() => {});

    res.json({ success: true });
  } catch (err) {
    console.error('[API/PSA] config save failed:', err.message);
    res.status(500).json({ error: 'save_failed', message: err.message });
  }
});

// ─── Test connection ───
// Validates operator-typed credentials (falling back to saved ones) via zone
// discovery + an authenticated probe. On success persists AUTOTASK_ZONE_URL.
router.post('/test', async (req, res) => {
  try {
    const b = req.body || {};
    const at = (config.psa && config.psa.autotask) || {};
    const ctx = {
      username: (b.username && b.username.trim()) || at.username,
      // Use typed secret if present, else the saved one (write-only field).
      secret: (b.secret && b.secret !== '') ? b.secret : at.secret,
      integrationCode: (b.integration_code && b.integration_code.trim()) || at.integrationCode,
      zoneUrl: at.zoneUrl, // discovery overrides this anyway
    };
    if (!ctx.username || !ctx.secret || !ctx.integrationCode) {
      return res.status(400).json({ ok: false, error: 'missing_credentials' });
    }
    const result = await psa.client.testConnection(ctx);
    if (result.zoneUrl && result.zoneUrl !== at.zoneUrl) {
      updateEnvVars({ AUTOTASK_ZONE_URL: result.zoneUrl });
      reloadPsaConfig();
    }
    res.json({ ok: true, zone_url: result.zoneUrl });
  } catch (err) {
    const statusCode = (err && err.statusCode) || 0;
    res.json({ ok: false, error: err.message, status: statusCode });
  }
});

// ─── Live picklists (status/priority/queue/source + noteType/publish) ───
router.get('/picklists', async (req, res) => {
  try {
    const [ticketFields, noteFields] = await Promise.all([
      psa.client.getTicketFieldInfo(),
      psa.client.getTicketNoteFieldInfo(),
    ]);
    const pick = (fields, name) => {
      const f = (fields || []).find(x => String(x.name).toLowerCase() === name.toLowerCase());
      if (!f || !Array.isArray(f.picklistValues)) return [];
      return f.picklistValues
        .filter(v => v.isActive !== false)
        .map(v => ({ value: Number(v.value), label: v.label, isDefault: !!v.isDefaultValue }));
    };
    res.json({
      status:   pick(ticketFields, 'status'),
      priority: pick(ticketFields, 'priority'),
      queue:    pick(ticketFields, 'queueID'),
      source:   pick(ticketFields, 'source'),
      noteType: pick(noteFields, 'noteType'),
      publish:  pick(noteFields, 'publish'),
    });
  } catch (err) {
    console.error('[API/PSA] picklists failed:', err.message);
    res.status(502).json({ error: 'picklist_fetch_failed', message: err.message });
  }
});

// ─── Company search ───
router.get('/companies', async (req, res) => {
  try {
    const items = await psa.client.queryCompanies(req.query.search || '');
    res.json({
      companies: items.map(c => ({ id: Number(c.id), name: c.companyName })),
    });
  } catch (err) {
    console.error('[API/PSA] company search failed:', err.message);
    res.status(502).json({ error: 'company_fetch_failed', message: err.message });
  }
});

// ─── Tenant → company mapping ───
function norm(s) {
  return String(s || '').toLowerCase().replace(/\b(inc|ltd|llc|corp|co|sa|inc\.)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

router.get('/mapping', async (req, res) => {
  try {
    // Managed tenants only — audit-only tenants always use email tickets.
    const tenants = await db.queryRows(
      `SELECT id, display_name, psa_name, psa_company_id, mode
         FROM tenants
        WHERE mode = 'managed'
        ORDER BY display_name`
    );

    // Best-effort suggestion + name resolution from a single active-company
    // fetch (capped at 200 by the client). Larger Autotask instances degrade
    // to "search to map"; the per-row searchable picker still works.
    let companies = [];
    try { companies = await psa.client.queryCompanies(''); } catch (e) {
      console.warn(`[API/PSA] company prefetch for suggestions failed: ${e.message}`);
    }
    const byId = new Map(companies.map(c => [Number(c.id), c.companyName]));
    const byNorm = new Map();
    for (const c of companies) {
      const k = norm(c.companyName);
      if (k && !byNorm.has(k)) byNorm.set(k, { id: Number(c.id), name: c.companyName });
    }

    const rows = tenants.map(t => {
      let suggested = null;
      if (t.psa_company_id == null) {
        // (a) exact normalized match of psa_name, then (b) tenant display name.
        const cand = byNorm.get(norm(t.psa_name)) || byNorm.get(norm(t.display_name));
        if (cand) suggested = cand;
      }
      return {
        tenant_id: t.id,
        display_name: t.display_name,
        psa_name: t.psa_name || '',
        company_id: t.psa_company_id != null ? Number(t.psa_company_id) : null,
        company_name: t.psa_company_id != null ? (byId.get(Number(t.psa_company_id)) || null) : null,
        suggested_company_id: suggested ? suggested.id : null,
        suggested_company_name: suggested ? suggested.name : null,
      };
    });
    const unmapped = rows.filter(r => r.company_id == null).length;
    res.json({
      tenants: rows,
      unmapped_count: unmapped,
      company_cap_hit: companies.length >= 200,
      // The same active-company list (≤200) used for suggestions — the UI builds
      // each row's picker from it. Rows whose mapped/suggested company isn't in
      // this set still render by id (company_name resolved above when present).
      companies: companies.map(c => ({ id: Number(c.id), name: c.companyName })).sort((a, b) => a.name.localeCompare(b.name)),
    });
  } catch (err) {
    console.error('[API/PSA] mapping load failed:', err.message);
    res.status(500).json({ error: 'mapping_load_failed', message: err.message });
  }
});

router.post('/mapping', async (req, res) => {
  try {
    const mappings = Array.isArray(req.body.mappings) ? req.body.mappings : [];
    let changed = 0;
    for (const m of mappings) {
      const tenantId = parseInt(m.tenant_id, 10);
      if (!Number.isFinite(tenantId)) continue;
      const companyId = (m.company_id == null || m.company_id === '') ? null : parseInt(m.company_id, 10);

      const cur = await db.queryOne('SELECT display_name, psa_company_id FROM tenants WHERE id = ? LIMIT 1', [tenantId]);
      if (!cur) continue;
      const prior = cur.psa_company_id != null ? Number(cur.psa_company_id) : null;
      if (prior === (companyId == null ? null : companyId)) continue; // no change

      await db.execute('UPDATE tenants SET psa_company_id = ? WHERE id = ?', [companyId, tenantId]);
      changed += 1;
      mspAudit.logMspAudit({
        category: mspAudit.CATEGORY.SETTINGS_CHANGE,
        action: 'psa.tenant_mapped',
        description: companyId == null
          ? `Tenant "${cur.display_name}" unmapped from Autotask (email fallback)`
          : `Tenant "${cur.display_name}" mapped to Autotask company ${companyId}`,
        templateKey: 'psa.tenant_mapped',
        templateParams: { tenant: cur.display_name, company: companyId == null ? '—' : String(companyId) },
        targetType: 'tenant', targetId: String(tenantId), targetName: cur.display_name,
        metadata: { prior_company_id: prior, new_company_id: companyId },
        req,
      }).catch(() => {});
    }
    res.json({ success: true, changed });
  } catch (err) {
    console.error('[API/PSA] mapping save failed:', err.message);
    res.status(500).json({ error: 'mapping_save_failed', message: err.message });
  }
});

// ─── Health strip ───
router.get('/health', async (req, res) => {
  try {
    const [openTickets, errorLinks] = await Promise.all([
      psa.store.countOpenTickets().catch(() => 0),
      psa.store.countErrorLinks().catch(() => 0),
    ]);
    const authState = psa.getAuthState();
    const lastPoll = psa.getLastPollAt();
    res.json({
      configured: psa.isConfigured(),
      provider: psa.activeProvider() || '',
      auth_healthy: authState.healthy,
      auth_failed_since: authState.failedSince ? authState.failedSince.toISOString() : null,
      last_poll_at: lastPoll ? lastPoll.toISOString() : null,
      open_tickets: openTickets,
      error_links: errorLinks,
    });
  } catch (err) {
    console.error('[API/PSA] health failed:', err.message);
    res.status(500).json({ error: 'health_failed' });
  }
});

module.exports = router;
