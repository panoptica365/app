/**
 * Panoptica365 — Organization API (Tenant Groups + managed lookup lists)
 *
 * Phase 1 of the Tenant Groups & Configuration Bundles feature
 * (build instructions 2026-07-01, §1.3–§1.6).
 *
 *   /api/org/service-tiers, /api/org/sales-reps
 *       Managed lookup lists (Settings-tab CRUD). Soft-delete (active=0) is
 *       the graceful path; hard-delete is BLOCKED while any tenant or any
 *       dynamic-group rule still references the row (409 + blocking names).
 *
 *   /api/org/groups
 *       Tenant-group CRUD. Manual groups store members in
 *       tenant_group_members; dynamic groups store a rule over service tier
 *       and/or sales rep (exactly those two dimensions — no rules engine).
 *       Membership everywhere comes from org-store.resolveGroupMembers().
 *
 * RBAC: reads for every authenticated role (viewers use the group filter on
 * Heatmap/Trends); mutations require operator (member) or admin. Every
 * mutation is audited to msp_audit_events with a templateKey.
 */

'use strict';

const express = require('express');
const auth = require('../auth');
const db = require('../db/database');
const mspAudit = require('../msp-audit');
const orgStore = require('../lib/org-store');

const router = express.Router();
router.use(auth.requireAuth);

