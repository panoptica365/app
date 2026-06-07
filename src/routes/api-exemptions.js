/**
 * Panoptica — Unified Exemptions API
 *
 * Returns a single list of Panoptica-granted exceptions across CA, Intune,
 * and operator-defined alert exemption rules:
 *
 *   - ca         → per-principal carve-outs (ca_exemptions rows). User/group
 *                  excluded from a CA template with reason + expiry.
 *   - intune     → policy-wide accepted drifts (intune_deployments rows where
 *                  drift_status='accepted' and acknowledged_* is populated).
 *   - alert_rule → operator-defined alert pattern auto-resolves
 *                  (alert_exemption_rules rows). Per-policy, scoped by
 *                  UPN + optional country/IP. Apr 30, 2026.
 *
 * The row shape is normalized so the Exemptions page can render all
 * sources in one table. A `source` field distinguishes them for the
 * revoke dispatcher on the frontend.
 *
 * Source revoke semantics:
 *   - CA         : soft-delete (revoked_at column). Historical rows visible
 *                  with include_revoked=1.
 *   - Intune     : flips drift_status back to 'drifted', clears acknowledged_*.
 *                  Once revoked, the row leaves this list — there is no
 *                  history view. include_revoked is a no-op for Intune.
 *   - alert_rule : soft-delete (revoked_at column). DELETE /api/alert-exemptions/:id.
 *
 * Endpoint is mounted at /api/exemptions in server.js.
 */

const express = require('express');
const auth = require('../auth');
const db = require('../db/database');

const router = express.Router();
router.use(auth.requireAuth);

