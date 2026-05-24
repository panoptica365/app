/**
 * Panoptica — Intune Policy Management API
 * Export policies from tenants, import as templates, deploy (with name-match update),
 * and drift monitoring.
 */

const express = require('express');
const crypto = require('crypto');
const auth = require('../auth');
const db = require('../db/database');
const graph = require('../graph');
const notifier = require('../notifier');
const changeLog = require('../change-log');
const mspAudit = require('../msp-audit');

const router = express.Router();
router.use(auth.requireAuth);

// ═══════════════════════════════════════════
// AUTO-MIGRATION
// ═══════════════════════════════════════════

let intuneDriftPolicyId = null; // alert_policies.id for Intune drift alerts

async function ensureIntuneSchema() {
  // intune_templates
  await db.execute(`
    CREATE TABLE IF NOT EXISTS intune_templates (
      id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      name            VARCHAR(255) NOT NULL,
      description     TEXT,
      category        VARCHAR(100) NOT NULL DEFAULT 'other',
      policy_type     VARCHAR(50)  NOT NULL DEFAULT 'configurationPolicies',
      platform        VARCHAR(50)  DEFAULT 'windows10',
      template_family VARCHAR(150) DEFAULT NULL,
      policy_json     LONGTEXT     NOT NULL,
      source_tenant   VARCHAR(100) DEFAULT NULL,
      tags            VARCHAR(500) DEFAULT NULL,
      assignment_target ENUM('none','all_users','all_devices') NOT NULL DEFAULT 'none',
      alert_routing   ENUM('support','personal','both','none') NOT NULL DEFAULT 'both',
      created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // intune_deployments — tracks template → tenant linkage + drift status
  await db.execute(`
    CREATE TABLE IF NOT EXISTS intune_deployments (
      id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      template_id     INT UNSIGNED NOT NULL,
      tenant_id       INT UNSIGNED NOT NULL,
      deployed_policy_id VARCHAR(200) DEFAULT NULL,
      status          ENUM('pending','deployed','failed','removed') NOT NULL DEFAULT 'pending',
      drift_status    ENUM('ok','drifted','accepted','missing','unchecked') NOT NULL DEFAULT 'unchecked',
      drift_details   JSON         DEFAULT NULL,
      last_checked_at DATETIME     DEFAULT NULL,
      assignment_target ENUM('none','all_users','all_devices') DEFAULT NULL,
      alert_routing   ENUM('support','personal','both','none') DEFAULT NULL,
      acknowledged_drift_hash    VARCHAR(64)  DEFAULT NULL,
      acknowledged_drift_payload JSON         DEFAULT NULL,
      acknowledged_at            DATETIME     DEFAULT NULL,
      acknowledged_by            VARCHAR(255) DEFAULT NULL,
      error_message   TEXT         DEFAULT NULL,
      deployed_at     DATETIME     DEFAULT NULL,
      deployed_by     VARCHAR(255) DEFAULT NULL,
      created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (template_id) REFERENCES intune_templates(id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id)   REFERENCES tenants(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Add columns if table already exists (migration for existing installs)
  for (const col of [
    { name: 'drift_status', def: "ENUM('ok','drifted','accepted','missing','unchecked') NOT NULL DEFAULT 'unchecked' AFTER status" },
    { name: 'drift_details', def: "JSON DEFAULT NULL AFTER drift_status" },
    { name: 'last_checked_at', def: "DATETIME DEFAULT NULL AFTER drift_details" },
    { name: 'assignment_target', table: 'intune_deployments', def: "ENUM('none','all_users','all_devices') DEFAULT NULL AFTER last_checked_at" },
    { name: 'assignment_target', table: 'intune_templates', def: "ENUM('none','all_users','all_devices') NOT NULL DEFAULT 'none' AFTER tags" },
    { name: 'alert_routing', table: 'intune_templates', def: "ENUM('support','personal','both','none') NOT NULL DEFAULT 'both' AFTER assignment_target" },
    { name: 'alert_routing', table: 'intune_deployments', def: "ENUM('support','personal','both','none') DEFAULT NULL AFTER assignment_target" },
    { name: 'acknowledged_drift_hash',    table: 'intune_deployments', def: "VARCHAR(64)  DEFAULT NULL AFTER alert_routing" },
    { name: 'acknowledged_drift_payload', table: 'intune_deployments', def: "JSON         DEFAULT NULL AFTER acknowledged_drift_hash" },
    { name: 'acknowledged_at',            table: 'intune_deployments', def: "DATETIME     DEFAULT NULL AFTER acknowledged_drift_payload" },
    { name: 'acknowledged_by',            table: 'intune_deployments', def: "VARCHAR(255) DEFAULT NULL AFTER acknowledged_at" },
    // Phase 3 MVP (2026-04-18): Intune drift-accept can optionally have an expiry,
    // mirroring CA exemption expiry. When NULL, acceptance is indefinite.
    // When past, the scheduler clears the acknowledgment and drift re-raises.
    { name: 'acknowledged_expires_at',    table: 'intune_deployments', def: "DATETIME     DEFAULT NULL AFTER acknowledged_by" },
    { name: 'acknowledged_reason',        table: 'intune_deployments', def: "TEXT         DEFAULT NULL AFTER acknowledged_expires_at" },
    // Apr 19, 2026: honest deploy outcome. Graph's create returns a GUID instantly,
    // but (a) assignment is a separate POST that can fail while create succeeded,
    // and (b) post-create propagation means the policy may not yet be retrievable
    // from the tenant replica. Record each phase's outcome so the audit trail and
    // UI can stop lying when something didn't actually work end-to-end.
    { name: 'assignment_status',          table: 'intune_deployments', def: "ENUM('not_applicable','success','failed','not_attempted') DEFAULT NULL AFTER acknowledged_reason" },
    { name: 'assignment_error',           table: 'intune_deployments', def: "TEXT         DEFAULT NULL AFTER assignment_status" },
    { name: 'verified_at',                table: 'intune_deployments', def: "DATETIME     DEFAULT NULL AFTER assignment_error" },
    { name: 'verification_error',         table: 'intune_deployments', def: "TEXT         DEFAULT NULL AFTER verified_at" },
  ]) {
    try {
      const tbl = col.table || 'intune_deployments';
      const exists = await db.queryRows(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
        [tbl, col.name]
      );
      if (exists.length === 0) {
        await db.execute(`ALTER TABLE ${tbl} ADD COLUMN ${col.name} ${col.def}`);
        console.log(`[Intune] Added column ${col.name} to ${tbl}`);
      }
    } catch (e) { /* already exists */ }
  }

  // Phase 9 migration: upgrade drift_status ENUM on existing installs to include 'accepted'.
  // ALTER TABLE MODIFY is idempotent in effect — re-running with the same definition is a no-op.
  try {
    const col = await db.queryOne(
      "SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'intune_deployments' AND COLUMN_NAME = 'drift_status'"
    );
    if (col && col.COLUMN_TYPE && !col.COLUMN_TYPE.includes("'accepted'")) {
      await db.execute(
        "ALTER TABLE intune_deployments MODIFY COLUMN drift_status ENUM('ok','drifted','accepted','missing','unchecked') NOT NULL DEFAULT 'unchecked'"
      );
      console.log("[Intune] Phase 9 migration: added 'accepted' to drift_status enum");
    }
  } catch (e) {
    console.warn('[Intune] Phase 9 drift_status enum upgrade (non-fatal):', e.message);
  }

  // Phase 11c backfill (2026-04-28): rows accepted before the exemption-system
  // landed (Apr 18) have drift_status='accepted' but NULL acknowledged_reason
  // and NULL acknowledged_expires_at, which renders as a blank reason on the
  // unified Exemptions page. Naturally idempotent: WHERE filter excludes
  // already-backfilled rows. Cosmetic only — does not change drift behavior.
  try {
    const n = await db.execute(
      `UPDATE intune_deployments
          SET acknowledged_reason = '(accepted pre-exemption-system)'
        WHERE drift_status = 'accepted'
          AND acknowledged_reason IS NULL`
    );
    if (n > 0) {
      console.log(`[Intune] Phase 11c backfill: tagged ${n} pre-exemption-system acceptances with default reason`);
    }
  } catch (e) {
    console.warn('[Intune] Phase 11c backfill (non-fatal):', e.message);
  }

  // Ensure alert policy for Intune drift
  const driftPolicy = await db.queryOne(
    "SELECT id FROM alert_policies WHERE name = 'Intune Policy Drift Detected' LIMIT 1"
  );
  if (!driftPolicy) {
    intuneDriftPolicyId = await db.insert(
      `INSERT INTO alert_policies (name, description, category, severity, detection_logic, polling_tier, enabled, notification_target)
       VALUES ('Intune Policy Drift Detected',
               'An Intune policy has drifted from its expected template configuration.',
               'config_changes', 'high',
               '{"type":"intune_drift","subtype":"detected","skip_engine":true}',
               'medium', TRUE, 'both')`
    );
    console.log('[Intune] Created alert policy: Intune Policy Drift Detected');
  } else {
    intuneDriftPolicyId = driftPolicy.id;
  }

  console.log('[Intune] Schema verified');
}

const intuneSchemaReady = ensureIntuneSchema().catch(err => {
  console.error('[Intune] Schema migration failed:', err.message);
  throw err;
});

// Gate deploy/drift routes behind schema readiness
router.use(async (req, res, next) => {
  try {
    await intuneSchemaReady;
    next();
  } catch (err) {
    res.status(503).json({ error: 'Intune module not ready — schema migration failed. Check server logs.' });
  }
});

// ═══════════════════════════════════════════
// POLICY TYPE DEFINITIONS
// ═══════════════════════════════════════════

const POLICY_TYPES = [
  {
    key: 'configurationPolicies',
    label: 'Settings Catalog',
    listEndpoint: '/deviceManagement/configurationPolicies',
    settingsEndpoint: id => `/deviceManagement/configurationPolicies('${id}')/settings`,
    policyEndpoint: id => `/deviceManagement/configurationPolicies('${id}')`,
    // settingsPutEndpoint is currently UNUSED — left in place pending the
    // Intune bulk-deploy spike (see backlog.md §1 "Intune template — Import
    // Update + bulk-deploy to all tenants"). The spike will confirm whether
    // Microsoft Graph PUT /deviceManagement/configurationPolicies('{id}')/settings
    // works against a real Settings Catalog policy in 2026. If it does, this
    // endpoint becomes the basis for non-destructive template updates that
    // preserve per-tenant assignment exclusions. If not, the fallback is
    // delete+recreate with explicit assignment capture/replay. Do not delete
    // without removing the backlog item first.
    settingsPutEndpoint: id => `/deviceManagement/configurationPolicies('${id}')/settings`,
    version: 'beta',
    nameField: 'name',
    extractName: p => p.name,
    extractDesc: p => p.description || '',
    extractCategory: p => p.templateReference?.templateFamily || 'settingsCatalog',
    stripForTemplate: p => {
      const clean = {
        name: p.name,
        description: p.description || '',
        platforms: p.platforms,
        technologies: p.technologies,
        roleScopeTagIds: p.roleScopeTagIds || ['0'],
        templateReference: p.templateReference ? {
          templateId: p.templateReference.templateId,
          templateFamily: p.templateReference.templateFamily,
          templateDisplayName: p.templateReference.templateDisplayName,
          templateDisplayVersion: p.templateReference.templateDisplayVersion,
        } : null,
      };
      return clean;
    },
  },
  {
    key: 'deviceConfigurations',
    label: 'Device Configuration (Legacy)',
    listEndpoint: '/deviceManagement/deviceConfigurations',
    policyEndpoint: id => `/deviceManagement/deviceConfigurations('${id}')`,
    version: 'beta',
    nameField: 'displayName',
    extractName: p => p.displayName,
    extractDesc: p => p.description || '',
    extractCategory: p => p['@odata.type']?.split('.').pop() || 'deviceConfiguration',
    stripForTemplate: p => {
      const clean = { ...p };
      delete clean.id;
      delete clean.createdDateTime;
      delete clean.lastModifiedDateTime;
      delete clean.version;
      delete clean.supportsScopeTags;
      delete clean.deviceManagementApplicabilityRuleDeviceMode;
      delete clean.deviceManagementApplicabilityRuleOsEdition;
      delete clean.deviceManagementApplicabilityRuleOsVersion;
      return clean;
    },
  },
  {
    key: 'deviceCompliancePolicies',
    label: 'Compliance Policies',
    listEndpoint: '/deviceManagement/deviceCompliancePolicies',
    policyEndpoint: id => `/deviceManagement/deviceCompliancePolicies('${id}')`,
    version: 'beta',
    nameField: 'displayName',
    extractName: p => p.displayName,
    extractDesc: p => p.description || '',
    extractCategory: p => p['@odata.type']?.split('.').pop() || 'compliancePolicy',
    stripForTemplate: p => {
      const clean = { ...p };
      delete clean.id;
      delete clean.createdDateTime;
      delete clean.lastModifiedDateTime;
      delete clean.version;
      delete clean.validOperatingSystemBuildRanges;
      return clean;
    },
  },
  {
    key: 'groupPolicyConfigurations',
    label: 'Administrative Templates',
    listEndpoint: '/deviceManagement/groupPolicyConfigurations',
    policyEndpoint: id => `/deviceManagement/groupPolicyConfigurations('${id}')`,
    definitionsEndpoint: id => `/deviceManagement/groupPolicyConfigurations('${id}')/definitionValues?$expand=definition($select=displayName,categoryPath,classType)`,
    version: 'beta',
    nameField: 'displayName',
    extractName: p => p.displayName,
    extractDesc: p => p.description || '',
    extractCategory: () => 'administrativeTemplates',
    stripForTemplate: p => {
      const clean = { ...p };
      delete clean.id;
      delete clean.createdDateTime;
      delete clean.lastModifiedDateTime;
      delete clean.version;
      delete clean.roleScopeTagIds;
      return clean;
    },
  },
  {
    key: 'intents',
    label: 'Security Baselines',
    listEndpoint: '/deviceManagement/intents',
    policyEndpoint: id => `/deviceManagement/intents('${id}')`,
    settingsEndpoint: id => `/deviceManagement/intents('${id}')/settings`,
    categoriesEndpoint: id => `/deviceManagement/intents('${id}')/categories`,
    version: 'beta',
    nameField: 'displayName',
    extractName: p => p.displayName,
    extractDesc: p => p.description || '',
    extractCategory: p => p.templateId ? 'securityBaseline' : 'intent',
    stripForTemplate: p => {
      const clean = {
        displayName: p.displayName,
        description: p.description || '',
        templateId: p.templateId,
        roleScopeTagIds: p.roleScopeTagIds || ['0'],
      };
      return clean;
    },
  },
];

function getPolicyType(key) {
  return POLICY_TYPES.find(pt => pt.key === key);
}

// ═══════════════════════════════════════════
// ASSIGNMENT TARGETS
// ═══════════════════════════════════════════

/**
 * Assignment endpoint mapping per policy type.
 * Graph API uses different base paths but all use /assignments POST.
 */
const ASSIGNMENT_ENDPOINTS = {
  configurationPolicies: id => `/deviceManagement/configurationPolicies('${id}')/assign`,
  deviceConfigurations: id => `/deviceManagement/deviceConfigurations('${id}')/assign`,
  deviceCompliancePolicies: id => `/deviceManagement/deviceCompliancePolicies('${id}')/assign`,
  groupPolicyConfigurations: id => `/deviceManagement/groupPolicyConfigurations('${id}')/assign`,
  intents: id => `/deviceManagement/intents('${id}')/assign`,
};

/**
 * POST an assignment (All Users or All Devices) to a deployed Intune policy.
 *
 * Graph has post-create eventual consistency: immediately after POST creates
 * the policy and returns its GUID, the replica that receives our /assign POST
 * may not yet know the policy exists → 404. Propagation is usually <10s.
 * So we retry 404s with exponential backoff. The first N attempts use
 * `silent: true` to avoid stamping `api_health` with a transient 'broken' row
 * that will never be overwritten (since /assign is a one-shot endpoint). Only
 * the final attempt is non-silent, so if it genuinely fails, the health signal
 * surfaces a real problem — not a race.
 *
 * @param {string} azureTenantId - The Azure tenant GUID
 * @param {string} policyType - One of the POLICY_TYPES keys
 * @param {string} policyId - The deployed policy's Graph ID
 * @param {string} target - 'all_users' or 'all_devices'
 */
async function postAssignment(azureTenantId, policyType, policyId, target) {
  const endpointFn = ASSIGNMENT_ENDPOINTS[policyType];
  if (!endpointFn) throw new Error(`No assignment endpoint for policy type: ${policyType}`);

  const odataTarget = target === 'all_users'
    ? '#microsoft.graph.allLicensedUsersAssignmentTarget'
    : '#microsoft.graph.allDevicesAssignmentTarget';

  const assignmentBody = {
    assignments: [{
      target: {
        '@odata.type': odataTarget,
      },
    }],
  };

  const endpoint = endpointFn(policyId);
  // Backoff schedule covers ~15s of propagation delay total.
  const backoffMs = [1000, 2000, 4000, 8000];

  for (let attempt = 0; attempt < backoffMs.length; attempt++) {
    const isLastAttempt = attempt === backoffMs.length - 1;
    try {
      return await graph.callGraph(azureTenantId, endpoint, {
        version: 'beta',
        method: 'POST',
        body: assignmentBody,
        // Swallow transient 404s silently; only stamp api_health on the final attempt.
        silent: !isLastAttempt,
      });
    } catch (err) {
      // Only retry on 404 (post-create eventual consistency). Everything else
      // is either a real permission/shape problem (4xx) or already retried by
      // callGraph itself (5xx, network). Don't double-retry those.
      if (err?.statusCode !== 404 || isLastAttempt) throw err;
      console.warn(`[Intune:Assign] 404 on ${endpoint} (attempt ${attempt + 1}/${backoffMs.length}) — retrying in ${backoffMs[attempt]}ms (Graph propagation)`);
      await new Promise(r => setTimeout(r, backoffMs[attempt]));
    }
  }
}

/**
 * Verify a just-deployed Intune policy is actually present in the tenant.
 *
 * Why this exists: Graph returns a GUID from POST /createInstance (intents) or
 * POST /configurationPolicies before the policy is fully committed across all
 * replicas. We've seen cases where the create response looks fine, the /assign
 * call succeeds, but a subsequent GET against the policy endpoint 404s for
 * a few seconds. Worse: an operator looking at the Intune admin portal sees
 * nothing because they're looking at the wrong node (intents render under
 * Endpoint security > Security baselines, not Devices > Configuration).
 *
 * Verification answers one concrete question: "Can Graph retrieve this policy
 * by ID right now?" If yes → the policy truly exists. If no after retries →
 * something is genuinely wrong (permission, quota, Graph outage, wrong
 * templateId). We surface that instead of reporting success.
 *
 * Returns { ok: true } or { ok: false, error: string }.
 */
async function verifyDeployedPolicy(azureTenantId, policyType, policyId) {
  const pType = getPolicyType(policyType);
  if (!pType) return { ok: false, error: `Unknown policy type: ${policyType}` };
  const endpoint = pType.policyEndpoint(policyId);
  // Same propagation window as postAssignment — ~15s total.
  const backoffMs = [1000, 2000, 4000, 8000];
  let lastErr = null;
  let entity = null;
  for (let attempt = 0; attempt < backoffMs.length; attempt++) {
    const isLastAttempt = attempt === backoffMs.length - 1;
    try {
      entity = await graph.callGraph(azureTenantId, endpoint, {
        version: pType.version,
        method: 'GET',
        silent: !isLastAttempt,
      });
      break;
    } catch (err) {
      lastErr = err;
      if (err?.statusCode !== 404 || isLastAttempt) {
        return { ok: false, error: `${err?.statusCode || 'ERR'}: ${err.message}` };
      }
      await new Promise(r => setTimeout(r, backoffMs[attempt]));
    }
  }
  if (!entity && lastErr) {
    return { ok: false, error: lastErr.message || 'Unknown verification failure' };
  }

  // For intents, a GET against /intents('{id}') returning 200 is necessary but
  // not sufficient — Graph has been observed to create "ghost" intent entities
  // (accessible via GET, invisible in the admin portal) when settingsDelta
  // doesn't hydrate. Prove the intent has actual settings attached by fetching
  // the settings sub-endpoint. Zero settings on a baseline = ghost intent.
  if (policyType === 'intents' && pType.settingsEndpoint) {
    try {
      const intentSettings = await graph.callGraphPaged(
        azureTenantId, pType.settingsEndpoint(policyId),
        { version: 'beta', maxPages: 2 }
      );
      const settingCount = Array.isArray(intentSettings) ? intentSettings.length : 0;
      if (settingCount === 0) {
        return {
          ok: false,
          error: `Intent created at ${policyId} but has 0 settings attached — admin portal will not show it. Likely cause: settingsDelta shape mismatch or foreign setting IDs. Re-export the template from the source tenant.`,
          settingCount,
        };
      }
      console.log(`[Intune:Verify] Intent ${policyId} has ${settingCount} settings attached — admin portal should render it.`);
      return { ok: true, settingCount };
    } catch (sErr) {
      // Settings sub-endpoint failure is non-fatal for the verification itself
      // but we surface it as a warning on the deployment.
      return {
        ok: false,
        error: `Intent GET succeeded but /settings sub-endpoint failed: ${sErr?.statusCode || 'ERR'}: ${sErr.message}`,
      };
    }
  }

  return { ok: true };
}

/**
 * Remove stale api_health rows for a removed Intune policy.
 *
 * Why this exists: api_health is keyed on (tenant_id, endpoint). For policy
 * endpoints the endpoint URL contains the policy GUID. When we delete the
 * deployment (and/or the policy itself from Graph), those endpoint URLs are
 * never called again — any 'broken' rows left behind stick forever, poisoning
 * the System Health dashboard's 2-hour window any time the row was touched
 * recently. The /assign endpoint is the worst case: it's a one-shot POST at
 * creation, so a transient 404 during propagation becomes permanent 'broken'
 * unless we clean up.
 *
 * Matches the endpoint and any sub-resource (e.g. `.../assign`). Safe to run
 * even when there's nothing to delete.
 */
async function pruneApiHealthForPolicy(tenantDbId, policyType, policyId) {
  if (!tenantDbId || !policyId) return 0;
  const pType = getPolicyType(policyType);
  if (!pType) return 0;
  const prefix = pType.policyEndpoint(policyId);
  try {
    const result = await db.execute(
      `DELETE FROM api_health
        WHERE tenant_id = ?
          AND endpoint LIKE ?`,
      [tenantDbId, prefix + '%']
    );
    const affected = result?.affectedRows ?? result?.[0]?.affectedRows ?? 0;
    if (affected > 0) {
      console.log(`[Intune:Remove] Pruned ${affected} stale api_health row(s) for policy ${policyId}`);
    }
    return affected;
  } catch (err) {
    // Never let health-cleanup failure block deployment removal.
    console.warn(`[Intune:Remove] pruneApiHealthForPolicy failed (non-fatal): ${err.message}`);
    return 0;
  }
}

// ═══════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════

/**
 * Deep compare two values (handles nested objects, arrays, primitives).
 * For arrays of objects, compares by settingDefinitionId if present (Intune settings).
 */
function deepEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a == b;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    // For settings arrays, sort by settingDefinitionId for stable comparison
    const sortKey = (item) => {
      if (typeof item === 'object' && item !== null) {
        return item.settingDefinitionId || item.settingInstance?.settingDefinitionId || JSON.stringify(item);
      }
      return String(item);
    };
    const sortedA = [...a].sort((x, y) => sortKey(x) < sortKey(y) ? -1 : 1);
    const sortedB = [...b].sort((x, y) => sortKey(x) < sortKey(y) ? -1 : 1);
    return sortedA.every((val, i) => deepEqual(val, sortedB[i]));
  }
  if (typeof a === 'object') {
    const keysA = Object.keys(a).sort();
    const keysB = Object.keys(b).sort();
    if (keysA.length !== keysB.length) return false;
    return keysA.every((key, i) => keysB[i] === key && deepEqual(a[key], b[key]));
  }
  return false;
}

/**
 * Merge two settings arrays: template settings overlay onto live settings.
 * - Settings that exist in both (matched by settingDefinitionId) → template wins
 * - Settings that exist only in live (tenant-specific) → preserved
 * - Settings that exist only in template → added
 */
function mergeSettingsArrays(liveSettings, templateSettings) {
  // Build a map of template settings by their settingDefinitionId
  const templateMap = new Map();
  for (const ts of templateSettings) {
    const defId = ts.settingInstance?.settingDefinitionId;
    if (defId) templateMap.set(defId, ts);
  }

  // Start with all live settings, replacing those that exist in the template
  const merged = [];
  const usedTemplateIds = new Set();

  for (const ls of liveSettings) {
    const defId = ls.settingInstance?.settingDefinitionId;
    if (defId && templateMap.has(defId)) {
      // Template has this setting — use the template version
      merged.push(templateMap.get(defId));
      usedTemplateIds.add(defId);
    } else {
      // Live-only setting (tenant-specific exception, etc.) — preserve it
      merged.push(ls);
    }
  }

  // Add any template settings that don't exist in live yet
  for (const [defId, ts] of templateMap) {
    if (!usedTemplateIds.has(defId)) {
      merged.push(ts);
    }
  }

  return merged;
}

/**
 * Recursively strip tenant-specific IDs from settings catalog setting instances.
 */
function stripSettingIds(setting) {
  const clean = { ...setting };
  delete clean.id;
  // NOTE: keep 'settingInstance@odata.type' — Graph requires it when creating policies
  if (clean.settingInstance) {
    clean.settingInstance = { ...clean.settingInstance };
    delete clean.settingInstance.id;
    if (Array.isArray(clean.settingInstance.children)) {
      clean.settingInstance.children = clean.settingInstance.children.map(c => stripSettingIds({ settingInstance: c }).settingInstance);
    }
    if (Array.isArray(clean.settingInstance.choiceSettingValue?.children)) {
      clean.settingInstance.choiceSettingValue.children =
        clean.settingInstance.choiceSettingValue.children.map(c => stripSettingIds({ settingInstance: c }).settingInstance);
    }
    if (Array.isArray(clean.settingInstance.choiceSettingCollectionValue)) {
      clean.settingInstance.choiceSettingCollectionValue =
        clean.settingInstance.choiceSettingCollectionValue.map(v => {
          const cv = { ...v };
          if (Array.isArray(cv.children)) {
            cv.children = cv.children.map(c => stripSettingIds({ settingInstance: c }).settingInstance);
          }
          return cv;
        });
    }
    if (Array.isArray(clean.settingInstance.groupSettingCollectionValue)) {
      clean.settingInstance.groupSettingCollectionValue =
        clean.settingInstance.groupSettingCollectionValue.map(g => {
          const gv = { ...g };
          if (Array.isArray(gv.children)) {
            gv.children = gv.children.map(c => stripSettingIds({ settingInstance: c }).settingInstance);
          }
          return gv;
        });
    }
  }
  return clean;
}

// ═══════════════════════════════════════════
// EXPORT — Pull all policies from a tenant
// ═══════════════════════════════════════════

// Pull every Intune policy from a tenant, live from Graph. Extracted into a
// plain function so it can be reused server-side by the Quick Assessment
// report (see src/routes/api-reports.js) — not only by the route below.
// `tenant` must carry { tenant_id (Azure GUID), display_name }.
async function exportTenantIntunePolicies(tenant, opts = {}) {
  // opts.includeSettings=false skips the per-policy settings / definitions /
  // intent fetches — a large speed-up when only the policy inventory is
  // needed (the Quick Assessment report). Defaults to a full export so the
  // GET /export route behaviour is unchanged.
  const includeSettings = opts.includeSettings !== false;
  const azureTenantId = tenant.tenant_id;
  const results = [];
  const errors = [];

  for (const pType of POLICY_TYPES) {
    try {
      console.log(`[Intune:Export] Fetching ${pType.label} from ${tenant.display_name}...`);
      const policies = await graph.callGraphPaged(azureTenantId, pType.listEndpoint, {
        version: pType.version,
        maxPages: 20,
      });

      for (const policy of policies) {
        const item = {
          policyType: pType.key,
          name: pType.extractName(policy),
          description: pType.extractDesc(policy),
          category: pType.extractCategory(policy),
          templateFamily: policy.templateReference?.templateFamily || null,
          policy: pType.stripForTemplate(policy),
        };

        if (includeSettings && pType.key === 'configurationPolicies' && pType.settingsEndpoint) {
          try {
            const settingsData = await graph.callGraphPaged(
              azureTenantId, pType.settingsEndpoint(policy.id),
              { version: 'beta', maxPages: 5 }
            );
            item.settings = settingsData.map(s => stripSettingIds(s));
          } catch (sErr) {
            console.warn(`[Intune:Export] Failed to fetch settings for ${item.name}: ${sErr.message}`);
            item.settings = [];
          }
        }

        if (includeSettings && pType.key === 'groupPolicyConfigurations' && pType.definitionsEndpoint) {
          try {
            const defValues = await graph.callGraphPaged(
              azureTenantId, pType.definitionsEndpoint(policy.id),
              { version: 'beta', maxPages: 5 }
            );
            item.definitionValues = defValues;
          } catch (dErr) {
            console.warn(`[Intune:Export] Failed to fetch definitions for ${item.name}: ${dErr.message}`);
            item.definitionValues = [];
          }
        }

        if (includeSettings && pType.key === 'intents' && pType.settingsEndpoint) {
          try {
            const intentSettings = await graph.callGraphPaged(
              azureTenantId, pType.settingsEndpoint(policy.id),
              { version: 'beta', maxPages: 5 }
            );
            item.settings = intentSettings;
          } catch (sErr) {
            console.warn(`[Intune:Export] Failed to fetch intent settings for ${item.name}: ${sErr.message}`);
            item.settings = [];
          }
        }

        results.push(item);
      }

      console.log(`[Intune:Export] ${pType.label}: ${policies.length} policies`);
    } catch (err) {
      const msg = `${pType.label}: ${err.message}`;
      console.warn(`[Intune:Export] ${msg}`);
      errors.push(msg);
    }
  }

  return {
    tenant: tenant.display_name,
    exportedAt: new Date().toISOString(),
    totalPolicies: results.length,
    errors: errors.length > 0 ? errors : undefined,
    policies: results,
  };
}

router.get('/export/:tenantId', async (req, res) => {
  try {
    const tenantDbId = parseInt(req.params.tenantId, 10);
    const tenant = await db.queryOne('SELECT id, tenant_id, display_name FROM tenants WHERE id = ?', [tenantDbId]);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    res.json(await exportTenantIntunePolicies(tenant));
  } catch (err) {
    console.error('[Intune:Export] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════
// TEMPLATES — CRUD
// ═══════════════════════════════════════════

router.get('/templates', async (req, res) => {
  try {
    const templates = await db.queryRows(
      `SELECT id, name, description, category, policy_type, platform,
              template_family, source_tenant, tags, assignment_target, alert_routing, created_at, updated_at
       FROM intune_templates
       ORDER BY category, name`
    );
    res.json(templates);
  } catch (err) {
    console.error('[Intune:Templates] List error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/templates/:id', async (req, res) => {
  try {
    const template = await db.queryOne(
      'SELECT * FROM intune_templates WHERE id = ?',
      [parseInt(req.params.id, 10)]
    );
    if (!template) return res.status(404).json({ error: 'Template not found' });
    try { template.policy_json = JSON.parse(template.policy_json); } catch (e) { /* leave as string */ }
    res.json(template);
  } catch (err) {
    console.error('[Intune:Templates] Get error:', err);
    res.status(500).json({ error: err.message });
  }
});

// A3 (May 9, 2026): admin — template CREATE.
router.post('/templates', auth.requireAdmin, async (req, res) => {
  try {
    const { name, description, category, policy_type, platform, template_family, policy_json, source_tenant, tags, assignment_target, alert_routing } = req.body;
    if (!name || !policy_json) return res.status(400).json({ error: 'name and policy_json are required' });

    const jsonStr = typeof policy_json === 'string' ? policy_json : JSON.stringify(policy_json);
    const validTargets = ['none', 'all_users', 'all_devices'];
    const assignTarget = validTargets.includes(assignment_target) ? assignment_target : 'none';
    const validRouting = ['support', 'personal', 'both', 'none'];
    const routing = validRouting.includes(alert_routing) ? alert_routing : 'both';
    const id = await db.insert(
      `INSERT INTO intune_templates (name, description, category, policy_type, platform, template_family, policy_json, source_tenant, tags, assignment_target, alert_routing)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, description || null, category || 'other', policy_type || 'configurationPolicies',
       platform || 'windows10', template_family || null, jsonStr, source_tenant || null, tags || null, assignTarget, routing]
    );
    mspAudit.logMspAudit({
      category: mspAudit.CATEGORY.TEMPLATE_CRUD,
      action: 'intune_template.create',
      description: `Created Intune template "${name}" (id=${id}, ${policy_type || 'configurationPolicies'})`,
      templateKey: 'intune_template.create',
      templateParams: { name, policyType: policy_type || 'configurationPolicies' },
      targetType: 'intune_template',
      targetId: String(id),
      targetName: name,
      metadata: {
        policy_type: policy_type || 'configurationPolicies',
        platform: platform || 'windows10',
        template_family: template_family || null,
        assignment_target: assignTarget,
        alert_routing: routing,
        source_tenant: source_tenant || null,
      },
      req,
    }).catch(() => {});
    res.json({ id, name, message: 'Template imported successfully' });
  } catch (err) {
    console.error('[Intune:Templates] Import error:', err);
    res.status(500).json({ error: err.message });
  }
});

// A3 (May 9, 2026): admin — template BULK CREATE.
router.post('/templates/bulk', auth.requireAdmin, async (req, res) => {
  try {
    const { templates } = req.body;
    if (!Array.isArray(templates) || templates.length === 0)
      return res.status(400).json({ error: 'templates array is required' });

    const imported = [];
    const errors = [];

    for (const t of templates) {
      try {
        if (!t.name || !t.policy_json) { errors.push({ name: t.name || 'unknown', error: 'Missing name or policy_json' }); continue; }
        const jsonStr = typeof t.policy_json === 'string' ? t.policy_json : JSON.stringify(t.policy_json);
        const validTargets = ['none', 'all_users', 'all_devices'];
        const assignTarget = validTargets.includes(t.assignment_target) ? t.assignment_target : 'none';
        const validRouting = ['support', 'personal', 'both', 'none'];
        const routing = validRouting.includes(t.alert_routing) ? t.alert_routing : 'both';
        const id = await db.insert(
          `INSERT INTO intune_templates (name, description, category, policy_type, platform, template_family, policy_json, source_tenant, tags, assignment_target, alert_routing)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [t.name, t.description || null, t.category || 'other', t.policy_type || 'configurationPolicies',
           t.platform || 'windows10', t.template_family || null, jsonStr, t.source_tenant || null, t.tags || null, assignTarget, routing]
        );
        imported.push({ id, name: t.name });
      } catch (tErr) {
        errors.push({ name: t.name || 'unknown', error: tErr.message });
      }
    }

    res.json({ imported: imported.length, failed: errors.length, templates: imported, errors: errors.length > 0 ? errors : undefined });
  } catch (err) {
    console.error('[Intune:Templates] Bulk import error:', err);
    res.status(500).json({ error: err.message });
  }
});

// A3 (May 9, 2026): admin — template EDIT.
router.put('/templates/:id', auth.requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { name, description, tags, policy_json, assignment_target, alert_routing } = req.body;
    const sets = [];
    const params = [];
    if (name !== undefined) { sets.push('name = ?'); params.push(name); }
    if (description !== undefined) { sets.push('description = ?'); params.push(description); }
    if (tags !== undefined) { sets.push('tags = ?'); params.push(tags); }
    if (assignment_target !== undefined) {
      const validTargets = ['none', 'all_users', 'all_devices'];
      if (validTargets.includes(assignment_target)) { sets.push('assignment_target = ?'); params.push(assignment_target); }
    }
    if (alert_routing !== undefined) {
      const validRouting = ['support', 'personal', 'both', 'none'];
      if (validRouting.includes(alert_routing)) { sets.push('alert_routing = ?'); params.push(alert_routing); }
    }
    if (policy_json !== undefined) {
      sets.push('policy_json = ?');
      params.push(typeof policy_json === 'string' ? policy_json : JSON.stringify(policy_json));
    }
    if (sets.length === 0) return res.status(400).json({ error: 'Nothing to update' });
    // Snapshot before-state for audit diff
    const before = await db.queryOne('SELECT id, name, description, tags, assignment_target, alert_routing FROM intune_templates WHERE id = ?', [id]);
    if (!before) return res.status(404).json({ error: 'Template not found' });

    params.push(id);
    const affected = await db.execute(`UPDATE intune_templates SET ${sets.join(', ')} WHERE id = ?`, params);
    if (affected === 0) return res.status(404).json({ error: 'Template not found' });

    const diff = {};
    if (name !== undefined && name !== before.name) diff.name = { from: before.name, to: name };
    if (description !== undefined && description !== before.description) diff.description = { changed: true };
    if (tags !== undefined && tags !== before.tags) diff.tags = { from: before.tags, to: tags };
    if (assignment_target !== undefined && assignment_target !== before.assignment_target) {
      diff.assignment_target = { from: before.assignment_target, to: assignment_target };
    }
    if (alert_routing !== undefined && alert_routing !== before.alert_routing) {
      diff.alert_routing = { from: before.alert_routing, to: alert_routing };
    }
    if (policy_json !== undefined) diff.policy_json = { changed: true };

    mspAudit.logMspAudit({
      category: mspAudit.CATEGORY.TEMPLATE_CRUD,
      action: 'intune_template.update',
      description: `Updated Intune template "${name !== undefined ? name : before.name}" (id=${id})`,
      templateKey: 'intune_template.update',
      templateParams: { name: name !== undefined ? name : before.name },
      targetType: 'intune_template',
      targetId: String(id),
      targetName: name !== undefined ? name : before.name,
      metadata: { diff },
      req,
    }).catch(() => {});
    res.json({ id, updated: true });
  } catch (err) {
    console.error('[Intune:Templates] Update error:', err);
    res.status(500).json({ error: err.message });
  }
});

// A3 (May 9, 2026): admin — template DELETE.
router.delete('/templates/:id', auth.requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const before = await db.queryOne('SELECT name, policy_type FROM intune_templates WHERE id = ?', [id]);
    const affected = await db.execute('DELETE FROM intune_templates WHERE id = ?', [id]);
    if (affected === 0) return res.status(404).json({ error: 'Template not found' });
    mspAudit.logMspAudit({
      category: mspAudit.CATEGORY.TEMPLATE_CRUD,
      action: 'intune_template.delete',
      description: `Deleted Intune template "${before?.name || '(unknown)'}" (id=${id})`,
      templateKey: 'intune_template.delete',
      templateParams: { name: before?.name || '(unknown)' },
      targetType: 'intune_template',
      targetId: String(id),
      targetName: before?.name || null,
      metadata: { policy_type: before?.policy_type || null },
      req,
    }).catch(() => {});
    res.json({ deleted: true });
  } catch (err) {
    console.error('[Intune:Templates] Delete error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════
// DEPLOY — Smart deploy with name-match
// ═══════════════════════════════════════════

/**
 * POST /api/intune/deploy
 * Body: { templateId, tenantId }
 *
 * Smart deploy:
 * 1. Search for existing policy by exact name match in the target tenant
 * 2. If found → compare settings, update if needed, link for monitoring
 * 3. If not found → create new policy, link for monitoring
 */
// A3 (May 9, 2026): operator — per-tenant deployment.
router.post('/deploy', auth.requireMemberOrAdmin, async (req, res) => {
  try {
    const { templateId, tenantId, assignment_target: reqAssignTarget } = req.body;
    if (!templateId || !tenantId)
      return res.status(400).json({ error: 'templateId and tenantId are required' });

    const template = await db.queryOne('SELECT * FROM intune_templates WHERE id = ?', [templateId]);
    if (!template) return res.status(404).json({ error: 'Template not found' });

    const tenant = await db.queryOne('SELECT id, tenant_id, display_name FROM tenants WHERE id = ?', [tenantId]);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    const policyData = JSON.parse(template.policy_json);
    const azureTenantId = tenant.tenant_id;
    const pType = getPolicyType(template.policy_type);
    if (!pType) return res.status(400).json({ error: `Unsupported policy type: ${template.policy_type}` });

    // Check for existing deployment record (any active status — pending, deployed, or failed)
    const existingDeployment = await db.queryOne(
      `SELECT id, deployed_policy_id FROM intune_deployments
       WHERE template_id = ? AND tenant_id = ? AND status != 'removed' LIMIT 1`,
      [templateId, tenantId]
    );

    // Step 1: Search for existing policy by name
    const templateName = policyData[pType.nameField] || template.name;
    let existingPolicyId = existingDeployment?.deployed_policy_id || null;
    let existingPolicy = null;
    let action = 'created'; // 'created', 'updated', 'linked'

    // If we have a stored policy ID, verify it still exists
    if (existingPolicyId) {
      try {
        existingPolicy = await graph.callGraph(azureTenantId, pType.policyEndpoint(existingPolicyId), {
          version: pType.version, silent: true,
        });
      } catch (e) {
        if (e.statusCode === 404) {
          existingPolicyId = null; // Policy was deleted, will search by name
          console.log(`[Intune:Deploy] Stored policy ID ${existingPolicyId} no longer exists, searching by name`);
        } else {
          throw e;
        }
      }
    }

    // If no stored policy, search by name
    if (!existingPolicyId) {
      try {
        const livePolicies = await graph.callGraphPaged(azureTenantId, pType.listEndpoint, {
          version: pType.version, maxPages: 20,
        });

        const match = livePolicies.find(p => {
          const liveName = pType.extractName(p);
          return liveName && liveName.toLowerCase() === templateName.toLowerCase();
        });

        if (match) {
          existingPolicyId = match.id;
          existingPolicy = match;
          console.log(`[Intune:Deploy] Found existing policy "${templateName}" (ID: ${existingPolicyId}) in ${tenant.display_name}`);
        }
      } catch (err) {
        console.warn(`[Intune:Deploy] Could not search for existing policy: ${err.message}`);
      }
    }

    // Create or update deployment record
    let deploymentId;
    if (existingDeployment) {
      deploymentId = existingDeployment.id;
      await db.execute(
        `UPDATE intune_deployments SET status = 'pending', error_message = NULL, deployed_by = ? WHERE id = ?`,
        [req.session.user?.email || 'unknown', deploymentId]
      );
    } else {
      deploymentId = await db.insert(
        `INSERT INTO intune_deployments (template_id, tenant_id, status, deployed_by)
         VALUES (?, ?, 'pending', ?)`,
        [templateId, tenantId, req.session.user?.email || 'unknown']
      );
    }

    try {
      let deployedPolicyId;

      if (existingPolicyId) {
        // ─── EXISTING POLICY FOUND — Update settings to match template ───
        deployedPolicyId = existingPolicyId;

        if (template.policy_type === 'configurationPolicies') {
          // Settings Catalog: Graph doesn't support PUT to /settings collection.
          // Strategy: delete existing policy and recreate with merged settings.
          // Assignments are re-applied automatically after creation (see below).
          const templateSettings = policyData.settings || [];
          if (templateSettings.length > 0) {
            // Fetch current live settings to merge (preserve tenant-specific extras)
            let currentSettings = [];
            try {
              currentSettings = await graph.callGraphPaged(
                azureTenantId, pType.settingsEndpoint(existingPolicyId),
                { version: 'beta', maxPages: 5 }
              );
              currentSettings = currentSettings.map(s => stripSettingIds(s));
            } catch (e) {
              console.warn(`[Intune:Deploy] Could not fetch current settings: ${e.message}`);
            }

            // Merge: template settings win, but live-only settings are preserved
            const mergedSettings = mergeSettingsArrays(currentSettings, templateSettings);

            if (!deepEqual(mergedSettings, currentSettings)) {
              const templateOnlyCount = templateSettings.length;
              const preservedCount = mergedSettings.length - templateOnlyCount;
              console.log(`[Intune:Deploy] Recreating "${templateName}" in ${tenant.display_name} — ${templateOnlyCount} from template, ${preservedCount >= 0 ? preservedCount : 0} tenant-specific preserved`);

              // Step 1: Delete the existing policy
              await graph.callGraph(azureTenantId, pType.policyEndpoint(existingPolicyId), {
                version: 'beta',
                method: 'DELETE',
              });
              console.log(`[Intune:Deploy] Deleted old policy ${existingPolicyId}`);

              // Step 2: Recreate with merged settings
              const recreateBody = {
                name: templateName,
                description: policyData.description || template.description || '',
                platforms: policyData.platforms,
                technologies: policyData.technologies,
                roleScopeTagIds: policyData.roleScopeTagIds || ['0'],
                settings: mergedSettings,
              };
              if (policyData.templateReference?.templateId) {
                recreateBody.templateReference = policyData.templateReference;
              }

              const recreateResult = await graph.callGraph(azureTenantId, '/deviceManagement/configurationPolicies', {
                version: 'beta',
                method: 'POST',
                body: recreateBody,
              });

              deployedPolicyId = recreateResult?.id || null;
              if (!deployedPolicyId) {
                throw new Error(`Recreate failed — Graph did not return a policy ID. Response: ${JSON.stringify(recreateResult).substring(0, 500)}`);
              }
              console.log(`[Intune:Deploy] Recreated as ${deployedPolicyId}`);
              action = 'updated';
            } else {
              console.log(`[Intune:Deploy] Settings already match for "${templateName}" — linking only`);
              action = 'linked';
            }
          } else {
            action = 'linked';
          }
        } else if (template.policy_type === 'deviceConfigurations' || template.policy_type === 'deviceCompliancePolicies') {
          // Legacy configs: PATCH the policy body
          const patchBody = { ...policyData };
          delete patchBody.id;
          delete patchBody.createdDateTime;
          delete patchBody.lastModifiedDateTime;
          delete patchBody.version;

          console.log(`[Intune:Deploy] Patching "${templateName}" in ${tenant.display_name}`);
          await graph.callGraph(azureTenantId, pType.policyEndpoint(existingPolicyId), {
            version: 'beta',
            method: 'PATCH',
            body: patchBody,
          });
          action = 'updated';
        } else {
          // Admin templates and intents — link only for now, no update
          action = 'linked';
        }
      } else {
        // ─── NO EXISTING POLICY — Create new ───
        let deployEndpoint, deployBody;

        switch (template.policy_type) {
          case 'configurationPolicies': {
            deployEndpoint = '/deviceManagement/configurationPolicies';
            deployBody = {
              name: templateName,
              description: policyData.description || template.description || '',
              platforms: policyData.platforms,
              technologies: policyData.technologies,
              roleScopeTagIds: policyData.roleScopeTagIds || ['0'],
              settings: policyData.settings || [],
            };
            // Only include templateReference if it has a real templateId
            // Empty templateId causes Graph "No OData route" errors
            if (policyData.templateReference?.templateId) {
              deployBody.templateReference = policyData.templateReference;
            }
            console.log(`[Intune:Deploy] configurationPolicies body keys: ${Object.keys(deployBody).join(', ')}, templateRef included: ${!!deployBody.templateReference}, settings count: ${(deployBody.settings || []).length}`);
            break;
          }
          case 'deviceConfigurations': {
            deployEndpoint = '/deviceManagement/deviceConfigurations';
            deployBody = { ...policyData };
            if (!deployBody.displayName) deployBody.displayName = templateName;
            break;
          }
          case 'deviceCompliancePolicies': {
            deployEndpoint = '/deviceManagement/deviceCompliancePolicies';
            deployBody = { ...policyData };
            if (!deployBody.displayName) deployBody.displayName = templateName;
            // Graph requires exactly one block scheduled action on compliance policies
            if (!deployBody.scheduledActionsForRule || deployBody.scheduledActionsForRule.length === 0) {
              deployBody.scheduledActionsForRule = [{
                ruleName: 'PasswordRequired',
                scheduledActionConfigurations: [{
                  actionType: 'block',
                  gracePeriodHours: 0,
                  notificationTemplateId: '',
                  notificationMessageCCList: [],
                }],
              }];
            }
            break;
          }
          case 'groupPolicyConfigurations': {
            deployEndpoint = '/deviceManagement/groupPolicyConfigurations';
            deployBody = {
              displayName: templateName,
              description: policyData.description || template.description || '',
            };
            break;
          }
          case 'intents': {
            // Intents (security baselines) are created by POSTing to the template
            // they derive from: /deviceManagement/templates/{templateId}/createInstance.
            // Fails silently in two known ways if not careful:
            //   1. Missing/empty templateId → endpoint becomes /templates//createInstance
            //      which Graph has been observed to accept and create a stub entity
            //      that is invisible in the admin portal. Refuse up-front instead.
            //   2. settingsDelta array contains setting objects with foreign IDs
            //      (from the export tenant) → Graph creates the entity but the
            //      settings don't hydrate into the new template context, so the
            //      admin portal filters it out as empty.
            if (!policyData.templateId) {
              throw new Error(`Intent template "${templateName}" has no stored templateId — cannot create intent instance. Re-export from a known-good tenant before deploying.`);
            }
            deployEndpoint = '/deviceManagement/templates/' + policyData.templateId + '/createInstance';
            // Strip id fields from settings — Graph setting GUIDs are scoped to
            // the tenant they came from and confuse createInstance on reimport.
            const cleanSettings = (policyData.settings || []).map(s => {
              const { id, ...rest } = s || {};
              return rest;
            });
            deployBody = {
              displayName: templateName,
              description: policyData.description || template.description || '',
              roleScopeTagIds: policyData.roleScopeTagIds || ['0'],
              settingsDelta: cleanSettings,
            };
            console.log(`[Intune:Deploy] intents createInstance → templateId=${policyData.templateId}, settingsDelta.length=${cleanSettings.length}, first setting keys: ${cleanSettings[0] ? Object.keys(cleanSettings[0]).join(',') : '(none)'}`);
            break;
          }
          default:
            throw new Error(`Unsupported policy type: ${template.policy_type}`);
        }

        console.log(`[Intune:Deploy] Creating "${templateName}" in ${tenant.display_name} → ${deployEndpoint}`);
        console.log(`[Intune:Deploy] Body preview: ${JSON.stringify(deployBody).substring(0, 1000)}`);
        const result = await graph.callGraph(azureTenantId, deployEndpoint, {
          version: 'beta',
          method: 'POST',
          body: deployBody,
        });

        deployedPolicyId = result?.id || null;
        if (!deployedPolicyId) {
          throw new Error(`Graph API did not return a policy ID. Response: ${JSON.stringify(result).substring(0, 500)}`);
        }
        action = 'created';
      }

      // Update deployment record
      await db.execute(
        `UPDATE intune_deployments SET status = 'deployed', deployed_policy_id = ?,
         drift_status = 'ok', deployed_at = NOW(), last_checked_at = NOW() WHERE id = ?`,
        [deployedPolicyId, deploymentId]
      );

      // ─── ASSIGNMENT — apply target (All Users / All Devices / None) ───
      // Resolve: request override > deployment record > template default
      const validTargets = ['none', 'all_users', 'all_devices'];
      const deploymentRecord = await db.queryOne('SELECT assignment_target FROM intune_deployments WHERE id = ?', [deploymentId]);
      const effectiveTarget = validTargets.includes(reqAssignTarget) ? reqAssignTarget
        : (deploymentRecord?.assignment_target || template.assignment_target || 'none');

      // Store the resolved assignment target on the deployment
      if (effectiveTarget !== 'none') {
        await db.execute('UPDATE intune_deployments SET assignment_target = ? WHERE id = ?', [effectiveTarget, deploymentId]);
      }

      // ─── ASSIGNMENT — capture outcome honestly ───
      // Graph's create returns a GUID before assignment is applied. postAssignment
      // is a separate POST that can fail (permissions, shape, propagation). If we
      // swallow that error, the audit trail and UI lie to the operator — they see
      // "assigned to All Devices" when no assignment actually landed.
      let assignmentStatus; // 'not_applicable' | 'success' | 'failed' | 'not_attempted'
      let assignmentError = null;
      if (effectiveTarget === 'none') {
        assignmentStatus = 'not_applicable';
      } else if (!deployedPolicyId) {
        assignmentStatus = 'not_attempted';
      } else {
        try {
          await postAssignment(azureTenantId, template.policy_type, deployedPolicyId, effectiveTarget);
          assignmentStatus = 'success';
          console.log(`[Intune:Deploy] Assignment (${effectiveTarget}) applied to "${templateName}" in ${tenant.display_name}`);
        } catch (assignErr) {
          assignmentStatus = 'failed';
          assignmentError = `${assignErr?.statusCode || 'ERR'}: ${assignErr.message}`;
          console.error(`[Intune:Deploy] Assignment failed for "${templateName}": ${assignmentError}`);
        }
      }

      // ─── VERIFICATION — prove the policy actually exists in the tenant ───
      // Action=='linked' with no tenant mutation doesn't need verification;
      // we already read the policy to decide it was a link.
      let verification = { ok: true, error: null };
      if ((action === 'created' || action === 'updated') && deployedPolicyId) {
        verification = await verifyDeployedPolicy(azureTenantId, template.policy_type, deployedPolicyId);
        if (!verification.ok) {
          console.error(`[Intune:Deploy] Post-create verification FAILED for "${templateName}" (${deployedPolicyId}): ${verification.error}`);
        }
      }

      // Persist deploy outcome fields so the UI and later drift runs can see reality.
      await db.execute(
        `UPDATE intune_deployments
            SET assignment_status = ?, assignment_error = ?,
                verified_at = ?, verification_error = ?
          WHERE id = ?`,
        [
          assignmentStatus,
          assignmentError,
          verification.ok ? new Date() : null,
          verification.ok ? null : verification.error,
          deploymentId,
        ]
      );

      // If verification failed, the deployment did not land. Mark it failed so
      // the tenant dashboard status light matches reality; do not audit as a
      // successful mutation.
      if (!verification.ok) {
        await db.execute(
          `UPDATE intune_deployments SET status = 'failed', error_message = ? WHERE id = ?`,
          [`Post-create verification failed: ${verification.error}`, deploymentId]
        );
      }

      // Build the honest label + suffix. We tell the truth about what happened:
      // the operator needs to know if assignment failed or the policy couldn't
      // be verified — that's the whole point of an audit trail.
      const assignLabel = { none: '', all_users: ' → assigned to All Users', all_devices: ' → assigned to All Devices' };
      const assignSuffix = assignmentStatus === 'success' ? (assignLabel[effectiveTarget] || '') : '';
      const warnings = [];
      if (assignmentStatus === 'failed') {
        warnings.push(`Assignment to ${effectiveTarget} FAILED: ${assignmentError}`);
      }
      if (!verification.ok) {
        warnings.push(`Post-create verification FAILED: ${verification.error}`);
      }
      const warningTail = warnings.length ? ` — ${warnings.join('; ')}` : '';

      const actionMessages = {
        created: `Policy "${templateName}" created in ${tenant.display_name}${assignSuffix}${warningTail}`,
        updated: `Policy "${templateName}" updated in ${tenant.display_name}${assignSuffix}${warningTail}`,
        linked: `Policy "${templateName}" already matches template — linked for monitoring in ${tenant.display_name}${assignSuffix}${warningTail}`,
      };

      console.log(`[Intune:Deploy] Outcome (${action}): "${templateName}" → ${tenant.display_name} (ID: ${deployedPolicyId}) assign=${assignmentStatus} verified=${verification.ok}`);

      // ─── AUDIT ───
      // Log every non-trivial attempt. Even a failed create+assign belongs in
      // the change log because the operator initiated a tenant-mutating action;
      // omitting it would hide operator intent from the audit trail.
      // action='linked' with no successful assignment = pure bookkeeping, skip.
      const didMutateTenant =
        action === 'created' ||
        action === 'updated' ||
        (action === 'linked' && assignmentStatus === 'success');

      if (didMutateTenant) {
        const actionVerb = action === 'created' ? 'Created'
          : action === 'updated' ? 'Updated'
          : 'Assigned';
        let description = `${actionVerb} Intune policy "${templateName}" (${template.policy_type})${assignSuffix}`;
        if (warnings.length) {
          description += ` — ${warnings.join('; ')}`;
        }
        await changeLog.logPanopticaChange({
          tenantId: tenant.id,
          category: changeLog.CATEGORY.INTUNE_POLICY_PUSH,
          surfaces: [changeLog.SURFACE.INTUNE],
          description,
          templateKey: action === 'updated' ? 'intune_push.update' : 'intune_push.create',
          templateParams: { policyName: templateName, policyType: template.policy_type, assignmentTarget: assignSuffix.replace(/^[^A-Za-z]+/, '') || 'none' },
          createdBy: req.session.user?.email || 'unknown',
          ...changeLog.captureActorContext(req),
        });
      }

      // Partial-success (policy created but assignment failed, or verification
      // failed) surfaces to the UI as a 207 Multi-Status with warnings so the
      // tenant dashboard can render an amber state instead of green.
      const httpStatus =
        !verification.ok ? 502 :
        assignmentStatus === 'failed' ? 207 :
        200;

      res.status(httpStatus).json({
        success: verification.ok && assignmentStatus !== 'failed',
        deploymentId,
        deployedPolicyId,
        action,
        assignment_target: effectiveTarget,
        assignment_status: assignmentStatus,
        assignment_error: assignmentError,
        verified: verification.ok,
        verification_error: verification.ok ? null : verification.error,
        warnings,
        message: actionMessages[action],
      });

    } catch (deployErr) {
      console.error(`[Intune:Deploy] Failed: ${deployErr.message}`);
      await db.execute(
        `UPDATE intune_deployments SET status = 'failed', error_message = ? WHERE id = ?`,
        [deployErr.message, deploymentId]
      );
      res.status(502).json({ success: false, deploymentId, error: deployErr.message });
    }

  } catch (err) {
    console.error('[Intune:Deploy] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════
// DRIFT DETECTION
// ═══════════════════════════════════════════

/**
 * Check drift for a single deployment.
 * Compares live policy settings against the template.
 * Returns { drift_status, drifts, deployment_id }
 */
async function checkIntuneDrift(deployment) {
  const template = await db.queryOne('SELECT * FROM intune_templates WHERE id = ?', [deployment.template_id]);
  if (!template) {
    console.warn(`[Intune:Drift] Template ${deployment.template_id} not found for deployment ${deployment.id}`);
    return { drift_status: 'missing', drifts: [], deployment_id: deployment.id };
  }

  const policyData = JSON.parse(template.policy_json);
  const pType = getPolicyType(template.policy_type);
  if (!pType) return { drift_status: 'unchecked', drifts: [], deployment_id: deployment.id };

  const azureTenantId = deployment.azure_tenant_id;
  const policyId = deployment.deployed_policy_id;

  // Verify the policy still exists
  let livePolicy;
  try {
    livePolicy = await graph.callGraph(azureTenantId, pType.policyEndpoint(policyId), {
      version: pType.version, silent: true,
    });
  } catch (err) {
    if (err.statusCode === 404) {
      await db.execute(
        `UPDATE intune_deployments SET drift_status = 'missing', drift_details = ?,
         last_checked_at = NOW() WHERE id = ?`,
        [JSON.stringify({ reason: 'Policy was deleted from tenant' }), deployment.id]
      );
      // Create alert for missing policy
      await createIntuneDriftAlert(deployment, template, [{ field: 'policy', reason: 'Policy deleted from tenant' }]);
      return { drift_status: 'missing', drifts: [{ field: 'policy', reason: 'deleted' }], deployment_id: deployment.id };
    }
    throw err;
  }

  const drifts = [];

  // For Settings Catalog — compare the settings array via structured descent
  if (template.policy_type === 'configurationPolicies' && pType.settingsEndpoint) {
    const templateSettings = policyData.settings || [];
    if (templateSettings.length > 0) {
      try {
        let liveSettings = await graph.callGraphPaged(
          azureTenantId, pType.settingsEndpoint(policyId),
          { version: 'beta', maxPages: 5 }
        );
        liveSettings = liveSettings.map(s => stripSettingIds(s));

        // Phase 9b: walk both trees and produce leaf-level diffs with breadcrumb paths
        const structuredDrifts = diffSettingsCatalog(templateSettings, liveSettings);
        drifts.push(...structuredDrifts);
      } catch (sErr) {
        console.warn(`[Intune:Drift] Failed to fetch live settings for ${template.name}: ${sErr.message}`);
      }
    }
  }

  // For legacy device configs / compliance — compare top-level properties
  if (template.policy_type === 'deviceConfigurations' || template.policy_type === 'deviceCompliancePolicies') {
    const skipKeys = new Set(['id', 'createdDateTime', 'lastModifiedDateTime', 'version',
      'supportsScopeTags', 'assignments', 'deviceStatuses', 'userStatuses',
      'deviceStatusOverview', 'userStatusOverview', 'deviceSettingStateSummaries',
      'scheduledActionsForRule', 'deviceManagementApplicabilityRuleDeviceMode',
      'deviceManagementApplicabilityRuleOsEdition', 'deviceManagementApplicabilityRuleOsVersion']);

    for (const [key, expectedVal] of Object.entries(policyData)) {
      if (skipKeys.has(key)) continue;
      if (key.startsWith('@')) continue;
      const actualVal = livePolicy[key];
      if (!deepEqual(expectedVal, actualVal)) {
        drifts.push({
          field: key,
          expected: typeof expectedVal === 'object' ? JSON.stringify(expectedVal) : expectedVal,
          actual: typeof actualVal === 'object' ? JSON.stringify(actualVal) : actualVal,
        });
      }
    }
  }

  // Phase 9: three-state transition with acknowledged-drift hash
  //
  //   no drifts                                  → 'ok'        (auto-clear acknowledged state)
  //   drifts AND hash matches acknowledged       → 'accepted'  (no alert)
  //   drifts AND hash does NOT match (or null)   → 'drifted'   (fire alert; preserve old hash so
  //                                                              a later revert to the previously-
  //                                                              accepted state returns to 'accepted')
  let driftStatus;
  const currentHash = computeDriftHash(drifts);

  if (drifts.length === 0) {
    driftStatus = 'ok';
    // Was this deployment in the 'accepted' state before we cleared it?
    // If so, the tenant config was restored to template and the outstanding
    // exemption is no longer needed — capture that as an auto-revoke in the
    // audit trail. (A silent state transition from accepted → ok would otherwise
    // leave the operator with no record of when the exception was extinguished.)
    const wasAcceptedDrift = !!deployment.acknowledged_drift_hash;
    const priorAcceptedBy = deployment.acknowledged_by || null;
    await db.execute(
      `UPDATE intune_deployments
          SET drift_status = 'ok',
              drift_details = NULL,
              last_checked_at = NOW(),
              acknowledged_drift_hash = NULL,
              acknowledged_drift_payload = NULL,
              acknowledged_at = NULL,
              acknowledged_by = NULL,
              acknowledged_expires_at = NULL,
              acknowledged_reason = NULL
        WHERE id = ?`,
      [deployment.id]
    );
    if (wasAcceptedDrift) {
      console.log(`[Intune:Drift] Deployment ${deployment.id} ("${template.name}") transitioned accepted→ok; auto-revoking drift acceptance (original acceptor: ${priorAcceptedBy || 'unknown'}).`);
      try {
        await changeLog.logPanopticaChange({
          tenantId: deployment.tenant_id,
          category: changeLog.CATEGORY.EXEMPTION_REVOKE,
          surfaces: [changeLog.SURFACE.INTUNE],
          description: `Auto-revoked accepted Intune drift on "${template.name}" — tenant configuration now matches template${priorAcceptedBy ? ` (originally accepted by ${priorAcceptedBy})` : ''}`,
          templateKey: 'exemption.revoke',
          templateParams: { settingName: template.name },
          createdBy: 'panoptica-system',
        });
      } catch (logErr) {
        console.warn(`[Intune:Drift] Audit log for auto-revoke failed (non-fatal): ${logErr.message}`);
      }
    }
  } else if (deployment.acknowledged_drift_hash && currentHash === deployment.acknowledged_drift_hash) {
    driftStatus = 'accepted';
    await db.execute(
      `UPDATE intune_deployments
          SET drift_status = 'accepted',
              drift_details = ?,
              last_checked_at = NOW()
        WHERE id = ?`,
      [JSON.stringify(drifts), deployment.id]
    );
  } else {
    driftStatus = 'drifted';
    await db.execute(
      `UPDATE intune_deployments
          SET drift_status = 'drifted',
              drift_details = ?,
              last_checked_at = NOW()
        WHERE id = ?`,
      [JSON.stringify(drifts), deployment.id]
    );
    // Fire alert only on real drift, never on accepted state
    await createIntuneDriftAlert(deployment, template, drifts);
  }

  return { drift_status: driftStatus, drifts, deployment_id: deployment.id };
}

/**
 * Compute a stable SHA-256 hash of a drift array.
 *
 * Two invariants are required for stability:
 *   1. Array order: drifts are sorted by `field` so comparator iteration order is irrelevant.
 *   2. Key order:   `canonicalJsonStringify` sorts object keys before serialization so the
 *      hash is identical regardless of whether the drift objects were freshly constructed
 *      in JavaScript (creation-order keys) or round-tripped through a MySQL JSON column
 *      (alphabetical keys).  Without this, the accept endpoint stores one hash and the
 *      poll computes a different one — the acceptance never sticks.
 */
function computeDriftHash(drifts) {
  if (!Array.isArray(drifts) || drifts.length === 0) return null;
  const sorted = [...drifts].sort((a, b) => String(a.field || '').localeCompare(String(b.field || '')));
  return crypto.createHash('sha256').update(canonicalJsonStringify(sorted)).digest('hex');
}

/**
 * JSON.stringify with deterministic key ordering.  Every plain object is emitted
 * with keys in lexicographic order so the output is independent of JavaScript
 * insertion order or MySQL JSON normalization.
 */
function canonicalJsonStringify(obj) {
  return JSON.stringify(obj, (_key, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const sorted = {};
      for (const k of Object.keys(value).sort()) sorted[k] = value[k];
      return sorted;
    }
    return value;
  });
}

// ─── Phase 9b: structured drift descent ───
//
// Walks an Intune Settings Catalog setting tree and produces leaf-level diff
// entries instead of a single useless top-level "1 group(s) → 1 group(s)" line.
//
// Each drift entry has the shape:
//   {
//     field:    canonical settingDefinitionId (or path if anonymous) — used by hash
//     path:     human-readable breadcrumb ("AsrRules > BlockExecutableContent")
//     change:   "modified" | "added" | "removed"
//     expected: friendly value from the template (or undefined for "added")
//     actual:   friendly value from the live tenant (or undefined for "removed")
//     added?:   (collection diffs only) values present in live but not template
//     removed?: (collection diffs only) values present in template but not live
//   }

const SETTING_ID_PREFIX_NOISE = new Set(['device','vendor','msft','policy','config']);

function friendlyName(defId) {
  if (!defId) return '?';
  const parts = String(defId).split('_');
  let i = 0;
  while (i < parts.length && SETTING_ID_PREFIX_NOISE.has(parts[i])) i++;
  const tail = parts.slice(i);
  if (tail.length === 0) return defId;
  // Take the last 2 segments — usually enough to disambiguate
  // (e.g. "defender_attacksurfacereductionrules_asronlyexclusions" → "Defender / Attacksurfacereductionrules")
  const lastTwo = tail.slice(-2).map(p => p.charAt(0).toUpperCase() + p.slice(1));
  return lastTwo.join(' / ');
}

/**
 * Like friendlyName, but for child settings: strips the parent's defId prefix so
 * we don't repeat segments already shown in the parent's breadcrumb. Returns the
 * trailing segment(s) only.
 */
function friendlyChildName(childDefId, parentDefId) {
  if (!childDefId) return '?';
  if (!parentDefId) return friendlyName(childDefId);
  const c = String(childDefId);
  const p = String(parentDefId);
  if (c.startsWith(p + '_')) {
    const remainder = c.slice(p.length + 1);
    if (!remainder) return friendlyName(childDefId);
    // CamelCase the remainder (it's typically a single token like "asronlyexclusions")
    const segs = remainder.split('_').map(s => s.charAt(0).toUpperCase() + s.slice(1));
    return segs.join(' / ');
  }
  return friendlyName(childDefId);
}

function friendlyChoiceValue(val, defId) {
  if (val === undefined || val === null) return '(unset)';
  const s = String(val);
  // Strip the parent defId prefix if it shows up (turns long enum into short suffix)
  if (defId && s.startsWith(defId + '_')) return s.slice(defId.length + 1);
  // Or just take the last segment (usually 0/1/2 or short token)
  const parts = s.split('_');
  return parts[parts.length - 1] || s;
}

function truncateValue(v, max = 80) {
  if (v === null || v === undefined) return '(unset)';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/**
 * Compare two arrays of top-level Intune setting wrappers ({settingInstance}).
 * Returns an array of structured drift entries.
 */
function diffSettingsCatalog(templateSettings, liveSettings) {
  const drifts = [];
  const tMap = new Map();
  const lMap = new Map();
  for (const t of templateSettings || []) {
    const id = t?.settingInstance?.settingDefinitionId;
    if (id) tMap.set(id, t);
  }
  for (const l of liveSettings || []) {
    const id = l?.settingInstance?.settingDefinitionId;
    if (id) lMap.set(id, l);
  }

  // Settings present in template
  for (const [defId, tWrap] of tMap) {
    const lWrap = lMap.get(defId);
    if (!lWrap) {
      drifts.push({
        field: defId,
        path: friendlyName(defId),
        change: 'removed',
        expected: 'present',
        actual: 'missing',
      });
      continue;
    }
    diffSettingInstance(tWrap.settingInstance, lWrap.settingInstance, [friendlyName(defId)], drifts);
  }

  // Settings present in live but NOT in template (admin added something we don't manage)
  for (const [defId] of lMap) {
    if (!tMap.has(defId)) {
      drifts.push({
        field: defId,
        path: friendlyName(defId),
        change: 'added',
        expected: 'absent',
        actual: 'present',
      });
    }
  }

  return drifts;
}

/**
 * Recursively diff two settingInstance nodes. pushes leaf-level entries onto `drifts`.
 */
function diffSettingInstance(t, l, pathParts, drifts) {
  if (!t && !l) return;
  // If one side is missing entirely, that's already been reported by the caller
  if (!t || !l) return;

  // ─ choice (single)
  if (t.choiceSettingValue !== undefined || l.choiceSettingValue !== undefined) {
    const tv = t.choiceSettingValue?.value;
    const lv = l.choiceSettingValue?.value;
    if (tv !== lv) {
      drifts.push({
        field: t.settingDefinitionId || l.settingDefinitionId || pathParts.join(' > '),
        path: pathParts.join(' > '),
        change: 'modified',
        expected: friendlyChoiceValue(tv, t.settingDefinitionId),
        actual: friendlyChoiceValue(lv, l.settingDefinitionId),
      });
    }
    // Recurse into choice children (settings nested under a choice)
    diffChildArrays(
      t.choiceSettingValue?.children || [],
      l.choiceSettingValue?.children || [],
      pathParts,
      t.settingDefinitionId || l.settingDefinitionId,
      drifts
    );
    return;
  }

  // ─ simple value
  if (t.simpleSettingValue !== undefined || l.simpleSettingValue !== undefined) {
    const tv = t.simpleSettingValue?.value;
    const lv = l.simpleSettingValue?.value;
    if (!shallowEqual(tv, lv)) {
      drifts.push({
        field: t.settingDefinitionId || l.settingDefinitionId || pathParts.join(' > '),
        path: pathParts.join(' > '),
        change: 'modified',
        expected: truncateValue(tv),
        actual: truncateValue(lv),
      });
    }
    return;
  }

  // ─ simple collection (array of {value, @odata.type})
  if (t.simpleSettingCollectionValue !== undefined || l.simpleSettingCollectionValue !== undefined) {
    const tArr = (t.simpleSettingCollectionValue || []).map(v => v?.value);
    const lArr = (l.simpleSettingCollectionValue || []).map(v => v?.value);
    diffStringArrays(tArr, lArr, pathParts, t.settingDefinitionId || l.settingDefinitionId, drifts);
    return;
  }

  // ─ choice collection
  if (t.choiceSettingCollectionValue !== undefined || l.choiceSettingCollectionValue !== undefined) {
    const tArr = (t.choiceSettingCollectionValue || []).map(v => v?.value);
    const lArr = (l.choiceSettingCollectionValue || []).map(v => v?.value);
    diffStringArrays(tArr, lArr, pathParts, t.settingDefinitionId || l.settingDefinitionId, drifts);
    return;
  }

  // ─ group collection (each entry has its own children settingInstances)
  if (t.groupSettingCollectionValue !== undefined || l.groupSettingCollectionValue !== undefined) {
    const tGroups = t.groupSettingCollectionValue || [];
    const lGroups = l.groupSettingCollectionValue || [];
    const max = Math.max(tGroups.length, lGroups.length);
    for (let i = 0; i < max; i++) {
      const tg = tGroups[i];
      const lg = lGroups[i];
      const subPath = max > 1 ? [...pathParts, `[#${i + 1}]`] : pathParts;
      if (!lg) {
        drifts.push({
          field: (t.settingDefinitionId || pathParts.join(' > ')) + `#${i}`,
          path: subPath.join(' > '),
          change: 'removed',
          expected: 'group present',
          actual: 'missing',
        });
        continue;
      }
      if (!tg) {
        drifts.push({
          field: (l.settingDefinitionId || pathParts.join(' > ')) + `#${i}`,
          path: subPath.join(' > '),
          change: 'added',
          expected: 'absent',
          actual: 'group present',
        });
        continue;
      }
      diffChildArrays(tg.children || [], lg.children || [], subPath, t.settingDefinitionId || l.settingDefinitionId, drifts);
    }
    return;
  }

  // ─ unknown shape — fall back to deep equality with a generic entry
  if (!deepEqual(t, l)) {
    drifts.push({
      field: t.settingDefinitionId || l.settingDefinitionId || pathParts.join(' > '),
      path: pathParts.join(' > '),
      change: 'modified',
      expected: truncateValue(t),
      actual: truncateValue(l),
    });
  }
}

/**
 * Diff two arrays of child settingInstances (matched by settingDefinitionId).
 */
function diffChildArrays(tChildren, lChildren, pathParts, parentDefId, drifts) {
  const tMap = new Map();
  const lMap = new Map();
  for (const c of tChildren) if (c?.settingDefinitionId) tMap.set(c.settingDefinitionId, c);
  for (const c of lChildren) if (c?.settingDefinitionId) lMap.set(c.settingDefinitionId, c);

  for (const [id, tc] of tMap) {
    const lc = lMap.get(id);
    const childName = friendlyChildName(id, parentDefId);
    if (!lc) {
      drifts.push({
        field: id,
        path: [...pathParts, childName].join(' > '),
        change: 'removed',
        expected: 'present',
        actual: 'missing',
      });
      continue;
    }
    diffSettingInstance(tc, lc, [...pathParts, childName], drifts);
  }
  for (const [id, lc] of lMap) {
    if (!tMap.has(id)) {
      drifts.push({
        field: id,
        path: [...pathParts, friendlyChildName(id, parentDefId)].join(' > '),
        change: 'added',
        expected: 'absent',
        actual: 'present',
      });
    }
  }
}

/**
 * Set-difference comparison for string arrays (simple/choice collections).
 * Order is ignored — only added/removed members count.
 */
function diffStringArrays(tArr, lArr, pathParts, defId, drifts) {
  const tSet = new Set(tArr);
  const lSet = new Set(lArr);
  const added = lArr.filter(v => !tSet.has(v));
  const removed = tArr.filter(v => !lSet.has(v));
  if (added.length === 0 && removed.length === 0) return;
  drifts.push({
    field: defId || pathParts.join(' > '),
    path: pathParts.join(' > '),
    change: 'modified',
    expected: tArr.length ? tArr.map(v => truncateValue(v, 60)).join(', ') : '(empty)',
    actual: lArr.length ? lArr.map(v => truncateValue(v, 60)).join(', ') : '(empty)',
    added,
    removed,
  });
}

function shallowEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  return String(a) === String(b);
}

/**
 * Create an alert for Intune drift detection.
 */
async function createIntuneDriftAlert(deployment, template, drifts) {
  if (!intuneDriftPolicyId) return;

  // Resolve alert routing: deployment override > template default
  const alertRouting = deployment.alert_routing || template.alert_routing || 'both';
  if (alertRouting === 'none') return;

  // Phase 9b: render readable per-change descriptions instead of just defIds
  const renderDriftLine = (d) => {
    const path = d.path || (d.field || '').split('_').slice(-2).join(' / ');
    if (d.change === 'added') {
      if (Array.isArray(d.added) && d.added.length > 0) {
        return `${path} +${d.added.length} added (${d.added.slice(0, 2).map(v => String(v).slice(0, 40)).join(', ')}${d.added.length > 2 ? '…' : ''})`;
      }
      return `${path} added`;
    }
    if (d.change === 'removed') {
      if (Array.isArray(d.removed) && d.removed.length > 0) {
        return `${path} −${d.removed.length} removed`;
      }
      return `${path} removed`;
    }
    // modified — show added/removed for collections, value diff for scalars
    if (Array.isArray(d.added) || Array.isArray(d.removed)) {
      const parts = [];
      if (d.added && d.added.length) parts.push(`+${d.added.length}`);
      if (d.removed && d.removed.length) parts.push(`−${d.removed.length}`);
      return `${path} (${parts.join(', ')})`;
    }
    const exp = String(d.expected || '').slice(0, 30);
    const act = String(d.actual || '').slice(0, 30);
    return `${path}: ${exp} → ${act}`;
  };

  const lines = drifts.slice(0, 3).map(renderDriftLine);
  const more = drifts.length > 3 ? ` (+${drifts.length - 3} more)` : '';
  const summary = lines.length > 0 ? lines.join('; ') : `${drifts.length} setting(s) changed`;

  const message = `Intune policy drift: "${template.name}" — ${summary}${more}`;
  const dedupKey = `intune_drift_${deployment.id}`;

  // Phase 9b — structured payload for display-time i18n rendering. The drift
  // body is pre-rendered English (renderDriftLine output joined with '; ') so
  // we surface it verbatim under {summary}; localizing the per-field labels
  // is a future refinement gated by an Intune setting registry pass.
  const messageTemplateKey = 'alerts.message_format.intune_policy_drift';
  const messageTemplateParams = {
    prefixKey: 'alert_message_prefix.intune_policy_drift',
    prefixFallback: 'Intune policy drift',
    templateName: template.name,
    summary,
    morePhraseKey: drifts.length > 3
      ? 'alerts.message_format.intune_drift_more.present'
      : 'alerts.message_format.intune_drift_more.absent',
    morePhraseFallback: more,
    moreCount: drifts.length > 3 ? drifts.length - 3 : 0,
  };

  // Check for existing open alert
  const existing = await db.queryOne(
    `SELECT id, recurrence_count FROM alerts
     WHERE tenant_id = ? AND dedup_key = ? AND status IN ('new', 'investigating') LIMIT 1`,
    [deployment.tenant_id, dedupKey]
  );

  if (existing) {
    const newCount = (existing.recurrence_count || 1) + 1;
    await db.execute(
      'UPDATE alerts SET recurrence_count = ?, last_seen_at = NOW(), raw_data = ? WHERE id = ?',
      [newCount, JSON.stringify({
        drifts, template_name: template.name,
        message_template_key: messageTemplateKey,
        message_template_params: messageTemplateParams,
      }), existing.id]
    );
    console.log(`[Intune:Drift] Alert ${existing.id} recurrence: ${newCount}x`);
    return;
  }

  const alertId = await db.insert(
    `INSERT INTO alerts (tenant_id, policy_id, severity, message, raw_data, dedup_key, recurrence_count, last_seen_at, triggered_at)
     VALUES (?, ?, 'high', ?, ?, ?, 1, NOW(), NOW())`,
    [deployment.tenant_id, intuneDriftPolicyId, message,
     JSON.stringify({
       drifts, template_name: template.name, deployment_id: deployment.id,
       message_template_key: messageTemplateKey,
       message_template_params: messageTemplateParams,
     }),
     dedupKey]
  );

  // Auto-attribution: link this drift alert to any recent Panoptica change on
  // the Intune surface (push/retire/accept/revoke). Attribution is not
  // suppression — the alert row persists and notifies; the UI hides attributed
  // alerts from the primary count but keeps them auditable. Match: same tenant
  // + surface overlap + within ATTRIBUTION_WINDOW_MINUTES (60). Best-effort.
  try {
    const attrib = await changeLog.findAttributingChange(deployment.tenant_id, [changeLog.SURFACE.INTUNE]);
    if (attrib) {
      await db.execute(
        'UPDATE alerts SET auto_attributed_change_id = ? WHERE id = ?',
        [attrib.id, alertId]
      );
      console.log(`[Intune:Drift] Alert ${alertId} auto-attributed to change event ${attrib.id} (${attrib.category})`);
    }
  } catch (attribErr) {
    console.warn(`[Intune:Drift] Attribution lookup failed (non-fatal): ${attribErr.message}`);
  }

  console.log(`[Intune:Drift] Created alert ${alertId}: ${message}`);

  // Send notification (respecting alert routing)
  try {
    const tenant = await db.queryOne('SELECT * FROM tenants WHERE id = ?', [deployment.tenant_id]);
    await notifier.sendAlertNotification({
      id: alertId,
      severity: 'high',
      message,
      notification_target: alertRouting,
      policy_name: 'Intune Policy Drift Detected',
      category: 'config_changes',
    }, tenant);
  } catch (nErr) {
    console.error(`[Intune:Drift] Notification failed: ${nErr.message}`);
  }
}

/**
 * Run drift checks for all active deployments across all tenants.
 * Called by the drift scheduler.
 */
/**
 * Expire any accepted-with-expiry drift acknowledgments whose timer has passed.
 * Mirrors the CA `expireExemptions()` pattern shipped 2026-04-18. When a timer
 * runs out, clear the acknowledgment so the next check re-raises drift — the
 * operator should re-review, renew, or revert.
 */
async function expireIntuneAcknowledgments() {
  try {
    const overdue = await db.queryRows(
      `SELECT id FROM intune_deployments
        WHERE drift_status = 'accepted'
          AND acknowledged_expires_at IS NOT NULL
          AND acknowledged_expires_at <= NOW()`
    );
    if (overdue.length === 0) return 0;
    for (const d of overdue) {
      await db.execute(
        `UPDATE intune_deployments
            SET drift_status = 'drifted',
                acknowledged_drift_hash = NULL,
                acknowledged_drift_payload = NULL,
                acknowledged_at = NULL,
                acknowledged_by = NULL,
                acknowledged_expires_at = NULL,
                acknowledged_reason = NULL
          WHERE id = ?`,
        [d.id]
      );
    }
    console.log(`[Intune:Drift] Expired ${overdue.length} acknowledged drift(s); drift re-raised for re-review.`);
    return overdue.length;
  } catch (err) {
    console.warn(`[Intune:Drift] expireIntuneAcknowledgments failed: ${err.message}`);
    return 0;
  }
}

async function runAllIntuneDriftChecks() {
  // Expire any accepted drifts whose timer has passed BEFORE the check loop,
  // so the drift check itself sees them as 'drifted' and re-alerts.
  await expireIntuneAcknowledgments();

  const deployments = await db.queryRows(
    `SELECT d.*, tn.tenant_id AS azure_tenant_id, tn.display_name AS tenant_name
     FROM intune_deployments d
     JOIN tenants tn ON tn.id = d.tenant_id
     WHERE d.status = 'deployed'
       AND d.deployed_policy_id IS NOT NULL
       AND tn.enabled = TRUE
       AND tn.mode = 'managed'`
  );

  if (deployments.length === 0) {
    console.log('[Intune:Drift] No active deployments to check');
    return { total: 0, drifted: 0, remediated: 0, errors: 0 };
  }

  console.log(`[Intune:Drift] Checking ${deployments.length} deployment(s) for drift`);

  let driftCount = 0;
  let errorCount = 0;

  for (const deployment of deployments) {
    try {
      const result = await checkIntuneDrift(deployment);
      if (result.drift_status === 'drifted') driftCount++;
    } catch (err) {
      errorCount++;
      console.error(`[Intune:Drift] Check failed for deployment ${deployment.id}: ${err.message}`);
    }
  }

  console.log(`[Intune:Drift] Complete: ${deployments.length} checked, ${driftCount} drifted, ${errorCount} errors`);
  // Returned for the heartbeat record (intune-drift-scheduler.js wraps this
  // call with heartbeat.recordStart/recordEnd). Intune is monitor-only —
  // never auto-remediates, hence remediated=0.
  return { total: deployments.length, drifted: driftCount, remediated: 0, errors: errorCount };
}

// ─── Manual drift check endpoint ───

router.post('/check-drift/:deploymentId', auth.requireMemberOrAdmin, async (req, res) => {
  try {
    const deploymentId = parseInt(req.params.deploymentId, 10);
    const deployment = await db.queryOne(
      `SELECT d.*, tn.tenant_id AS azure_tenant_id, tn.display_name AS tenant_name
       FROM intune_deployments d
       JOIN tenants tn ON tn.id = d.tenant_id
       WHERE d.id = ?`,
      [deploymentId]
    );
    if (!deployment) return res.status(404).json({ error: 'Deployment not found' });
    if (!deployment.deployed_policy_id) return res.status(400).json({ error: 'No policy linked to this deployment' });

    const result = await checkIntuneDrift(deployment);
    res.json(result);
  } catch (err) {
    console.error('[Intune:Drift] Manual check error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Accept drift endpoint (Phase 9) ───
//
// Records the current drift signature as "intentional" so subsequent drift
// checks that find the same drift payload don't generate fresh alerts. The
// linked open drift alert is auto-resolved with an audit-trail note.
//
// State transitions on success:
//   intune_deployments.drift_status:        drifted → accepted
//   intune_deployments.acknowledged_*:      populated
//   alerts.status (matching dedup_key):     new/investigating → resolved
//
router.post('/accept-drift/:deploymentId', auth.requireMemberOrAdmin, async (req, res) => {
  try {
    if (!auth.canMemberOrAdmin(req)) {
      return res.status(403).json({ error: 'Insufficient role — Admin or Member required to accept Intune drift' });
    }
    const deploymentId = parseInt(req.params.deploymentId, 10);
    if (!Number.isFinite(deploymentId)) {
      return res.status(400).json({ error: 'Invalid deployment id' });
    }

    const deployment = await db.queryOne(
      'SELECT * FROM intune_deployments WHERE id = ?',
      [deploymentId]
    );
    if (!deployment) return res.status(404).json({ error: 'Deployment not found' });
    if (deployment.drift_status !== 'drifted') {
      return res.status(400).json({
        error: `Cannot accept drift on deployment in '${deployment.drift_status}' state — only 'drifted' is acceptable`,
      });
    }
    if (!deployment.drift_details) {
      return res.status(400).json({ error: 'Deployment has no drift_details to accept' });
    }

    // Parse the stored drift payload
    let drifts;
    try {
      drifts = typeof deployment.drift_details === 'string'
        ? JSON.parse(deployment.drift_details)
        : deployment.drift_details;
    } catch (parseErr) {
      return res.status(500).json({ error: `Failed to parse drift_details: ${parseErr.message}` });
    }
    if (!Array.isArray(drifts) || drifts.length === 0) {
      return res.status(400).json({ error: 'drift_details is not a non-empty array' });
    }

    // Optional expiry + reason (Phase 3 MVP, 2026-04-18).
    // expiry_days present    → "Accept with expiry" path: require reason ≥3 chars,
    //                          compute expiry timestamp, store reason.
    // expiry_days absent     → "Accept Once, forever" path: no expiry, no reason.
    const { expiry_days, reason } = req.body || {};
    let acknowledgedExpiresAt = null;
    let acknowledgedReason = null;
    if (expiry_days != null && expiry_days !== '') {
      const days = parseInt(expiry_days, 10);
      if (!Number.isFinite(days) || days <= 0 || days > 365) {
        return res.status(400).json({ error: 'expiry_days must be a positive integer ≤ 365' });
      }
      if (!reason || typeof reason !== 'string' || reason.trim().length < 3) {
        return res.status(400).json({ error: 'reason is required when setting expiry (≥3 chars)' });
      }
      acknowledgedReason = reason.trim();
      acknowledgedExpiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    }

    const hash = computeDriftHash(drifts);
    const actor = req.session?.user?.email || 'unknown';
    const acceptedAt = new Date();

    // Persist the acknowledgment AND flip drift_status to 'accepted' atomically
    await db.execute(
      `UPDATE intune_deployments
          SET drift_status = 'accepted',
              acknowledged_drift_hash = ?,
              acknowledged_drift_payload = ?,
              acknowledged_at = ?,
              acknowledged_by = ?,
              acknowledged_expires_at = ?,
              acknowledged_reason = ?
        WHERE id = ?`,
      [hash, JSON.stringify(drifts), acceptedAt, actor,
       acknowledgedExpiresAt, acknowledgedReason, deploymentId]
    );

    // Auto-resolve the matching open alert (best-effort — non-fatal)
    let resolvedAlertId = null;
    try {
      const dedupKey = `intune_drift_${deploymentId}`;
      const openAlert = await db.queryOne(
        `SELECT id FROM alerts
          WHERE tenant_id = ? AND dedup_key = ? AND status IN ('new', 'investigating')
          LIMIT 1`,
        [deployment.tenant_id, dedupKey]
      );
      if (openAlert) {
        const note = `<p><em>Drift accepted as intended state by ${actor} at ${acceptedAt.toISOString()}.</em></p>`;
        await db.execute(
          `UPDATE alerts
              SET status = 'resolved',
                  closed_at = NOW(),
                  notes = CONCAT(COALESCE(notes, ''), ?)
            WHERE id = ?`,
          [note, openAlert.id]
        );
        resolvedAlertId = openAlert.id;
        console.log(`[Intune:Drift] Accepted drift on deployment ${deploymentId} by ${actor}; auto-resolved alert ${openAlert.id}`);
      } else {
        console.log(`[Intune:Drift] Accepted drift on deployment ${deploymentId} by ${actor} (no open alert to resolve)`);
      }
    } catch (alertErr) {
      console.warn(`[Intune:Drift] Accept-drift alert auto-resolve failed (non-fatal): ${alertErr.message}`);
    }

    // Audit log — Panoptica-initiated acceptance of detected drift
    try {
      const tmpl = await db.queryOne(
        'SELECT name FROM intune_templates WHERE id = ?',
        [deployment.template_id]
      );
      const tmplName = tmpl?.name || `template #${deployment.template_id}`;
      const expirySuffix = acknowledgedExpiresAt
        ? ` (expires ${acknowledgedExpiresAt.toISOString().slice(0, 10)}, reason: ${acknowledgedReason})`
        : ' (no expiry)';
      await changeLog.logPanopticaChange({
        tenantId: deployment.tenant_id,
        category: changeLog.CATEGORY.EXEMPTION_APPLY,
        surfaces: [changeLog.SURFACE.INTUNE],
        description: `Accepted Intune drift on "${tmplName}" — ${drifts.length} field${drifts.length === 1 ? '' : 's'}${expirySuffix}`,
        templateKey: 'exemption.apply',
        templateParams: { settingName: tmplName, expiresAt: expirySuffix.replace(/^[^0-9]+/, '') || 'never' },
        createdBy: actor,
        ...changeLog.captureActorContext(req),
      });
    } catch (logErr) {
      console.warn(`[Intune:Drift] Change-log failed (non-fatal): ${logErr.message}`);
    }

    res.json({
      ok: true,
      deployment_id: deploymentId,
      drift_status: 'accepted',
      acknowledged_drift_hash: hash,
      acknowledged_at: acceptedAt.toISOString(),
      acknowledged_by: actor,
      acknowledged_expires_at: acknowledgedExpiresAt ? acknowledgedExpiresAt.toISOString() : null,
      acknowledged_reason: acknowledgedReason,
      resolved_alert_id: resolvedAlertId,
    });
  } catch (err) {
    console.error('[Intune:Drift] Accept-drift error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Revoke a previously-accepted Intune drift ───────────────────────────
//
// Mirrors the CA exemption revoke path. Clears the acknowledgment so the
// next drift scan re-raises the drift (same mechanism as auto-expiry).
// No DELETE on the row — we keep drift_details so the operator can still
// see what the accepted state was, just flipped back to 'drifted'.
router.post('/accepted-drift/:deploymentId/revoke', auth.requireMemberOrAdmin, async (req, res) => {
  try {
    if (!auth.canMemberOrAdmin(req)) {
      return res.status(403).json({ error: 'Insufficient role — Admin or Member required to revoke Intune drift acceptance' });
    }
    const deploymentId = parseInt(req.params.deploymentId, 10);
    if (!Number.isFinite(deploymentId)) {
      return res.status(400).json({ error: 'Invalid deployment id' });
    }

    const deployment = await db.queryOne(
      `SELECT d.id, d.drift_status, d.tenant_id, t.name AS template_name
         FROM intune_deployments d
         JOIN intune_templates t ON d.template_id = t.id
        WHERE d.id = ?`,
      [deploymentId]
    );
    if (!deployment) return res.status(404).json({ error: 'Deployment not found' });
    if (deployment.drift_status !== 'accepted') {
      return res.status(400).json({
        error: `Cannot revoke acceptance on deployment in '${deployment.drift_status}' state — only 'accepted' is revocable`,
      });
    }

    const actor = req.session?.user?.email || 'unknown';

    await db.execute(
      `UPDATE intune_deployments
          SET drift_status = 'drifted',
              acknowledged_drift_hash = NULL,
              acknowledged_drift_payload = NULL,
              acknowledged_at = NULL,
              acknowledged_by = NULL,
              acknowledged_expires_at = NULL,
              acknowledged_reason = NULL
        WHERE id = ?`,
      [deploymentId]
    );

    console.log(`[Intune:Drift] Revoked accepted drift on deployment ${deploymentId} by ${actor}; drift re-raised.`);

    // Audit log — Panoptica-initiated revocation of drift acceptance
    try {
      await changeLog.logPanopticaChange({
        tenantId: deployment.tenant_id,
        category: changeLog.CATEGORY.EXEMPTION_REVOKE,
        surfaces: [changeLog.SURFACE.INTUNE],
        description: `Revoked accepted Intune drift on "${deployment.template_name}" — drift will re-raise on next scan`,
        templateKey: 'exemption.revoke',
        templateParams: { settingName: deployment.template_name },
        createdBy: actor,
        ...changeLog.captureActorContext(req),
      });
    } catch (logErr) {
      console.warn(`[Intune:Drift] Change-log failed (non-fatal): ${logErr.message}`);
    }

    res.json({ ok: true, deployment_id: deploymentId, drift_status: 'drifted' });
  } catch (err) {
    console.error('[Intune:Drift] Revoke-accept error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════
// BULK ADD — Create deployment records without deploying
// ═══════════════════════════════════════════

router.post('/deployments/bulk-add', auth.requireMemberOrAdmin, async (req, res) => {
  try {
    const { templateIds, tenantId, assignmentOverrides } = req.body;
    // assignmentOverrides: optional object { templateId: 'none'|'all_users'|'all_devices' }
    if (!Array.isArray(templateIds) || templateIds.length === 0 || !tenantId)
      return res.status(400).json({ error: 'templateIds array and tenantId are required' });

    const tenant = await db.queryOne('SELECT id, display_name FROM tenants WHERE id = ?', [tenantId]);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    const deployedBy = req.session.user?.email || 'unknown';
    const validTargets = ['none', 'all_users', 'all_devices'];
    let added = 0;
    let skipped = 0;
    const results = [];

    for (const templateId of templateIds) {
      // Check if deployment already exists for this template/tenant
      const existing = await db.queryOne(
        `SELECT id FROM intune_deployments WHERE template_id = ? AND tenant_id = ? AND status != 'removed' LIMIT 1`,
        [templateId, tenantId]
      );
      if (existing) {
        skipped++;
        results.push({ templateId, status: 'skipped', reason: 'Already exists' });
        continue;
      }

      const template = await db.queryOne('SELECT id, name, assignment_target FROM intune_templates WHERE id = ?', [templateId]);
      if (!template) {
        skipped++;
        results.push({ templateId, status: 'skipped', reason: 'Template not found' });
        continue;
      }

      // Per-deployment override or null (inherit from template at deploy time)
      const overrideTarget = assignmentOverrides?.[String(templateId)];
      const assignTarget = validTargets.includes(overrideTarget) ? overrideTarget : null;

      const deploymentId = await db.insert(
        `INSERT INTO intune_deployments (template_id, tenant_id, status, deployed_by, assignment_target)
         VALUES (?, ?, 'pending', ?, ?)`,
        [templateId, tenantId, deployedBy, assignTarget]
      );
      added++;
      results.push({ templateId, deploymentId, templateName: template.name, status: 'added', assignment_target: assignTarget || template.assignment_target });
    }

    console.log(`[Intune:BulkAdd] ${added} added, ${skipped} skipped for ${tenant.display_name}`);
    res.json({ added, skipped, results });
  } catch (err) {
    console.error('[Intune:BulkAdd] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════
// REMOVE DEPLOYMENT
// ═══════════════════════════════════════════

router.delete('/deployments/:id', auth.requireMemberOrAdmin, async (req, res) => {
  try {
    const deploymentId = parseInt(req.params.id, 10);
    const deployment = await db.queryOne(
      `SELECT d.*, tn.tenant_id AS azure_tenant_id, t.policy_type, t.name AS template_name
       FROM intune_deployments d
       JOIN tenants tn ON d.tenant_id = tn.id
       JOIN intune_templates t ON d.template_id = t.id
       WHERE d.id = ?`,
      [deploymentId]
    );
    if (!deployment) return res.status(404).json({ error: 'Deployment not found' });

    const deleteFromTenant = req.query.delete_from_tenant === 'true';
    let policyDeleted = false;
    let tenantDeleteError = null; // string | null — captured for audit when delete was requested but failed

    // If requested, delete the policy from the tenant
    if (deleteFromTenant && deployment.deployed_policy_id) {
      const pType = getPolicyType(deployment.policy_type);
      if (pType) {
        try {
          await graph.callGraph(deployment.azure_tenant_id, pType.policyEndpoint(deployment.deployed_policy_id), {
            version: pType.version, method: 'DELETE',
          });
          policyDeleted = true;
          console.log(`[Intune:Remove] Deleted policy ${deployment.deployed_policy_id} from tenant`);
        } catch (delErr) {
          // 404 = already gone, treat as success for audit narrative.
          if (delErr.statusCode === 404) {
            policyDeleted = true;
            console.log(`[Intune:Remove] Policy ${deployment.deployed_policy_id} was already absent from tenant (404)`);
          } else {
            tenantDeleteError = `${delErr?.statusCode || 'ERR'}: ${delErr.message}`;
            console.warn(`[Intune:Remove] Failed to delete policy: ${delErr.message}`);
          }
        }
      }
    }

    await db.execute('DELETE FROM intune_deployments WHERE id = ?', [deploymentId]);

    // Prune stale api_health rows for the removed policy's endpoints so the
    // System Health tile doesn't show ghost failures for a policy we no longer
    // track. Runs regardless of delete_from_tenant — once the deployment record
    // is gone, those endpoint rows are orphaned whether the Graph policy still
    // exists or not (we won't be calling them anymore).
    if (deployment.deployed_policy_id) {
      await pruneApiHealthForPolicy(
        deployment.tenant_id,
        deployment.policy_type,
        deployment.deployed_policy_id
      );
    }

    // ─── AUDIT ───
    // Every operator-initiated REMOVE is an audit event, regardless of whether
    // Graph also deleted the tenant-side policy. Previous behavior gated this
    // on `policyDeleted` and silently dropped the "untrack only" case — which
    // left the audit trail lying about operator intent. The category is the
    // same (INTUNE_POLICY_RETIRE), but the description differentiates three
    // outcomes so an auditor can tell them apart:
    //   1. Tenant-side retire succeeded (or was already gone)
    //   2. Tenant-side retire was requested but Graph DELETE failed
    //   3. Panoptica tracking removed only (operator kept tenant policy live)
    try {
      let description;
      if (deleteFromTenant && policyDeleted) {
        description = `Retired Intune policy "${deployment.template_name}" (${deployment.policy_type}) — deleted from tenant`;
      } else if (deleteFromTenant && !policyDeleted) {
        description = `Removed Intune policy "${deployment.template_name}" (${deployment.policy_type}) from Panoptica tracking — tenant-side DELETE FAILED: ${tenantDeleteError || 'unknown error'} (policy still present in tenant)`;
      } else {
        description = `Removed Intune policy "${deployment.template_name}" (${deployment.policy_type}) from Panoptica tracking — tenant policy retained`;
      }
      await changeLog.logPanopticaChange({
        tenantId: deployment.tenant_id,
        category: changeLog.CATEGORY.INTUNE_POLICY_RETIRE,
        surfaces: [changeLog.SURFACE.INTUNE],
        description,
        templateKey: 'intune_retire',
        templateParams: { policyName: deployment.template_name || 'Intune policy' },
        createdBy: req.session?.user?.email || 'unknown',
        ...changeLog.captureActorContext(req),
      });
    } catch (logErr) {
      console.warn(`[Intune:Remove] Change-log failed (non-fatal): ${logErr.message}`);
    }

    res.json({
      removed: true,
      policy_deleted: policyDeleted,
      tenant_delete_requested: deleteFromTenant,
      tenant_delete_error: tenantDeleteError,
    });
  } catch (err) {
    console.error('[Intune:Remove] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════
// DEPLOYMENT — Alert Routing Override
// ═══════════════════════════════════════════

/**
 * PATCH /api/intune/deployments/:id/alert-routing — Update alert routing override.
 * Body: { alert_routing: 'support'|'personal'|'both'|'none'|null }
 * null means inherit from template default.
 */
router.patch('/deployments/:id/alert-routing', auth.requireMemberOrAdmin, async (req, res) => {
  try {
    const { alert_routing } = req.body;
    if (alert_routing !== null && !['support', 'personal', 'both', 'none'].includes(alert_routing)) {
      return res.status(400).json({ error: 'alert_routing must be "support", "personal", "both", "none", or null' });
    }
    const deploymentId = parseInt(req.params.id, 10);
    const affected = await db.execute(
      'UPDATE intune_deployments SET alert_routing = ? WHERE id = ?',
      [alert_routing, deploymentId]
    );
    if (affected === 0) return res.status(404).json({ error: 'Deployment not found' });
    console.log(`[Intune] Alert routing changed to "${alert_routing}" for deployment ${deploymentId} by ${req.session.user?.email}`);
    res.json({ success: true, alert_routing });
  } catch (err) {
    console.error('[Intune] Update alert routing failed:', err.message);
    res.status(500).json({ error: 'Failed to update alert routing' });
  }
});

// ═══════════════════════════════════════════
// DEPLOYMENTS — List / Status
// ═══════════════════════════════════════════

router.get('/deployments', async (req, res) => {
  try {
    let sql = `
      SELECT d.*, t.name AS template_name, t.category, t.policy_type,
             t.alert_routing AS template_alert_routing,
             tn.display_name AS tenant_name
      FROM intune_deployments d
      JOIN intune_templates t ON d.template_id = t.id
      JOIN tenants tn ON d.tenant_id = tn.id
    `;
    const conditions = [];
    const params = [];

    if (req.query.template_id) {
      conditions.push('d.template_id = ?');
      params.push(parseInt(req.query.template_id, 10));
    }
    if (req.query.tenant_id) {
      conditions.push('d.tenant_id = ?');
      params.push(parseInt(req.query.tenant_id, 10));
    }
    if (req.query.status) {
      conditions.push('d.status = ?');
      params.push(req.query.status);
    }

    if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY d.created_at DESC LIMIT 200';

    const rows = await db.queryRows(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('[Intune:Deployments] List error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Live Graph extraction of every Intune policy in a tenant, grouped by type.
 * Reusable by both the /export/:tenantId route (template-import) and the
 * audit tenant-snapshot bundler (so audit-only tenants get policies via
 * direct Graph reads instead of the empty-by-design intune_deployments
 * table). Returns { policiesByType, errors } where policiesByType is a map
 * of POLICY_TYPES.key → array of normalised policy objects matching the
 * per-policy shape produced by the existing /export route.
 *
 * @param {object} tenant - { id, tenant_id, display_name }
 * @returns {Promise<{policiesByType: Object, errors: Array<string>}>}
 */
async function exportIntunePoliciesLive(tenant) {
  const azureTenantId = tenant.tenant_id;
  const policiesByType = {};
  const errors = [];

  for (const pType of POLICY_TYPES) {
    policiesByType[pType.key] = [];
    try {
      const policies = await graph.callGraphPaged(azureTenantId, pType.listEndpoint, {
        version: pType.version,
        maxPages: 20,
      });

      for (const policy of policies) {
        const item = {
          policyType: pType.key,
          name: pType.extractName(policy),
          description: pType.extractDesc(policy),
          category: pType.extractCategory(policy),
          templateFamily: policy.templateReference?.templateFamily || null,
          policy: pType.stripForTemplate(policy),
          // Audit consumers need the original Graph id to correlate against
          // assignments and to refetch later. The route handler omits this;
          // the audit bundle includes it.
          graphId: policy.id,
        };

        if (pType.key === 'configurationPolicies' && pType.settingsEndpoint) {
          try {
            const settingsData = await graph.callGraphPaged(
              azureTenantId, pType.settingsEndpoint(policy.id),
              { version: 'beta', maxPages: 5 }
            );
            item.settings = settingsData.map(s => stripSettingIds(s));
          } catch (sErr) {
            console.warn(`[Intune:Live] Failed to fetch settings for ${item.name}: ${sErr.message}`);
            item.settings = [];
          }
        }

        if (pType.key === 'groupPolicyConfigurations' && pType.definitionsEndpoint) {
          try {
            const defValues = await graph.callGraphPaged(
              azureTenantId, pType.definitionsEndpoint(policy.id),
              { version: 'beta', maxPages: 5 }
            );
            item.definitionValues = defValues;
          } catch (dErr) {
            console.warn(`[Intune:Live] Failed to fetch definitions for ${item.name}: ${dErr.message}`);
            item.definitionValues = [];
          }
        }

        if (pType.key === 'intents' && pType.settingsEndpoint) {
          try {
            const intentSettings = await graph.callGraphPaged(
              azureTenantId, pType.settingsEndpoint(policy.id),
              { version: 'beta', maxPages: 5 }
            );
            item.settings = intentSettings;
          } catch (sErr) {
            console.warn(`[Intune:Live] Failed to fetch intent settings for ${item.name}: ${sErr.message}`);
            item.settings = [];
          }
        }

        policiesByType[pType.key].push(item);
      }
      console.log(`[Intune:Live] tenant=${tenant.id} ${pType.key}: ${policies.length} policies`);
    } catch (err) {
      const msg = `${pType.label}: ${err.message}`;
      console.warn(`[Intune:Live] ${msg}`);
      errors.push(msg);
    }
  }

  return { policiesByType, errors };
}

// Export the drift check function and schema readiness for the scheduler
router.runAllIntuneDriftChecks = runAllIntuneDriftChecks;
router.schemaReady = intuneSchemaReady;
router.exportIntunePoliciesLive = exportIntunePoliciesLive;

module.exports = router;
// Reused server-side by the Quick Assessment report (api-reports.js).
module.exports.exportTenantIntunePolicies = exportTenantIntunePolicies;