// Gate every route behind the schema migration — a failed migration must
// surface as an explicit 503, not as confusing per-query table errors.
router.use(async (req, res, next) => {
  try {
    await orgStore.whenReady();
    next();
  } catch (err) {
    res.status(503).json({ error: 'Organization module not ready — schema migration failed.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

/** Trim + collapse whitespace; null when empty/oversized/not a string. */
function cleanName(raw, maxLen) {
  if (typeof raw !== 'string') return null;
  const name = raw.trim().replace(/\s+/g, ' ');
  if (!name || name.length > maxLen) return null;
  return name;
}

/** Positive-integer id or null. Never trust route/body ids raw. */
function toId(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function isDupErr(err) {
  return err && (err.code === 'ER_DUP_ENTRY' || /Duplicate entry/i.test(err.message || ''));
}

function audit(req, action, templateParams, extra = {}) {
  mspAudit.logMspAudit({
    category: extra.category || mspAudit.CATEGORY.SETTINGS_CHANGE,
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

// ─────────────────────────────────────────────────────────────────────────
// Managed lookup lists — service tiers & sales reps (§1.4)
// ─────────────────────────────────────────────────────────────────────────

const LOOKUPS = {
  'service-tiers': {
    table: 'service_tiers', maxLen: 100, noun: 'service_tier',
    tenantCol: 'service_tier_id', ruleCol: 'rule_service_tier_id',
  },
  'sales-reps': {
    table: 'sales_reps', maxLen: 150, noun: 'sales_rep',
    tenantCol: 'sales_rep_id', ruleCol: 'rule_sales_rep_id',
  },
};

for (const [slug, cfg] of Object.entries(LOOKUPS)) {
  // List (all rows, active + inactive — the Settings widget shows both; the
  // assign dropdowns filter to active client-side, keeping one endpoint).
  router.get(`/${slug}`, async (req, res) => {
    try {
      const rows = await db.queryRows(
        `SELECT l.id, l.name, l.active, l.created_at,
                (SELECT COUNT(*) FROM tenants t       WHERE t.${cfg.tenantCol} = l.id) AS tenant_count,
                (SELECT COUNT(*) FROM tenant_groups g WHERE g.${cfg.ruleCol}  = l.id) AS group_rule_count
           FROM ${cfg.table} l
          ORDER BY l.active DESC, l.name`
      );
      res.json(rows.map(r => ({ ...r, active: !!r.active })));
    } catch (err) {
      console.error(`[Org] List ${slug} failed:`, err.message);
      res.status(500).json({ error: `Failed to load ${slug}` });
    }
  });

  // Create
  router.post(`/${slug}`, auth.requireMemberOrAdmin, async (req, res) => {
    try {
      const name = cleanName(req.body?.name, cfg.maxLen);
      if (!name) return res.status(400).json({ error: 'invalid_name', max_length: cfg.maxLen });
      let id;
      try {
        id = await db.insert(`INSERT INTO ${cfg.table} (name) VALUES (?)`, [name]);
      } catch (err) {
        if (isDupErr(err)) return res.status(409).json({ error: 'duplicate_name', name });
        throw err;
      }
      audit(req, `org.${cfg.noun}.create`, { name }, {
        description: `Created ${cfg.noun.replace('_', ' ')} "${name}"`,
        targetId: id, targetName: name,
      });
      res.status(201).json({ id, name, active: true });
    } catch (err) {
      console.error(`[Org] Create ${slug} failed:`, err.message);
      res.status(500).json({ error: `Failed to create ${slug} entry` });
    }
  });

  // Rename / activate / deactivate
  router.patch(`/${slug}/:id`, auth.requireMemberOrAdmin, async (req, res) => {
    try {
      const id = toId(req.params.id);
      if (!id) return res.status(400).json({ error: 'invalid_id' });
      const prior = await db.queryOne(`SELECT id, name, active FROM ${cfg.table} WHERE id = ?`, [id]);
      if (!prior) return res.status(404).json({ error: 'not_found' });

      const b = req.body || {};
      const wantsName = b.name !== undefined;
      const wantsActive = b.active !== undefined;
      if (!wantsName && !wantsActive) return res.status(400).json({ error: 'no_fields' });

      let name = prior.name;
      if (wantsName) {
        name = cleanName(b.name, cfg.maxLen);
        if (!name) return res.status(400).json({ error: 'invalid_name', max_length: cfg.maxLen });
      }
      const active = wantsActive ? (b.active === true || b.active === 1 || b.active === '1') : !!prior.active;

      try {
        await db.execute(`UPDATE ${cfg.table} SET name = ?, active = ? WHERE id = ?`, [name, active ? 1 : 0, id]);
      } catch (err) {
        if (isDupErr(err)) return res.status(409).json({ error: 'duplicate_name', name });
        throw err;
      }

      if (wantsName && name !== prior.name) {
        audit(req, `org.${cfg.noun}.rename`, { from: prior.name, to: name }, {
          description: `Renamed ${cfg.noun.replace('_', ' ')} "${prior.name}" to "${name}"`,
          targetId: id, targetName: name,
        });
      }
      if (wantsActive && active !== !!prior.active) {
        const verb = active ? 'reactivate' : 'deactivate';
        audit(req, `org.${cfg.noun}.${verb}`, { name }, {
          description: `${active ? 'Reactivated' : 'Deactivated'} ${cfg.noun.replace('_', ' ')} "${name}"`,
          targetId: id, targetName: name,
        });
      }
      res.json({ id, name, active });
    } catch (err) {
      console.error(`[Org] Update ${slug} failed:`, err.message);
      res.status(500).json({ error: `Failed to update ${slug} entry` });
    }
  });

  // Hard delete — BLOCKED while referenced (delete guard, §1.4). Returns the
  // blocking tenant display names (and any dynamic groups whose rule uses the
  // row — nulling a rule dimension via FK would silently change membership).
  router.delete(`/${slug}/:id`, auth.requireMemberOrAdmin, async (req, res) => {
    try {
      const id = toId(req.params.id);
      if (!id) return res.status(400).json({ error: 'invalid_id' });
      const row = await db.queryOne(`SELECT id, name FROM ${cfg.table} WHERE id = ?`, [id]);
      if (!row) return res.status(404).json({ error: 'not_found' });

      const loadBlockers = async () => {
        const blockingTenants = await db.queryRows(
          `SELECT display_name FROM tenants WHERE ${cfg.tenantCol} = ? ORDER BY display_name LIMIT 100`, [id]
        );
        const blockingGroups = await db.queryRows(
          `SELECT name FROM tenant_groups WHERE ${cfg.ruleCol} = ? ORDER BY name LIMIT 100`, [id]
        );
        return {
          blocking_tenants: blockingTenants.map(t => t.display_name),
          blocking_groups: blockingGroups.map(g => g.name),
        };
      };

      const blockers = await loadBlockers();
      if (blockers.blocking_tenants.length > 0 || blockers.blocking_groups.length > 0) {
        return res.status(409).json({ error: 'in_use', ...blockers });
      }

      // Guarded DELETE: the reference checks are re-evaluated atomically in
      // the statement itself, so a tenant/group that grabbed the row between
      // the check above and this DELETE keeps its reference intact instead
      // of the FK silently SET NULL-ing it (TOCTOU guard).
      const affected = await db.execute(
        `DELETE FROM ${cfg.table}
          WHERE ${cfg.table}.id = ?
            AND NOT EXISTS (SELECT 1 FROM tenants t       WHERE t.${cfg.tenantCol} = ${cfg.table}.id)
            AND NOT EXISTS (SELECT 1 FROM tenant_groups g WHERE g.${cfg.ruleCol}  = ${cfg.table}.id)`,
        [id]
      );
      if (affected === 0) {
        // Either the row vanished, or someone referenced it mid-flight —
        // report whichever is now true.
        const still = await db.queryOne(`SELECT id FROM ${cfg.table} WHERE id = ?`, [id]);
        if (!still) return res.status(404).json({ error: 'not_found' });
        return res.status(409).json({ error: 'in_use', ...(await loadBlockers()) });
      }
      audit(req, `org.${cfg.noun}.delete`, { name: row.name }, {
        description: `Deleted ${cfg.noun.replace('_', ' ')} "${row.name}"`,
        targetId: id, targetName: row.name,
      });
      res.json({ ok: true });
    } catch (err) {
      console.error(`[Org] Delete ${slug} failed:`, err.message);
      res.status(500).json({ error: `Failed to delete ${slug} entry` });
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Tenant groups (§1.2, §1.3, §1.6)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Validate + normalize a group payload (create and update share this).
 * Returns { error, status } on rejection, or the normalized fields.
 */
async function validateGroupPayload(body) {
  const b = body || {};
  const name = cleanName(b.name, 150);
  if (!name) return { error: 'invalid_name', status: 400 };

  let description = null;
  if (b.description != null) {
    if (typeof b.description !== 'string' || b.description.length > 2000) {
      return { error: 'invalid_description', status: 400 };
    }
    description = b.description.trim() || null;
  }

  const groupType = b.group_type;
  if (groupType !== 'manual' && groupType !== 'dynamic') {
    return { error: 'invalid_group_type', status: 400 };
  }

  if (groupType === 'manual') {
    if (!Array.isArray(b.member_ids)) return { error: 'invalid_member_ids', status: 400 };
    const memberIds = [...new Set(b.member_ids.map(toId))];
    if (memberIds.some(id => id === null)) return { error: 'invalid_member_ids', status: 400 };
    if (memberIds.length > 0) {
      const placeholders = memberIds.map(() => '?').join(',');
      const found = await db.queryRows(`SELECT id FROM tenants WHERE id IN (${placeholders})`, memberIds);
      if (found.length !== memberIds.length) return { error: 'unknown_tenant', status: 400 };
    }
    return { name, description, groupType, memberIds, tierId: null, repId: null, ruleMatch: 'all' };
  }

  // dynamic
  const tierId = b.rule_service_tier_id == null || b.rule_service_tier_id === '' ? null : toId(b.rule_service_tier_id);
  const repId = b.rule_sales_rep_id == null || b.rule_sales_rep_id === '' ? null : toId(b.rule_sales_rep_id);
  if (b.rule_service_tier_id != null && b.rule_service_tier_id !== '' && tierId === null) return { error: 'invalid_rule', status: 400 };
  if (b.rule_sales_rep_id != null && b.rule_sales_rep_id !== '' && repId === null) return { error: 'invalid_rule', status: 400 };
  if (tierId === null && repId === null) return { error: 'empty_rule', status: 400 };
  const ruleMatch = b.rule_match === 'any' ? 'any' : (b.rule_match === 'all' || b.rule_match == null ? 'all' : null);
  if (ruleMatch === null) return { error: 'invalid_rule_match', status: 400 };
  if (tierId !== null) {
    const t = await db.queryOne('SELECT id FROM service_tiers WHERE id = ?', [tierId]);
    if (!t) return { error: 'unknown_service_tier', status: 400 };
  }
  if (repId !== null) {
    const r = await db.queryOne('SELECT id FROM sales_reps WHERE id = ?', [repId]);
    if (!r) return { error: 'unknown_sales_rep', status: 400 };
  }
  return { name, description, groupType, memberIds: [], tierId, repId, ruleMatch };
}

// List groups with live member counts (badge) + rule display names.
router.get('/groups', async (req, res) => {
  try {
    const groups = await db.queryRows(
      `SELECT g.id, g.name, g.description, g.group_type,
              g.rule_service_tier_id, g.rule_sales_rep_id, g.rule_match,
              g.created_at, g.updated_at,
              st.name AS rule_service_tier_name,
              sr.name AS rule_sales_rep_name
         FROM tenant_groups g
         LEFT JOIN service_tiers st ON st.id = g.rule_service_tier_id
         LEFT JOIN sales_reps  sr ON sr.id = g.rule_sales_rep_id
        ORDER BY g.name`
    );

    // Manual counts in one query; dynamic counts computed per rule.
    const manualCounts = new Map();
    const countRows = await db.queryRows(
      'SELECT group_id, COUNT(*) AS n FROM tenant_group_members GROUP BY group_id'
    );
    for (const r of countRows) manualCounts.set(r.group_id, r.n);

    const out = [];
    for (const g of groups) {
      let memberCount;
      if (g.group_type === 'dynamic') {
        const ids = await orgStore.resolveDynamicRule(g.rule_service_tier_id, g.rule_sales_rep_id, g.rule_match);
        memberCount = ids.length;
      } else {
        memberCount = manualCounts.get(g.id) || 0;
      }
      out.push({ ...g, member_count: memberCount });
    }
    res.json(out);
  } catch (err) {
    console.error('[Org] List groups failed:', err.message);
    res.status(500).json({ error: 'Failed to load tenant groups' });
  }
});

// Group detail (edit modal) — includes resolved member ids.
router.get('/groups/:id', async (req, res) => {
  try {
    const id = toId(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid_id' });
    const g = await db.queryOne(
      `SELECT g.id, g.name, g.description, g.group_type,
              g.rule_service_tier_id, g.rule_sales_rep_id, g.rule_match,
              g.created_at, g.updated_at
         FROM tenant_groups g WHERE g.id = ?`, [id]
    );
    if (!g) return res.status(404).json({ error: 'not_found' });
    const memberIds = await orgStore.resolveGroupMembers(id);
    res.json({ ...g, member_ids: memberIds || [] });
  } catch (err) {
    console.error('[Org] Get group failed:', err.message);
    res.status(500).json({ error: 'Failed to load tenant group' });
  }
});

// Live preview count for the dynamic-rule builder. Read-only despite POST
// (rule arrives in the body). Uses the SAME resolver as real membership so
// the preview can never disagree with the saved group.
router.post('/groups/preview', async (req, res) => {
  try {
    const b = req.body || {};
    const tierId = b.rule_service_tier_id == null || b.rule_service_tier_id === '' ? null : toId(b.rule_service_tier_id);
    const repId = b.rule_sales_rep_id == null || b.rule_sales_rep_id === '' ? null : toId(b.rule_sales_rep_id);
    if (tierId === null && repId === null) return res.json({ count: 0 });
    const ruleMatch = b.rule_match === 'any' ? 'any' : 'all';
    const ids = await orgStore.resolveDynamicRule(tierId, repId, ruleMatch);
    res.json({ count: ids.length });
  } catch (err) {
    console.error('[Org] Group preview failed:', err.message);
    res.status(500).json({ error: 'Failed to preview rule' });
  }
});

// Create group
router.post('/groups', auth.requireMemberOrAdmin, async (req, res) => {
  try {
    const v = await validateGroupPayload(req.body);
    if (v.error) return res.status(v.status).json({ error: v.error });

    let groupId;
    try {
      groupId = await db.withTransaction(async (conn) => {
        const [ins] = await conn.execute(
          `INSERT INTO tenant_groups (name, description, group_type, rule_service_tier_id, rule_sales_rep_id, rule_match)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [v.name, v.description, v.groupType, v.tierId, v.repId, v.ruleMatch]
        );
        const id = ins.insertId;
        for (const tenantId of v.memberIds) {
          await conn.execute(
            'INSERT INTO tenant_group_members (group_id, tenant_id) VALUES (?, ?)',
            [id, tenantId]
          );
        }
        return id;
      });
    } catch (err) {
      if (isDupErr(err)) return res.status(409).json({ error: 'duplicate_name', name: v.name });
      throw err;
    }

    audit(req, 'org.group.create', { name: v.name, type: v.groupType }, {
      category: mspAudit.CATEGORY.TENANT_CONFIG,
      description: `Created ${v.groupType} tenant group "${v.name}"`,
      targetId: groupId, targetName: v.name,
      metadata: {
        group_type: v.groupType,
        member_ids: v.groupType === 'manual' ? v.memberIds : undefined,
        rule: v.groupType === 'dynamic' ? { service_tier_id: v.tierId, sales_rep_id: v.repId, match: v.ruleMatch } : undefined,
      },
    });
    res.status(201).json({ id: groupId, name: v.name });
  } catch (err) {
    console.error('[Org] Create group failed:', err.message);
    res.status(500).json({ error: 'Failed to create tenant group' });
  }
});

// Update group (name/description/type/members/rule — full replace semantics)
router.patch('/groups/:id', auth.requireMemberOrAdmin, async (req, res) => {
  try {
    const id = toId(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid_id' });
    const prior = await db.queryOne('SELECT id, name, group_type FROM tenant_groups WHERE id = ?', [id]);
    if (!prior) return res.status(404).json({ error: 'not_found' });

    const v = await validateGroupPayload(req.body);
    if (v.error) return res.status(v.status).json({ error: v.error });

    try {
      await db.withTransaction(async (conn) => {
        await conn.execute(
          `UPDATE tenant_groups
              SET name = ?, description = ?, group_type = ?,
                  rule_service_tier_id = ?, rule_sales_rep_id = ?, rule_match = ?
            WHERE id = ?`,
          [v.name, v.description, v.groupType, v.tierId, v.repId, v.ruleMatch, id]
        );
        // Membership rows only exist for manual groups — full replace keeps
        // the stored state exactly equal to what the operator sees in the modal.
        await conn.execute('DELETE FROM tenant_group_members WHERE group_id = ?', [id]);
        for (const tenantId of v.memberIds) {
          await conn.execute(
            'INSERT INTO tenant_group_members (group_id, tenant_id) VALUES (?, ?)',
            [id, tenantId]
          );
        }
      });
    } catch (err) {
      if (isDupErr(err)) return res.status(409).json({ error: 'duplicate_name', name: v.name });
      throw err;
    }

    audit(req, 'org.group.update', { name: v.name }, {
      category: mspAudit.CATEGORY.TENANT_CONFIG,
      description: `Updated tenant group "${v.name}"`,
      targetId: id, targetName: v.name,
      metadata: {
        group_type: v.groupType,
        member_ids: v.groupType === 'manual' ? v.memberIds : undefined,
        rule: v.groupType === 'dynamic' ? { service_tier_id: v.tierId, sales_rep_id: v.repId, match: v.ruleMatch } : undefined,
      },
    });
    res.json({ id, name: v.name });
  } catch (err) {
    console.error('[Org] Update group failed:', err.message);
    res.status(500).json({ error: 'Failed to update tenant group' });
  }
});

// Delete group — removes ONLY the grouping (members cascade), never tenants.
router.delete('/groups/:id', auth.requireMemberOrAdmin, async (req, res) => {
  try {
    const id = toId(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid_id' });
    const row = await db.queryOne('SELECT id, name FROM tenant_groups WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'not_found' });

    const affected = await db.execute('DELETE FROM tenant_groups WHERE id = ?', [id]);
    if (affected === 0) return res.status(404).json({ error: 'not_found' });

    audit(req, 'org.group.delete', { name: row.name }, {
      category: mspAudit.CATEGORY.TENANT_CONFIG,
      description: `Deleted tenant group "${row.name}" (grouping only — tenants unaffected)`,
      targetId: id, targetName: row.name,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('[Org] Delete group failed:', err.message);
    res.status(500).json({ error: 'Failed to delete tenant group' });
  }
});

module.exports = router;
