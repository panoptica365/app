/**
 * Panoptica365 — Configuration Bundles API (Phase 2: definition only)
 *
 * Tenant Groups & Configuration Bundles build instructions 2026-07-01, §2.
 * A bundle is a named collection of CA templates + Intune templates with
 * per-item options:
 *   - CA item:     ca_state ENUM('report_only','enabled') DEFAULT 'report_only'
 *                  (written into the policy JSON `state` at deploy — Phase 3),
 *                  optional alert_routing override (NULL = inherit template).
 *   - Intune item: assignment_target ENUM('none','all_users','all_devices'),
 *                  optional alert_routing override (NULL = inherit template).
 *
 * NOTHING DEPLOYS from this module — it is pure authoring. The deploy engine
 * arrives in Phase 3 behind its own preflight gate.
 *
 * RBAC: reads for all authenticated roles; mutations operator (member) +
 * admin. Every mutation audited to msp_audit_events with a templateKey.
 */

'use strict';

const express = require('express');
const auth = require('../auth');
const db = require('../db/database');
const mspAudit = require('../msp-audit');

const router = express.Router();
router.use(auth.requireAuth);

// ─────────────────────────────────────────────────────────────────────────
// Schema (eager, idempotent — same pattern as api-ca.js / api-org.js)
// ─────────────────────────────────────────────────────────────────────────