router.get('/', async (req, res) => {
  try {
    const { tenant_id, source, include_revoked } = req.query;
    const wantCa = !source || source === 'ca';
    const wantIntune = !source || source === 'intune';
    const wantAlertRule = !source || source === 'alert_rule';

    const results = [];

    // ─── CA exemptions ────────────────────────────────────────────────
    if (wantCa) {
      const clauses = [];
      const params = [];
      if (tenant_id) {
        clauses.push('a.tenant_id = ?');
        params.push(parseInt(tenant_id, 10));
      }
      if (!include_revoked) {
        clauses.push('e.revoked_at IS NULL');
        clauses.push('e.expires_at > NOW()');
      }
      const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';

      const caRows = await db.queryRows(
        `SELECT 'ca'                          AS source,
                e.id                          AS id,
                a.tenant_id                   AS tenant_id,
                tn.display_name               AS tenant_name,
                a.template_id                 AS template_id,
                t.name                        AS template_name,
                e.principal_type              AS principal_type,
                e.principal_id                AS principal_id,
                e.principal_label             AS principal_label,
                e.reason                      AS reason,
                e.accepted_by                 AS accepted_by,
                e.accepted_at                 AS accepted_at,
                e.expires_at                  AS expires_at,
                TIMESTAMPDIFF(DAY, NOW(), e.expires_at) AS days_remaining,
                e.revoked_at                  AS revoked_at
           FROM ca_exemptions e
           JOIN ca_assignments a ON a.id = e.assignment_id
           JOIN ca_templates   t ON t.id = a.template_id
           JOIN tenants       tn ON tn.id = a.tenant_id
           ${where}`,
        params
      );
      results.push(...caRows);
    }

    // ─── Intune accepted drifts ──────────────────────────────────────
    if (wantIntune) {
      const clauses = ["d.drift_status = 'accepted'", 'd.acknowledged_at IS NOT NULL'];
      const params = [];
      if (tenant_id) {
        clauses.push('d.tenant_id = ?');
        params.push(parseInt(tenant_id, 10));
      }
      const where = 'WHERE ' + clauses.join(' AND ');

      const intuneRows = await db.queryRows(
        `SELECT 'intune'                            AS source,
                d.id                                AS id,
                d.tenant_id                         AS tenant_id,
                tn.display_name                     AS tenant_name,
                d.template_id                       AS template_id,
                t.name                              AS template_name,
                'policy'                            AS principal_type,
                NULL                                AS principal_id,
                '(policy-wide)'                     AS principal_label,
                d.acknowledged_reason               AS reason,
                d.acknowledged_by                   AS accepted_by,
                d.acknowledged_at                   AS accepted_at,
                d.acknowledged_expires_at           AS expires_at,
                CASE WHEN d.acknowledged_expires_at IS NULL THEN NULL
                     ELSE TIMESTAMPDIFF(DAY, NOW(), d.acknowledged_expires_at) END AS days_remaining,
                NULL                                AS revoked_at
           FROM intune_deployments d
           JOIN intune_templates t ON t.id = d.template_id
           JOIN tenants         tn ON tn.id = d.tenant_id
           ${where}`,
        params
      );
      results.push(...intuneRows);
    }

    // ─── Alert exemption rules (operator-defined) ─────────────────────
    // Apr 30, 2026 — pattern-based per-policy auto-resolves. See
    // src/lib/alert-exemption-matcher.js + migrate-alert-exemption-rules.sql.
    if (wantAlertRule) {
      const clauses = [];
      const params = [];
      if (tenant_id) {
        clauses.push('r.tenant_id = ?');
        params.push(parseInt(tenant_id, 10));
      }
      if (!include_revoked) {
        clauses.push('r.revoked_at IS NULL');
        clauses.push('r.expires_at > UTC_TIMESTAMP()');
      }
      const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';

      let alertRuleRows = [];
      try {
        alertRuleRows = await db.queryRows(
          `SELECT 'alert_rule'                                AS source,
                  r.id                                        AS id,
                  r.tenant_id                                 AS tenant_id,
                  tn.display_name                             AS tenant_name,
                  r.policy_id                                 AS template_id,
                  COALESCE(p.name, CONCAT('policy #', r.policy_id)) AS template_name,
                  'pattern'                                   AS principal_type,
                  NULL                                        AS principal_id,
                  CONCAT(
                    r.match_upn,
                    CASE WHEN r.match_country IS NOT NULL THEN CONCAT(' / ', r.match_country) ELSE '' END,
                    CASE WHEN r.match_ip_cidr IS NOT NULL THEN CONCAT(' / ', r.match_ip_cidr) ELSE '' END
                  )                                           AS principal_label,
                  r.reason                                    AS reason,
                  r.created_by                                AS accepted_by,
                  r.created_at                                AS accepted_at,
                  r.expires_at                                AS expires_at,
                  TIMESTAMPDIFF(DAY, UTC_TIMESTAMP(), r.expires_at) AS days_remaining,
                  r.revoked_at                                AS revoked_at,
                  r.match_count                               AS suppression_count,
                  r.match_upn                                 AS match_upn,
                  r.match_country                             AS match_country,
                  r.match_ip_cidr                             AS match_ip_cidr,
                  r.match_asn                                 AS match_asn
             FROM alert_exemption_rules r
             JOIN tenants tn ON tn.id = r.tenant_id
             LEFT JOIN alert_policies p ON p.id = r.policy_id
             ${where}`,
          params
        );
      } catch (e) {
        // Migration not yet run on this DB — table doesn't exist. Treat
        // as no alert-rule exemptions and continue serving CA + Intune.
        console.warn('[Exemptions] alert_exemption_rules query failed (migration not run?):', e.message);
        alertRuleRows = [];
      }
      results.push(...alertRuleRows);
    }

    // Sort:
    //   1. Revoked rows to the bottom.
    //   2. Forever-accepts (expires_at IS NULL) below the dated ones.
    //   3. Among dated actives, sort by nearest expiry first.
    results.sort((a, b) => {
      if (a.revoked_at && !b.revoked_at) return 1;
      if (!a.revoked_at && b.revoked_at) return -1;
      if (a.expires_at == null && b.expires_at == null) return 0;
      if (a.expires_at == null) return 1;
      if (b.expires_at == null) return -1;
      return new Date(a.expires_at) - new Date(b.expires_at);
    });

    // Apr 28, 2026: include suppression counts for CA exemptions so the UI
    // can label "View suppressions (N)" without a second round-trip per row.
    // Intune rows: count not applicable (Intune accept doesn't suppress
    // alerts via exemption — drift_status flip handles silencing).
    const caIds = results
      .filter(r => r.source === 'ca' && !r.revoked_at)
      .map(r => r.id);
    if (caIds.length) {
      const placeholders = caIds.map(() => '?').join(',');
      const countRows = await db.queryRows(
        `SELECT exemption_id, COUNT(*) AS n
           FROM alerts_suppressed
          WHERE exemption_id IN (${placeholders})
          GROUP BY exemption_id`,
        caIds
      );
      const countMap = new Map(countRows.map(r => [r.exemption_id, r.n]));
      for (const r of results) {
        if (r.source === 'ca' && countMap.has(r.id)) {
          r.suppression_count = countMap.get(r.id);
        } else if (r.source === 'ca') {
          r.suppression_count = 0;
        }
      }
    }

    res.json({ exemptions: results });
  } catch (err) {
    console.error('[Exemptions] List failed:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/exemptions/ca/:id/suppressions
 *
 * Returns the audit rows from alerts_suppressed for a given CA exemption.
 * Joined to alert_policies for the policy name; tenants for the display
 * name. Bounded to 200 rows by default — operators wanting more should
 * filter, not paginate.
 *
 * Intune accept-drift doesn't suppress alerts via this mechanism (it flips
 * drift_status on the deployment row). Hence no /intune/:id/suppressions —
 * an Intune deployment whose drift was accepted simply stops firing fresh
 * drift alerts; nothing lands in alerts_suppressed.
 */
router.get('/ca/:id/suppressions', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid exemption id' });

    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);

    const rows = await db.queryRows(
      `SELECT s.id,
              s.tenant_id,
              tn.display_name AS tenant_name,
              s.policy_id,
              p.name          AS policy_name,
              p.category      AS policy_category,
              s.evaluator,
              s.upn,
              s.control_dimension,
              s.event_snippet,
              s.suppressed_at
         FROM alerts_suppressed s
         JOIN tenants        tn ON tn.id = s.tenant_id
         LEFT JOIN alert_policies p ON p.id = s.policy_id
        WHERE s.exemption_id = ?
        ORDER BY s.suppressed_at DESC
        LIMIT ${limit}`,
      [id]
    );

    res.json({ exemption_id: id, count: rows.length, suppressions: rows });
  } catch (err) {
    console.error('[Exemptions] Suppression list failed:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