async function ensureBundleSchema() {
  // Cross-module ordering: the item tables below FK ca_templates /
  // intune_templates, which are created by the CA/Intune routers' own boot
  // migrations on parallel pool connections. Await their schemaReady first
  // so a truly fresh install can't race errno 1824 ("Failed to open the
  // referenced table") and latch a permanent 503 until the next restart.
  // allSettled: if one of them failed, our FK CREATE below fails loud on
  // its own and the 503 gate reports it.
  await Promise.allSettled([
    require('./api-ca').schemaReady,
    require('./api-intune').schemaReady,
  ]);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS config_bundles (
      id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      name        VARCHAR(150) NOT NULL,
      description TEXT NULL,
      created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_config_bundle_name (name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS config_bundle_ca_items (
      bundle_id      INT UNSIGNED NOT NULL,
      ca_template_id INT UNSIGNED NOT NULL,
      ca_state       ENUM('report_only','enabled') NOT NULL DEFAULT 'report_only',
      alert_routing  ENUM('support','personal','both','none') NULL,
      PRIMARY KEY (bundle_id, ca_template_id),
      FOREIGN KEY (bundle_id)      REFERENCES config_bundles(id) ON DELETE CASCADE,
      FOREIGN KEY (ca_template_id) REFERENCES ca_templates(id)   ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS config_bundle_intune_items (
      bundle_id          INT UNSIGNED NOT NULL,
      intune_template_id INT UNSIGNED NOT NULL,
      assignment_target  ENUM('none','all_users','all_devices') NOT NULL DEFAULT 'none',
      alert_routing      ENUM('support','personal','both','none') NULL,
      PRIMARY KEY (bundle_id, intune_template_id),
      FOREIGN KEY (bundle_id)          REFERENCES config_bundles(id)   ON DELETE CASCADE,
      FOREIGN KEY (intune_template_id) REFERENCES intune_templates(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

// Never-rejecting boot attempt + captured error (a rejected module-level
// promise with no awaiter would trip unhandledRejection at boot). The DDL
// is idempotent, so a FAILED attempt is re-run on the next use instead of
// latching a bad boot until restart — a boot-order race on a fresh 0.3.0
// install did exactly that (errno 1824) at a customer on 2026-07-02.
let schemaError = null;
let schemaAttempt = runSchemaMigration();

function runSchemaMigration() {
  return ensureBundleSchema()
    .then(() => {
      schemaError = null;
      console.log('[Bundles] Schema ready (config bundles + item tables)');
    })
    .catch(err => {
      schemaError = err;
      console.error('[Bundles] Schema migration failed (will retry on next use):', err.message);
    });
}

/** Await the migration; retries a failed attempt once per call; throws if still failing. */
async function whenReady() {
  await schemaAttempt;
  if (!schemaError) return;
  schemaAttempt = runSchemaMigration();
  await schemaAttempt;
  if (schemaError) throw new Error(`Bundles schema migration failed: ${schemaError.message}`);
}

// Exported for cross-module boot ordering (bundle-deploy-jobs FKs these
// tables). `schemaReady` mirrors the api-ca/api-intune contract and always
// points at the CURRENT attempt; `whenReady` is the retrying form.
Object.defineProperty(router, 'schemaReady', { get: () => schemaAttempt });
router.whenReady = whenReady;

router.use(async (req, res, next) => {
  try {
    await whenReady();
    next();
  } catch (err) {
    res.status(503).json({ error: 'Bundles module not ready — schema migration failed.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

const CA_STATES = ['report_only', 'enabled'];
const ASSIGNMENT_TARGETS = ['none', 'all_users', 'all_devices'];
const ALERT_ROUTINGS = ['support', 'personal', 'both', 'none'];

function cleanName(raw, maxLen) {
  if (typeof raw !== 'string') return null;
  const name = raw.trim().replace(/\s+/g, ' ');
  if (!name || name.length > maxLen) return null;
  return name;
}

function toId(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function isDupErr(err) {
  return err && (err.code === 'ER_DUP_ENTRY' || /Duplicate entry/i.test(err.message || ''));
}

/** alert_routing: undefined = not provided; null/'' = inherit (NULL); else ENUM. */
function parseRouting(v) {
  if (v === undefined) return { provided: false };
  if (v === null || v === '') return { provided: true, value: null };
  if (ALERT_ROUTINGS.includes(v)) return { provided: true, value: v };
  return { error: true };
}

function audit(req, action, templateParams, extra = {}) {
  mspAudit.logMspAudit({
    category: mspAudit.CATEGORY.TENANT_CONFIG,
    action,
    description: extra.description || action,
    templateKey: action,
    templateParams,
    targetType: 'setting',
    targetId: extra.targetId != null ? String(extra.targetId) : null,
    targetName: extra.targetName || null,
    metadata: extra.metadata || null,
    req,
  }).catch(() => {});
}

async function getBundle(id) {
  return db.queryOne('SELECT id, name, description, created_at, updated_at FROM config_bundles WHERE id = ?', [id]);
}

// ─────────────────────────────────────────────────────────────────────────
// Bundles CRUD
// ─────────────────────────────────────────────────────────────────────────

// List bundles with item counts (right-pane list).
router.get('/', async (req, res) => {
  try {
    const rows = await db.queryRows(
      `SELECT b.id, b.name, b.description, b.created_at, b.updated_at,
              (SELECT COUNT(*) FROM config_bundle_ca_items c     WHERE c.bundle_id = b.id) AS ca_count,
              (SELECT COUNT(*) FROM config_bundle_intune_items i WHERE i.bundle_id = b.id) AS intune_count
         FROM config_bundles b
        ORDER BY b.name`
    );
    res.json(rows);
  } catch (err) {
    console.error('[Bundles] List failed:', err.message);
    res.status(500).json({ error: 'Failed to load bundles' });
  }
});

// Bundle detail — items joined with template metadata for the editor.
router.get('/:id', async (req, res) => {
  try {
    const id = toId(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid_id' });
    const bundle = await getBundle(id);
    if (!bundle) return res.status(404).json({ error: 'not_found' });

    const caItems = await db.queryRows(
      `SELECT ci.ca_template_id, ci.ca_state, ci.alert_routing,
              t.name AS template_name, t.description AS template_description,
              t.grant_controls, t.target_users, t.target_apps
         FROM config_bundle_ca_items ci
         JOIN ca_templates t ON t.id = ci.ca_template_id
        WHERE ci.bundle_id = ?
        ORDER BY t.name`,
      [id]
    );
    const intuneItems = await db.queryRows(
      `SELECT ii.intune_template_id, ii.assignment_target, ii.alert_routing,
              t.name AS template_name, t.description AS template_description,
              t.category, t.platform, t.policy_type
         FROM config_bundle_intune_items ii
         JOIN intune_templates t ON t.id = ii.intune_template_id
        WHERE ii.bundle_id = ?
        ORDER BY t.name`,
      [id]
    );
    res.json({ ...bundle, ca_items: caItems, intune_items: intuneItems });
  } catch (err) {
    console.error('[Bundles] Get failed:', err.message);
    res.status(500).json({ error: 'Failed to load bundle' });
  }
});

// Create bundle
router.post('/', auth.requireMemberOrAdmin, async (req, res) => {
  try {
    const name = cleanName(req.body?.name, 150);
    if (!name) return res.status(400).json({ error: 'invalid_name' });
    let description = null;
    if (req.body?.description != null) {
      if (typeof req.body.description !== 'string' || req.body.description.length > 2000) {
        return res.status(400).json({ error: 'invalid_description' });
      }
      description = req.body.description.trim() || null;
    }
    let id;
    try {
      id = await db.insert('INSERT INTO config_bundles (name, description) VALUES (?, ?)', [name, description]);
    } catch (err) {
      if (isDupErr(err)) return res.status(409).json({ error: 'duplicate_name', name });
      throw err;
    }
    audit(req, 'org.bundle.create', { name }, {
      description: `Created configuration bundle "${name}"`,
      targetId: id, targetName: name,
    });
    res.status(201).json({ id, name, description });
  } catch (err) {
    console.error('[Bundles] Create failed:', err.message);
    res.status(500).json({ error: 'Failed to create bundle' });
  }
});

// Rename / re-describe bundle
router.patch('/:id', auth.requireMemberOrAdmin, async (req, res) => {
  try {
    const id = toId(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid_id' });
    const prior = await getBundle(id);
    if (!prior) return res.status(404).json({ error: 'not_found' });

    const b = req.body || {};
    let name = prior.name;
    if (b.name !== undefined) {
      name = cleanName(b.name, 150);
      if (!name) return res.status(400).json({ error: 'invalid_name' });
    }
    let description = prior.description;
    if (b.description !== undefined) {
      if (b.description === null || b.description === '') description = null;
      else if (typeof b.description !== 'string' || b.description.length > 2000) {
        return res.status(400).json({ error: 'invalid_description' });
      } else description = b.description.trim() || null;
    }

    // No-op guard: nothing changed → succeed without writing or auditing.
    if (name === prior.name && description === prior.description) {
      return res.json({ id, name, description });
    }

    try {
      await db.execute('UPDATE config_bundles SET name = ?, description = ? WHERE id = ?', [name, description, id]);
    } catch (err) {
      if (isDupErr(err)) return res.status(409).json({ error: 'duplicate_name', name });
      throw err;
    }
    audit(req, 'org.bundle.update', { name }, {
      description: `Updated configuration bundle "${name}"`,
      targetId: id, targetName: name,
    });
    res.json({ id, name, description });
  } catch (err) {
    console.error('[Bundles] Update failed:', err.message);
    res.status(500).json({ error: 'Failed to update bundle' });
  }
});

// Delete bundle (items cascade; templates are never touched)
router.delete('/:id', auth.requireMemberOrAdmin, async (req, res) => {
  try {
    const id = toId(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid_id' });
    const row = await getBundle(id);
    if (!row) return res.status(404).json({ error: 'not_found' });

    // A bundle referenced by an ACTIVE deployment job must not be deleted —
    // the job ledger cascades with the bundle, which would erase the record
    // of writes still in flight. (Table may not exist if the deploy module's
    // migration failed; treat that as "no active jobs" — deploys are gated.)
    try {
      const active = await db.queryOne(
        `SELECT COUNT(*) AS n FROM bundle_deployments
          WHERE bundle_id = ? AND status IN ('preflight','armed','running')`,
        [id]
      );
      if (active && Number(active.n) > 0) {
        return res.status(409).json({ error: 'deploy_in_progress' });
      }
    } catch (_) { /* bundle_deployments absent — nothing can be in flight */ }

    const affected = await db.execute('DELETE FROM config_bundles WHERE id = ?', [id]);
    if (affected === 0) return res.status(404).json({ error: 'not_found' });
    audit(req, 'org.bundle.delete', { name: row.name }, {
      description: `Deleted configuration bundle "${row.name}" (bundle only — templates untouched)`,
      targetId: id, targetName: row.name,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('[Bundles] Delete failed:', err.message);
    res.status(500).json({ error: 'Failed to delete bundle' });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Item routes — one config block per item kind, same handler shape.
// ─────────────────────────────────────────────────────────────────────────

const ITEM_KINDS = {
  'ca-items': {
    table: 'config_bundle_ca_items',
    idCol: 'ca_template_id',
    templateTable: 'ca_templates',
    noun: 'ca_item',
    // Per-kind extra field: ca_state (optional on add — column default report_only)
    parseExtras(body, { forUpdate }) {
      const out = {};
      if (body.ca_state !== undefined) {
        if (!CA_STATES.includes(body.ca_state)) return { error: 'invalid_ca_state' };
        out.ca_state = body.ca_state;
      } else if (!forUpdate) {
        out.ca_state = 'report_only'; // spec default — the safe choice is the lazy choice
      }
      return { fields: out };
    },
  },
  'intune-items': {
    table: 'config_bundle_intune_items',
    idCol: 'intune_template_id',
    templateTable: 'intune_templates',
    noun: 'intune_item',
    // assignment_target: REQUIRED on add (the UI selector has no default —
    // form convention); the column's DEFAULT 'none' is defensive only.
    parseExtras(body, { forUpdate }) {
      const out = {};
      if (body.assignment_target !== undefined) {
        if (!ASSIGNMENT_TARGETS.includes(body.assignment_target)) return { error: 'invalid_assignment_target' };
        out.assignment_target = body.assignment_target;
      } else if (!forUpdate) {
        return { error: 'assignment_target_required' };
      }
      return { fields: out };
    },
  },
};

for (const [slug, cfg] of Object.entries(ITEM_KINDS)) {
  // Add item to bundle
  router.post(`/:id/${slug}`, auth.requireMemberOrAdmin, async (req, res) => {
    try {
      const bundleId = toId(req.params.id);
      const templateId = toId(req.body?.template_id);
      if (!bundleId) return res.status(400).json({ error: 'invalid_id' });
      if (!templateId) return res.status(400).json({ error: 'invalid_template_id' });

      const bundle = await getBundle(bundleId);
      if (!bundle) return res.status(404).json({ error: 'not_found' });
      const template = await db.queryOne(`SELECT id, name FROM ${cfg.templateTable} WHERE id = ?`, [templateId]);
      if (!template) return res.status(400).json({ error: 'unknown_template' });

      const extras = cfg.parseExtras(req.body || {}, { forUpdate: false });
      if (extras.error) return res.status(400).json({ error: extras.error });
      const routing = parseRouting(req.body?.alert_routing);
      if (routing.error) return res.status(400).json({ error: 'invalid_alert_routing' });

      const cols = ['bundle_id', cfg.idCol, ...Object.keys(extras.fields)];
      const vals = [bundleId, templateId, ...Object.values(extras.fields)];
      if (routing.provided) { cols.push('alert_routing'); vals.push(routing.value); }

      try {
        await db.execute(
          `INSERT INTO ${cfg.table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
          vals
        );
      } catch (err) {
        if (isDupErr(err)) return res.status(409).json({ error: 'duplicate_item' });
        throw err;
      }

      audit(req, `org.bundle.${cfg.noun}.add`, { bundle: bundle.name, template: template.name }, {
        description: `Added "${template.name}" to bundle "${bundle.name}"`,
        targetId: bundleId, targetName: bundle.name,
        metadata: { template_id: templateId, ...extras.fields, alert_routing: routing.provided ? routing.value : undefined },
      });
      res.status(201).json({ ok: true });
    } catch (err) {
      console.error(`[Bundles] Add ${slug} failed:`, err.message);
      res.status(500).json({ error: 'Failed to add item to bundle' });
    }
  });

  // Update per-item options
  router.patch(`/:id/${slug}/:templateId`, auth.requireMemberOrAdmin, async (req, res) => {
    try {
      const bundleId = toId(req.params.id);
      const templateId = toId(req.params.templateId);
      if (!bundleId || !templateId) return res.status(400).json({ error: 'invalid_id' });

      const extras = cfg.parseExtras(req.body || {}, { forUpdate: true });
      if (extras.error) return res.status(400).json({ error: extras.error });
      const routing = parseRouting(req.body?.alert_routing);
      if (routing.error) return res.status(400).json({ error: 'invalid_alert_routing' });

      const sets = Object.keys(extras.fields).map(k => `${k} = ?`);
      const vals = Object.values(extras.fields);
      if (routing.provided) { sets.push('alert_routing = ?'); vals.push(routing.value); }
      if (sets.length === 0) return res.status(400).json({ error: 'no_fields' });

      const affected = await db.execute(
        `UPDATE ${cfg.table} SET ${sets.join(', ')} WHERE bundle_id = ? AND ${cfg.idCol} = ?`,
        [...vals, bundleId, templateId]
      );
      if (affected === 0) {
        // mysql2's affectedRows counts CHANGED rows, so a no-op update (same
        // values) also returns 0 — probe existence to keep the 404 honest,
        // and skip the audit row (nothing actually changed).
        const exists = await db.queryOne(
          `SELECT 1 AS x FROM ${cfg.table} WHERE bundle_id = ? AND ${cfg.idCol} = ?`,
          [bundleId, templateId]
        );
        if (!exists) return res.status(404).json({ error: 'not_found' });
        return res.json({ ok: true, unchanged: true });
      }

      const bundle = await getBundle(bundleId);
      const template = await db.queryOne(`SELECT name FROM ${cfg.templateTable} WHERE id = ?`, [templateId]);
      audit(req, `org.bundle.${cfg.noun}.update`, {
        bundle: bundle ? bundle.name : `#${bundleId}`,
        template: template ? template.name : `#${templateId}`,
      }, {
        description: `Updated "${template ? template.name : templateId}" options in bundle "${bundle ? bundle.name : bundleId}"`,
        targetId: bundleId, targetName: bundle ? bundle.name : null,
        metadata: { template_id: templateId, ...extras.fields, alert_routing: routing.provided ? routing.value : undefined },
      });
      res.json({ ok: true });
    } catch (err) {
      console.error(`[Bundles] Update ${slug} failed:`, err.message);
      res.status(500).json({ error: 'Failed to update bundle item' });
    }
  });

  // Remove item from bundle
  router.delete(`/:id/${slug}/:templateId`, auth.requireMemberOrAdmin, async (req, res) => {
    try {
      const bundleId = toId(req.params.id);
      const templateId = toId(req.params.templateId);
      if (!bundleId || !templateId) return res.status(400).json({ error: 'invalid_id' });

      const bundle = await getBundle(bundleId);
      const template = await db.queryOne(`SELECT name FROM ${cfg.templateTable} WHERE id = ?`, [templateId]);
      const affected = await db.execute(
        `DELETE FROM ${cfg.table} WHERE bundle_id = ? AND ${cfg.idCol} = ?`,
        [bundleId, templateId]
      );
      if (affected === 0) return res.status(404).json({ error: 'not_found' });

      audit(req, `org.bundle.${cfg.noun}.remove`, {
        bundle: bundle ? bundle.name : `#${bundleId}`,
        template: template ? template.name : `#${templateId}`,
      }, {
        description: `Removed "${template ? template.name : templateId}" from bundle "${bundle ? bundle.name : bundleId}"`,
        targetId: bundleId, targetName: bundle ? bundle.name : null,
        metadata: { template_id: templateId },
      });
      res.json({ ok: true });
    } catch (err) {
      console.error(`[Bundles] Remove ${slug} failed:`, err.message);
      res.status(500).json({ error: 'Failed to remove bundle item' });
    }
  });
}

module.exports = router;
