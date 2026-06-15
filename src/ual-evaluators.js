/**
 * Panoptica365 — Unified Audit Log Evaluators
 *
 * Phase 4 (May 5, 2026) — first two UAL detections:
 *   1. Add-MailboxPermission (Audit.Exchange) — alert when a mailbox
 *      permission is granted to someone other than the mailbox owner.
 *      Better-than-Octiga because it carries full grantee + rights detail.
 *   2. Anomalous-geo File Access (Audit.SharePoint) — FileAccessed /
 *      FileDownloaded from a country not in the tenant's CA-derived
 *      allowed-countries list, with compliant-device suppression via
 *      src/lib/ca-compliance-correlation.js.
 *
 * Forward-only cutover contract:
 *   Each evaluator only considers events where creation_time > MAX(
 *     tenants.ual_first_seen_at,
 *     tenants.ual_last_evaluated_at
 *   ). ual_first_seen_at is set to UTC_TIMESTAMP() at migration for existing
 *   tenants and at first-poll for new tenants — clean-slate semantics so
 *   the May 4-5 backfill doesn't generate alert bursts.
 *
 * Audit-only contract:
 *   runEvaluators() respects shouldProcessTenant(). Audit-only tenants are
 *   skipped — same gate the worker uses upstream of ingestion.
 *
 * Idempotency:
 *   Each alert is keyed on a dedup_key that includes the ual_event.id, so
 *   a re-run on the same event range cannot fire duplicate alerts. The
 *   existing alerts table dedup logic in createOrUpdateAlert handles this.
 *
 * Reference: Documentation/Panoptica365 — Unified Audit Log Strategy v2.docx
 *            §3 (catalog), §4 (implementation), §5.1 (Track A scope)
 */

const db = require('./db/database');
const ualEvents = require('./lib/ual-events');
const correlation = require('./lib/ca-compliance-correlation');
const defenderIncidents = require('./lib/defender-incidents');
const tenantMode = require('./lib/tenant-mode');
const alertEngine = require('./alert-engine');
// Adopt-in-Place (2026-06-15): near-real-time detection of CA policies created
// outside Panoptica (§7.4). The UAL "Add conditional access policy" event is a
// trigger to run the read-only discovery reconcile immediately rather than wait
// for the daily loop — both paths share the seen-set + dedup key, so neither
// floods nor double-fires.
const adoptService = require('./lib/adopt-service');
// Break-glass roster (sign-in alert matches UAL UserLoggedIn events against the
// tenant's designated emergency accounts). access-review-store only requires
// ./db/database, so no require cycle.
const accessReviewStore = require('./lib/access-review-store');
// Break-glass CA coverage check (Graph). break-glass-graph → ./graph only.
const bgGraph = require('./lib/break-glass-graph');

// Policy names — idempotent bootstrap targets in alert_policies
const POLICY_MAILBOX_PERMISSION = 'UAL: Mailbox permission added';
const POLICY_ANOMALOUS_GEO_FILE = 'UAL: Anomalous-geo file access';
const POLICY_OAUTH_CONSENT = 'UAL: OAuth consent / app role grant';
const POLICY_SP_CREDENTIALS = 'UAL: Service principal credentials added';
const POLICY_PRIVILEGED_ROLE = 'UAL: Privileged role assignment';
const POLICY_BREAKGLASS_SIGNIN = 'UAL: Break-glass account sign-in';
const POLICY_BREAKGLASS_COVERAGE = 'Break-glass CA coverage gap';
// Bundle B (May 5, 2026) — tenant-scope mail integrity
const POLICY_TRANSPORT_RULE = 'UAL: Transport rule changed';
const POLICY_MAILBOX_FORWARDING = 'UAL: Mailbox forwarding configured (UAL)';
const POLICY_INBOX_RULE_UAL = 'UAL: Inbox rule changed (UAL-enriched)';
// Bundle C (May 6, 2026) — SharePoint + Compliance + Identity-tampering surfaces
const POLICY_ANONYMOUS_LINK = 'UAL: Anonymous link created';
const POLICY_MASS_DELETE = 'UAL: Mass file deletion burst';
const POLICY_DISCOVERY_SEARCH = 'UAL: eDiscovery / Compliance search';
const POLICY_MAIL_FLOW_DISABLED = 'UAL: Mail flow rule disabled or removed';
const POLICY_APP_URI_MODIFIED = 'UAL: Application URI/RedirectUri modified';
const POLICY_SENDAS_GRANT = 'UAL: Send-As / SendOnBehalf permission grant';
// Bundle D (May 6, 2026 late) — Defender ingestion + sabotage detection
const POLICY_DEFENDER_ALERT = 'UAL: Microsoft Defender alert';
const POLICY_SITE_COLLECTION_ADMIN = 'UAL: Site collection administrator added';
const POLICY_OUTBOUND_CONNECTOR = 'UAL: Outbound connector changed';
const POLICY_MAILBOX_DESTRUCTION = 'UAL: Mailbox disabled or removed';
const POLICY_ORG_CONFIG_TAMPER = 'UAL: Org-wide Exchange config tampered';
// Bundle E (May 6, 2026 latest) — Account-takeover + RBAC-bypass surfaces
const POLICY_MFA_METHOD_TAMPER = 'UAL: MFA method tampered (admin-on-behalf-of)';
const POLICY_EXCHANGE_ROLE_GROUP = 'UAL: Exchange role group membership changed';
const POLICY_PER_MAILBOX_AUDIT_TAMPER = 'UAL: Per-mailbox audit tampered';
const POLICY_ADMIN_PASSWORD_RESET = 'UAL: Admin-initiated password reset';
const POLICY_LEGACY_PROTOCOL_REENABLED = 'UAL: Legacy protocol re-enabled per mailbox';
// Bundle F (May 6, 2026 evening) — Defender Incidents (Graph Security API, not UAL)
const POLICY_DEFENDER_INCIDENT = 'UAL: Microsoft Defender incident';

// Cached policy IDs after bootstrap
let _policyIdMailboxPerm = null;
let _policyIdAnomGeoFile = null;
let _policyIdOauthConsent = null;
let _policyIdSpCredentials = null;
let _policyIdPrivilegedRole = null;
let _policyIdBreakGlassSignin = null;
let _policyIdBreakGlassCoverage = null;
let _policyIdTransportRule = null;
let _policyIdMailboxFwd = null;
let _policyIdInboxRuleUal = null;
// Bundle C
let _policyIdAnonymousLink = null;
let _policyIdMassDelete = null;
let _policyIdDiscoverySearch = null;
let _policyIdMailFlowDisabled = null;
let _policyIdAppUriModified = null;
let _policyIdSendAsGrant = null;
// Bundle D
let _policyIdDefenderAlert = null;
let _policyIdSiteCollectionAdmin = null;
let _policyIdOutboundConnector = null;
let _policyIdMailboxDestruction = null;
let _policyIdOrgConfigTamper = null;
// Bundle E
let _policyIdMfaMethodTamper = null;
let _policyIdExchangeRoleGroup = null;
let _policyIdPerMailboxAuditTamper = null;
let _policyIdAdminPasswordReset = null;
let _policyIdLegacyProtocolReenabled = null;
// Bundle F
let _policyIdDefenderIncident = null;

/**
 * Build the message_template_params pair that renders a UAL policy name
 * without the internal "UAL: " prefix in operator-facing copy.
 *
 * Why: UAL alert policies are stored as "UAL: <human name>" in alert_policies.
 * The leading "UAL:" is an internal namespace marker — useful for back-end
 * grouping but should never reach the operator's eye (memory:
 * feedback_no_internal_ids_in_ui_copy.md). The frontend's resolveTemplateParams
 * accepts a (<base>Key, <base>Fallback) pair and resolves it via
 * alert_policy_names.<slug>, dropping the prefix and translating to the
 * operator's locale.
 *
 * Slug rule mirrors PanopticaI18n.slugify on the frontend: lowercase the
 * human name and replace runs of non-alphanumerics with a single underscore,
 * then prefix with `ual_` to match the keys under alert_policy_names in en.json.
 *
 * Wired May 12, 2026 after Bundle F's first real-world alert surfaced with
 * "UAL: Microsoft Defender incident: …" in the title.
 *
 * @param {string} policyName  Raw policy.name from alert_policies row
 * @returns {object}  { policyNameKey, policyNameFallback }
 */
function buildPolicyNameParams(policyName) {
  const human = String(policyName || '').replace(/^UAL:\s*/, '');
  const slug = human.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return {
    policyNameKey: `alert_policy_names.ual_${slug}`,
    policyNameFallback: human,
  };
}

/**
 * Idempotent bootstrap of the two new alert_policies rows. Called at module
 * load. Same pattern as ensureMailboxLevelForwardingPolicy in alert-engine.js.
 */
async function ensureUalAlertPolicies() {
  // Mailbox permission added
  let mp = await db.queryOne(
    'SELECT id FROM alert_policies WHERE name = ? LIMIT 1',
    [POLICY_MAILBOX_PERMISSION]
  );
  if (!mp) {
    const id = await db.insert(
      `INSERT INTO alert_policies
         (name, description, category, severity, polling_tier, notification_target, detection_logic, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        POLICY_MAILBOX_PERMISSION,
        'A mailbox permission was added to a user who is not the mailbox owner. Source: Office 365 Management Activity API (Audit.Exchange, Add-MailboxPermission / Add-RecipientPermission). Carries full grantee + rights + operator IP — improves on Octiga\'s truncated equivalent.',
        'permissions',
        'high',
        'critical',
        'both',
        JSON.stringify({ ual_evaluator: 'add_mailbox_permission' }),
      ]
    );
    console.log(`[UalEvaluators] Created alert policy "${POLICY_MAILBOX_PERMISSION}" id=${id}`);
    _policyIdMailboxPerm = id;
  } else {
    _policyIdMailboxPerm = mp.id;
  }

  // Anomalous-geo file access
  let af = await db.queryOne(
    'SELECT id FROM alert_policies WHERE name = ? LIMIT 1',
    [POLICY_ANOMALOUS_GEO_FILE]
  );
  if (!af) {
    const id = await db.insert(
      `INSERT INTO alert_policies
         (name, description, category, severity, polling_tier, notification_target, detection_logic, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        POLICY_ANOMALOUS_GEO_FILE,
        'A user accessed or downloaded a SharePoint / OneDrive file from a country outside the tenant\'s CA-derived allowed list. Suppressed when the underlying sign-in was gated by a compliant-device CA policy (the sign-in succeeded specifically because Microsoft permitted compliant-device access from anywhere). Source: Office 365 Management Activity API (Audit.SharePoint, FileAccessed / FileDownloaded).',
        'external_sharing',
        'high',
        'critical',
        'both',
        JSON.stringify({ ual_evaluator: 'anomalous_geo_file_access' }),
      ]
    );
    console.log(`[UalEvaluators] Created alert policy "${POLICY_ANOMALOUS_GEO_FILE}" id=${id}`);
    _policyIdAnomGeoFile = id;
  } else {
    _policyIdAnomGeoFile = af.id;
  }

  // OAuth consent / app role grant
  let oc = await db.queryOne(
    'SELECT id FROM alert_policies WHERE name = ? LIMIT 1',
    [POLICY_OAUTH_CONSENT]
  );
  if (!oc) {
    const id = await db.insert(
      `INSERT INTO alert_policies
         (name, description, category, severity, polling_tier, notification_target, detection_logic, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        POLICY_OAUTH_CONSENT,
        'A user or admin granted consent to an application — the post-AiTM persistence playbook. Severity escalates to severe when requested scopes include high-risk values (Mail.Read.All, Files.Read.All, offline_access, Directory.*.All, full_access_as_app, AppRoleAssignment.ReadWrite.All). Admin consent is more severe than user consent. Source: Office 365 Management Activity API (Audit.AzureActiveDirectory).',
        'permissions',
        'severe',
        'critical',
        'both',
        JSON.stringify({ ual_evaluator: 'oauth_consent' }),
      ]
    );
    console.log(`[UalEvaluators] Created alert policy "${POLICY_OAUTH_CONSENT}" id=${id}`);
    _policyIdOauthConsent = id;
  } else {
    _policyIdOauthConsent = oc.id;
  }

  // Service principal credentials added
  let sc = await db.queryOne(
    'SELECT id FROM alert_policies WHERE name = ? LIMIT 1',
    [POLICY_SP_CREDENTIALS]
  );
  if (!sc) {
    const id = await db.insert(
      `INSERT INTO alert_policies
         (name, description, category, severity, polling_tier, notification_target, detection_logic, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        POLICY_SP_CREDENTIALS,
        'A new client secret or certificate was added to a service principal or application. Apex persistence indicator — once an attacker has a credential on an existing SP, they retain access through password rotations and admin investigation rounds. Source: Office 365 Management Activity API (Audit.AzureActiveDirectory).',
        'permissions',
        'severe',
        'critical',
        'both',
        JSON.stringify({ ual_evaluator: 'sp_credentials' }),
      ]
    );
    console.log(`[UalEvaluators] Created alert policy "${POLICY_SP_CREDENTIALS}" id=${id}`);
    _policyIdSpCredentials = id;
  } else {
    _policyIdSpCredentials = sc.id;
  }

  // Privileged role assignment
  let pr = await db.queryOne(
    'SELECT id FROM alert_policies WHERE name = ? LIMIT 1',
    [POLICY_PRIVILEGED_ROLE]
  );
  if (!pr) {
    const id = await db.insert(
      `INSERT INTO alert_policies
         (name, description, category, severity, polling_tier, notification_target, detection_logic, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        POLICY_PRIVILEGED_ROLE,
        'A user was assigned a privileged Entra role. Severity computed per-role: Severe for Global Administrator, Privileged Role Administrator, Privileged Authentication Administrator. High for Application/Cloud App/Exchange/SharePoint/Teams/Security administrators. Medium for User/Helpdesk/Reports administrators. Replaces the narrow Global-admin-only existing alert with full coverage of the ~12 sensitive Entra roles. Source: Office 365 Management Activity API (Audit.AzureActiveDirectory, Add member to role).',
        'permissions',
        'high',
        'critical',
        'both',
        JSON.stringify({ ual_evaluator: 'privileged_role' }),
      ]
    );
    console.log(`[UalEvaluators] Created alert policy "${POLICY_PRIVILEGED_ROLE}" id=${id}`);
    _policyIdPrivilegedRole = id;
  } else {
    _policyIdPrivilegedRole = pr.id;
  }

  // Break-glass account sign-in (SEVERE) — Break-Glass Governance, 2026-06-13
  let bg = await db.queryOne(
    'SELECT id FROM alert_policies WHERE name = ? LIMIT 1',
    [POLICY_BREAKGLASS_SIGNIN]
  );
  if (!bg) {
    const id = await db.insert(
      `INSERT INTO alert_policies
         (name, description, category, severity, polling_tier, notification_target, detection_logic, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        POLICY_BREAKGLASS_SIGNIN,
        'A designated break-glass (emergency-access) account signed in. These accounts should sit dormant and only be used during an outage or genuine emergency, so ANY sign-in is high-signal and worth immediate review. Matches UAL UserLoggedIn events against the tenant\'s break-glass roster — works without an Entra P1 license (directory sign-in logs are P1-gated). Source: Office 365 Management Activity API (Audit.AzureActiveDirectory, UserLoggedIn).',
        'risky_signins',
        'severe',
        'critical',
        'both',
        JSON.stringify({ ual_evaluator: 'breakglass_signin' }),
      ]
    );
    console.log(`[UalEvaluators] Created alert policy "${POLICY_BREAKGLASS_SIGNIN}" id=${id}`);
    _policyIdBreakGlassSignin = id;
  } else {
    _policyIdBreakGlassSignin = bg.id;
  }

  // Break-glass CA coverage gap — the group stopped being excluded from every CA
  // policy (a removed exclusion, or a new policy created without it).
  let bgc = await db.queryOne(
    'SELECT id FROM alert_policies WHERE name = ? LIMIT 1',
    [POLICY_BREAKGLASS_COVERAGE]
  );
  if (!bgc) {
    const id = await db.insert(
      `INSERT INTO alert_policies
         (name, description, category, severity, polling_tier, notification_target, detection_logic, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        POLICY_BREAKGLASS_COVERAGE,
        'A designated break-glass group is no longer excluded from every enforceable Conditional Access policy — because an exclusion was removed, or a new CA policy was created that does not exclude it. The emergency accounts could be locked out during an outage. Panoptica verifies coverage each cycle for tenants with a break-glass group configured. Re-apply the exclusion from the Access Review tab to close the gap. Source: Microsoft Graph (conditionalAccess/policies).',
        'config_changes',
        'high',
        'critical',
        'both',
        // threshold_type:'imperative' tells the scheduled alert-engine dispatcher
        // to skip this policy cleanly (it's fired by evaluateBreakGlassCoverage,
        // not the threshold poll). Without it the dispatcher logs "Unknown
        // threshold_type" every cycle — this policy's name has no "UAL:" prefix,
        // which is the OTHER skip path the UAL policies rely on.
        JSON.stringify({ ual_evaluator: 'breakglass_coverage', threshold_type: 'imperative' }),
      ]
    );
    console.log(`[UalEvaluators] Created alert policy "${POLICY_BREAKGLASS_COVERAGE}" id=${id}`);
    _policyIdBreakGlassCoverage = id;
  } else {
    _policyIdBreakGlassCoverage = bgc.id;
    // Migrate rows created before the imperative marker existed, so the
    // dispatcher stops flooding the log with "Unknown threshold_type".
    await db.execute('UPDATE alert_policies SET detection_logic = ? WHERE id = ?',
      [JSON.stringify({ ual_evaluator: 'breakglass_coverage', threshold_type: 'imperative' }), bgc.id]);
  }

  // Transport rule changed (tenant-scope mail flow)
  let tr = await db.queryOne(
    'SELECT id FROM alert_policies WHERE name = ? LIMIT 1',
    [POLICY_TRANSPORT_RULE]
  );
  if (!tr) {
    const id = await db.insert(
      `INSERT INTO alert_policies
         (name, description, category, severity, polling_tier, notification_target, detection_logic, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        POLICY_TRANSPORT_RULE,
        'A tenant-wide transport rule was created, modified, removed, enabled, or disabled. Severe when the rule has BlindCopyTo or RedirectMessageTo (mail-exfiltration vectors); high otherwise. Transport rules operate at tenant scope — a single malicious BCC-to-attacker rule exfiltrates the entire org\'s mail until spotted. Source: Office 365 Management Activity API (Audit.Exchange).',
        'threat_mgmt',
        'high',
        'critical',
        'both',
        JSON.stringify({ ual_evaluator: 'transport_rule' }),
      ]
    );
    console.log(`[UalEvaluators] Created alert policy "${POLICY_TRANSPORT_RULE}" id=${id}`);
    _policyIdTransportRule = id;
  } else {
    _policyIdTransportRule = tr.id;
  }

  // Mailbox forwarding configured (UAL-enriched)
  let mf = await db.queryOne(
    'SELECT id FROM alert_policies WHERE name = ? LIMIT 1',
    [POLICY_MAILBOX_FORWARDING]
  );
  if (!mf) {
    const id = await db.insert(
      `INSERT INTO alert_policies
         (name, description, category, severity, polling_tier, notification_target, detection_logic, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        POLICY_MAILBOX_FORWARDING,
        'Set-Mailbox enabled ForwardingSmtpAddress or ForwardingAddress on a mailbox. Severe when the destination domain differs from the mailbox owner\'s domain (external-domain forwarding — classic BEC pattern); high for internal-domain forwarding. UAL-enriched with operator UPN + IP — adds attribution that the existing snapshot-based forwarding alert (id 40) lacks. Source: Office 365 Management Activity API (Audit.Exchange, Set-Mailbox).',
        'threat_mgmt',
        'high',
        'critical',
        'both',
        JSON.stringify({ ual_evaluator: 'mailbox_forwarding' }),
      ]
    );
    console.log(`[UalEvaluators] Created alert policy "${POLICY_MAILBOX_FORWARDING}" id=${id}`);
    _policyIdMailboxFwd = id;
  } else {
    _policyIdMailboxFwd = mf.id;
  }

  // Inbox rule changed (UAL-enriched)
  let ir = await db.queryOne(
    'SELECT id FROM alert_policies WHERE name = ? LIMIT 1',
    [POLICY_INBOX_RULE_UAL]
  );
  if (!ir) {
    const id = await db.insert(
      `INSERT INTO alert_policies
         (name, description, category, severity, polling_tier, notification_target, detection_logic, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        POLICY_INBOX_RULE_UAL,
        'New-InboxRule, Set-InboxRule, Update-InboxRule, or Disable-InboxRule fired. Severity: severe when operator UPN does not match mailbox owner UPN (admin or compromised account modifying someone else\'s mail) OR when rule has ForwardTo / RedirectTo / DeleteMessage; high for MoveToFolder evasion patterns (Deleted Items, RSS Feeds, Junk Email); medium for plain rule changes. UAL-enriched with operator + IP attribution — adds context that the existing snapshot-based inbox rule alerts (ids 27/28/29) lack. Coexists with those alerts; future cleanup may retire snapshot-based ones once UAL version is validated. Source: Office 365 Management Activity API (Audit.Exchange).',
        'threat_mgmt',
        'high',
        'critical',
        'both',
        JSON.stringify({ ual_evaluator: 'inbox_rule_ual' }),
      ]
    );
    console.log(`[UalEvaluators] Created alert policy "${POLICY_INBOX_RULE_UAL}" id=${id}`);
    _policyIdInboxRuleUal = id;
  } else {
    _policyIdInboxRuleUal = ir.id;
  }

  // ── Bundle C policies ────────────────────────────────────────────────

  // Anonymous link created (SharePoint "anyone with the link")
  let al = await db.queryOne(
    'SELECT id FROM alert_policies WHERE name = ? LIMIT 1',
    [POLICY_ANONYMOUS_LINK]
  );
  if (!al) {
    const id = await db.insert(
      `INSERT INTO alert_policies
         (name, description, category, severity, polling_tier, notification_target, detection_logic, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        POLICY_ANONYMOUS_LINK,
        'A SharePoint or OneDrive resource was shared via "anyone with the link" — no authentication required to access. Top SMB exfiltration vector. Watches operations AnonymousLinkCreated and SharingSet (with Anonymous/Everyone target). Source: Office 365 Management Activity API (Audit.SharePoint).',
        'external_sharing',
        'medium',
        'critical',
        'both',
        JSON.stringify({ ual_evaluator: 'anonymous_link' }),
      ]
    );
    console.log(`[UalEvaluators] Created alert policy "${POLICY_ANONYMOUS_LINK}" id=${id}`);
    _policyIdAnonymousLink = id;
  } else {
    _policyIdAnonymousLink = al.id;
  }

  // Mass file deletion burst (SharePoint/OneDrive ransomware/sabotage indicator)
  let md = await db.queryOne(
    'SELECT id FROM alert_policies WHERE name = ? LIMIT 1',
    [POLICY_MASS_DELETE]
  );
  if (!md) {
    const id = await db.insert(
      `INSERT INTO alert_policies
         (name, description, category, severity, polling_tier, notification_target, detection_logic, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        POLICY_MASS_DELETE,
        'A user deleted an unusually high number of SharePoint or OneDrive files in a short window. Threshold: 50 file-deletions in 15 minutes per user (tunable via detection_logic). Pattern matches ransomware (encrypt-and-delete-original) AND insider sabotage on departure. Anti-flapping via ual_burst_state — a burst alert does not re-fire for the same (user, day) within the cooldown window. Source: Office 365 Management Activity API (Audit.SharePoint, FileDeleted).',
        'info_governance',
        'high',
        'critical',
        'both',
        JSON.stringify({ ual_evaluator: 'mass_delete', threshold: 50, window_minutes: 15, cooldown_minutes: 60 }),
      ]
    );
    console.log(`[UalEvaluators] Created alert policy "${POLICY_MASS_DELETE}" id=${id}`);
    _policyIdMassDelete = id;
  } else {
    _policyIdMassDelete = md.id;
  }

  // eDiscovery / Compliance search (insider admin abuse pattern)
  let ds = await db.queryOne(
    'SELECT id FROM alert_policies WHERE name = ? LIMIT 1',
    [POLICY_DISCOVERY_SEARCH]
  );
  if (!ds) {
    const id = await db.insert(
      `INSERT INTO alert_policies
         (name, description, category, severity, polling_tier, notification_target, detection_logic, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        POLICY_DISCOVERY_SEARCH,
        'A Purview Compliance / Mailbox eDiscovery search was created or started. Detects insider admin abuse (rogue admin reading user mailboxes via the discovery surface — invisible to Graph-side detection). Auto-attributes to the Panoptica MSP audit log when the operator action is attested by a recent legitimate operator session; alerts are still recorded but flagged as attributed (not noisy). Source: Office 365 Management Activity API (Audit.General + Audit.Exchange, New-ComplianceSearch / Start-ComplianceSearch / New-MailboxSearch / SearchCreated).',
        'permissions',
        'high',
        'critical',
        'both',
        JSON.stringify({ ual_evaluator: 'discovery_search', attribution_window_minutes: 15 }),
      ]
    );
    console.log(`[UalEvaluators] Created alert policy "${POLICY_DISCOVERY_SEARCH}" id=${id}`);
    _policyIdDiscoverySearch = id;
  } else {
    _policyIdDiscoverySearch = ds.id;
  }

  // Mail flow rule disabled or removed (security tampering — inverse of Bundle B's "rule created")
  let mfd = await db.queryOne(
    'SELECT id FROM alert_policies WHERE name = ? LIMIT 1',
    [POLICY_MAIL_FLOW_DISABLED]
  );
  if (!mfd) {
    const id = await db.insert(
      `INSERT INTO alert_policies
         (name, description, category, severity, polling_tier, notification_target, detection_logic, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        POLICY_MAIL_FLOW_DISABLED,
        'A tenant transport rule was disabled or removed (Disable-TransportRule, Remove-TransportRule, or Set-TransportRule with State=Disabled). Detects security tampering — bad actor or insider silently turning OFF EOP/anti-spam protections that would otherwise block their traffic. Excludes Panoptica-managed rules (e.g. EXO-05 outbound notification) which legitimately get touched during Apply. Source: Office 365 Management Activity API (Audit.Exchange).',
        'threat_mgmt',
        'high',
        'critical',
        'both',
        JSON.stringify({ ual_evaluator: 'mail_flow_disabled' }),
      ]
    );
    console.log(`[UalEvaluators] Created alert policy "${POLICY_MAIL_FLOW_DISABLED}" id=${id}`);
    _policyIdMailFlowDisabled = id;
  } else {
    _policyIdMailFlowDisabled = mfd.id;
  }

  // Application URI / RedirectUri modified (token theft setup)
  let au = await db.queryOne(
    'SELECT id FROM alert_policies WHERE name = ? LIMIT 1',
    [POLICY_APP_URI_MODIFIED]
  );
  if (!au) {
    const id = await db.insert(
      `INSERT INTO alert_policies
         (name, description, category, severity, polling_tier, notification_target, detection_logic, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        POLICY_APP_URI_MODIFIED,
        'An application registration had its ReplyUrls, IdentifierUris, or Web.RedirectUris modified. Token theft setup pattern — attacker registers their callback URL on a legitimate app to harvest tokens. Bundle A covered SP credentials; URI changes are the other half of the application-tampering attack surface. Cosmetic property changes (display name, owner) are filtered out — only URI deltas fire. Source: Office 365 Management Activity API (Audit.AzureActiveDirectory, Update application).',
        'config_changes',
        'high',
        'critical',
        'both',
        JSON.stringify({ ual_evaluator: 'app_uri_modified' }),
      ]
    );
    console.log(`[UalEvaluators] Created alert policy "${POLICY_APP_URI_MODIFIED}" id=${id}`);
    _policyIdAppUriModified = id;
  } else {
    _policyIdAppUriModified = au.id;
  }

  // Send-As / SendOnBehalf permission grant (impersonation setup)
  let sa = await db.queryOne(
    'SELECT id FROM alert_policies WHERE name = ? LIMIT 1',
    [POLICY_SENDAS_GRANT]
  );
  if (!sa) {
    const id = await db.insert(
      `INSERT INTO alert_policies
         (name, description, category, severity, polling_tier, notification_target, detection_logic, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        POLICY_SENDAS_GRANT,
        'A SendAs or SendOnBehalf permission was granted on a mailbox (Add-RecipientPermission with SendAs, or Set-Mailbox with GrantSendOnBehalfTo delta). Impersonation setup — grantee can send mail appearing to come from the target mailbox. Complements Phase 4 Add-MailboxPermission (which covers FullAccess); this evaluator covers the two impersonation vectors that Phase 4 misses. Source: Office 365 Management Activity API (Audit.Exchange).',
        'permissions',
        'medium',
        'critical',
        'both',
        JSON.stringify({ ual_evaluator: 'sendas_grant' }),
      ]
    );
    console.log(`[UalEvaluators] Created alert policy "${POLICY_SENDAS_GRANT}" id=${id}`);
    _policyIdSendAsGrant = id;
  } else {
    _policyIdSendAsGrant = sa.id;
  }

  // ── Bundle D policies ────────────────────────────────────────────────

  // Microsoft Defender alert ingestion (force-multiplier — wraps Defender XDR
  // correlations through Panoptica's routing/AI/i18n pipeline)
  let dfa = await db.queryOne(
    'SELECT id FROM alert_policies WHERE name = ? LIMIT 1',
    [POLICY_DEFENDER_ALERT]
  );
  if (!dfa) {
    const id = await db.insert(
      `INSERT INTO alert_policies
         (name, description, category, severity, polling_tier, notification_target, detection_logic, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        POLICY_DEFENDER_ALERT,
        'Microsoft Defender XDR alert surfaced via the Office 365 Management Activity API. Wraps Microsoft\'s built-in detection engines (Defender for Endpoint, Defender for Office 365, Defender for Identity, Defender for Cloud Apps) through Panoptica\'s routing + AI analysis + i18n + MSP audit log + email/PSA integration. Severity inherited from Microsoft\'s classification (Informational/Low/Medium/High → info/low/medium/high). IncidentId captured for forward-compat with Bundle E (Graph Security API incident ingestion). Source: Office 365 Management Activity API (Audit.General, AlertEntityGenerated).',
        'threat_mgmt',
        'high',
        'critical',
        'both',
        JSON.stringify({ ual_evaluator: 'defender_alert' }),
      ]
    );
    console.log(`[UalEvaluators] Created alert policy "${POLICY_DEFENDER_ALERT}" id=${id}`);
    _policyIdDefenderAlert = id;
  } else {
    _policyIdDefenderAlert = dfa.id;
  }

  // Site collection administrator added (SharePoint privilege escalation)
  let sca = await db.queryOne(
    'SELECT id FROM alert_policies WHERE name = ? LIMIT 1',
    [POLICY_SITE_COLLECTION_ADMIN]
  );
  if (!sca) {
    const id = await db.insert(
      `INSERT INTO alert_policies
         (name, description, category, severity, polling_tier, notification_target, detection_logic, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        POLICY_SITE_COLLECTION_ADMIN,
        'A user was elevated to Site Collection Administrator on a SharePoint site. SharePoint-scope privilege escalation that bypasses Bundle A\'s tenant-role detection — attacker can scope a single site-collection admin to dodge tenant-level role assignment alerts. Common abuse pattern in SharePoint-heavy environments. Source: Office 365 Management Activity API (Audit.SharePoint, "Added site collection admin").',
        'permissions',
        'high',
        'critical',
        'both',
        JSON.stringify({ ual_evaluator: 'site_collection_admin' }),
      ]
    );
    console.log(`[UalEvaluators] Created alert policy "${POLICY_SITE_COLLECTION_ADMIN}" id=${id}`);
    _policyIdSiteCollectionAdmin = id;
  } else {
    _policyIdSiteCollectionAdmin = sca.id;
  }

  // Outbound connector created/modified (SMTP exfiltration setup)
  let oc2 = await db.queryOne(
    'SELECT id FROM alert_policies WHERE name = ? LIMIT 1',
    [POLICY_OUTBOUND_CONNECTOR]
  );
  if (!oc2) {
    const id = await db.insert(
      `INSERT INTO alert_policies
         (name, description, category, severity, polling_tier, notification_target, detection_logic, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        POLICY_OUTBOUND_CONNECTOR,
        'A tenant outbound connector was created, modified, or removed. Different layer than Bundle B/C transport rules — connectors operate at the mail-flow infrastructure layer (where mail leaves the org). Higher impact than rules: a single malicious outbound connector can exfiltrate the entire org\'s mail to attacker-controlled SMTP. Lower frequency than rule changes; legitimate connector changes are tied to hybrid Exchange / O365 transitions or third-party mail-routing setups. Source: Office 365 Management Activity API (Audit.Exchange, New-OutboundConnector / Set-OutboundConnector / Remove-OutboundConnector).',
        'threat_mgmt',
        'high',
        'critical',
        'both',
        JSON.stringify({ ual_evaluator: 'outbound_connector' }),
      ]
    );
    console.log(`[UalEvaluators] Created alert policy "${POLICY_OUTBOUND_CONNECTOR}" id=${id}`);
    _policyIdOutboundConnector = id;
  } else {
    _policyIdOutboundConnector = oc2.id;
  }

  // Mailbox disabled or removed (data destruction pattern)
  let mdr = await db.queryOne(
    'SELECT id FROM alert_policies WHERE name = ? LIMIT 1',
    [POLICY_MAILBOX_DESTRUCTION]
  );
  if (!mdr) {
    const id = await db.insert(
      `INSERT INTO alert_policies
         (name, description, category, severity, polling_tier, notification_target, detection_logic, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        POLICY_MAILBOX_DESTRUCTION,
        'A mailbox was disabled (Disable-Mailbox — disconnects from AD user, recoverable) or removed (Remove-Mailbox — permanent destruction unless soft-deleted). Data destruction pattern — insider sabotage on departure, ransomware-adjacent. Auto-attribution: when MSP audit log shows operator action within ±15 min of the cmdlet, alert flags auto_attributed=true (legitimate offboarding) so operators aren\'t pestered for routine work. Source: Office 365 Management Activity API (Audit.Exchange, Disable-Mailbox / Remove-Mailbox).',
        'info_governance',
        'high',
        'critical',
        'both',
        JSON.stringify({ ual_evaluator: 'mailbox_destruction', attribution_window_minutes: 15 }),
      ]
    );
    console.log(`[UalEvaluators] Created alert policy "${POLICY_MAILBOX_DESTRUCTION}" id=${id}`);
    _policyIdMailboxDestruction = id;
  } else {
    _policyIdMailboxDestruction = mdr.id;
  }

  // Org-wide Exchange config tamper
  let oct = await db.queryOne(
    'SELECT id FROM alert_policies WHERE name = ? LIMIT 1',
    [POLICY_ORG_CONFIG_TAMPER]
  );
  if (!oct) {
    const id = await db.insert(
      `INSERT INTO alert_policies
         (name, description, category, severity, polling_tier, notification_target, detection_logic, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        POLICY_ORG_CONFIG_TAMPER,
        'A Set-OrganizationConfig cmdlet modified one or more security-relevant org-wide properties: AutoForwardingEnabled (set to true = exfiltration policy hole), ModernAuthEnabled (set to false = MFA bypass via legacy basic auth), OAuth2ClientProfileEnabled, BlockMailboxRulesAffectedByModernAuthIssue, ConnectorsEnabled. Different from Bundle C-5 (single rule disabled) — this is the floor underneath the rules. Severity escalates to severe when ModernAuthEnabled flipped to False (MFA bypass setup) or AutoForwardingEnabled flipped to True (exfiltration). Source: Office 365 Management Activity API (Audit.Exchange, Set-OrganizationConfig).',
        'config_changes',
        'high',
        'critical',
        'both',
        JSON.stringify({ ual_evaluator: 'org_config_tamper' }),
      ]
    );
    console.log(`[UalEvaluators] Created alert policy "${POLICY_ORG_CONFIG_TAMPER}" id=${id}`);
    _policyIdOrgConfigTamper = id;
  } else {
    _policyIdOrgConfigTamper = oct.id;
  }

  // ── Bundle E policies ────────────────────────────────────────────────

  // MFA method tamper (account takeover finishing move)
  let mfa = await db.queryOne(
    'SELECT id FROM alert_policies WHERE name = ? LIMIT 1',
    [POLICY_MFA_METHOD_TAMPER]
  );
  if (!mfa) {
    const id = await db.insert(
      `INSERT INTO alert_policies
         (name, description, category, severity, polling_tier, notification_target, detection_logic, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        POLICY_MFA_METHOD_TAMPER,
        'An admin registered or removed an MFA / security-info method on behalf of another user. Account takeover finishing move: attacker compromises account, registers their own MFA method, removes the user\'s, and gains persistent access through password resets. Self-changes (operator==target) are suppressed (legitimate user managing own MFA). Auto-attribution against MSP audit log within ±15 min flags legitimate helpdesk activity. Severity escalates to severe when target is privileged. Source: Office 365 Management Activity API (Audit.AzureActiveDirectory, Update user / authentication method changes).',
        'permissions',
        'high',
        'critical',
        'both',
        JSON.stringify({ ual_evaluator: 'mfa_method_tamper', attribution_window_minutes: 15 }),
      ]
    );
    console.log(`[UalEvaluators] Created alert policy "${POLICY_MFA_METHOD_TAMPER}" id=${id}`);
    _policyIdMfaMethodTamper = id;
  } else {
    _policyIdMfaMethodTamper = mfa.id;
  }

  // Exchange role group membership (RBAC backdoor — separate from Entra roles)
  let erg = await db.queryOne(
    'SELECT id FROM alert_policies WHERE name = ? LIMIT 1',
    [POLICY_EXCHANGE_ROLE_GROUP]
  );
  if (!erg) {
    const id = await db.insert(
      `INSERT INTO alert_policies
         (name, description, category, severity, polling_tier, notification_target, detection_logic, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        POLICY_EXCHANGE_ROLE_GROUP,
        'A change to Exchange RBAC role group membership (Add-RoleGroupMember, Remove-RoleGroupMember, New-RoleGroup, Remove-RoleGroup). Exchange has its own RBAC system separate from Entra roles — Bundle A only watches Entra. Common backdoor: attacker adds themselves to Discovery Management for compliance-search powers, or to Organization Management for full Exchange control, neither of which appears in Entra role assignment audit. Severity escalates to severe for Organization Management or Discovery Management changes. Source: Office 365 Management Activity API (Audit.Exchange).',
        'permissions',
        'high',
        'critical',
        'both',
        JSON.stringify({ ual_evaluator: 'exchange_role_group' }),
      ]
    );
    console.log(`[UalEvaluators] Created alert policy "${POLICY_EXCHANGE_ROLE_GROUP}" id=${id}`);
    _policyIdExchangeRoleGroup = id;
  } else {
    _policyIdExchangeRoleGroup = erg.id;
  }

  // Per-mailbox audit tamper (counter-EXO-09 at per-mailbox level)
  let pmat = await db.queryOne(
    'SELECT id FROM alert_policies WHERE name = ? LIMIT 1',
    [POLICY_PER_MAILBOX_AUDIT_TAMPER]
  );
  if (!pmat) {
    const id = await db.insert(
      `INSERT INTO alert_policies
         (name, description, category, severity, polling_tier, notification_target, detection_logic, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        POLICY_PER_MAILBOX_AUDIT_TAMPER,
        'A Set-Mailbox cmdlet flipped AuditEnabled to False or AuditBypassEnabled to True on a specific mailbox. Counter-EXO-09 at the per-mailbox level: at the org level EXO-09 enforces the audit posture, but a targeted Set-Mailbox cmdlet can disable auditing on a single victim mailbox before damage is done — the "turn off the camera before the heist" pattern. Different from EXO-09\'s drift detection (which fires on bypass associations); this fires on the cmdlet event itself. Source: Office 365 Management Activity API (Audit.Exchange, Set-Mailbox).',
        'threat_mgmt',
        'high',
        'critical',
        'both',
        JSON.stringify({ ual_evaluator: 'per_mailbox_audit_tamper' }),
      ]
    );
    console.log(`[UalEvaluators] Created alert policy "${POLICY_PER_MAILBOX_AUDIT_TAMPER}" id=${id}`);
    _policyIdPerMailboxAuditTamper = id;
  } else {
    _policyIdPerMailboxAuditTamper = pmat.id;
  }

  // Admin-initiated password reset
  let apr = await db.queryOne(
    'SELECT id FROM alert_policies WHERE name = ? LIMIT 1',
    [POLICY_ADMIN_PASSWORD_RESET]
  );
  if (!apr) {
    const id = await db.insert(
      `INSERT INTO alert_policies
         (name, description, category, severity, polling_tier, notification_target, detection_logic, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        POLICY_ADMIN_PASSWORD_RESET,
        'An admin reset another user\'s password (operator != target). Helpdesk activity is legitimate; rogue or compromised admin resets are not. Auto-attribution against MSP audit log within ±15 min separates the two — when matched, alert flags auto_attributed=true. Self password changes (user changing own password) are suppressed. Source: Office 365 Management Activity API (Audit.AzureActiveDirectory, "Reset user password" / "Change user password").',
        'permissions',
        'medium',
        'critical',
        'both',
        JSON.stringify({ ual_evaluator: 'admin_password_reset', attribution_window_minutes: 15 }),
      ]
    );
    console.log(`[UalEvaluators] Created alert policy "${POLICY_ADMIN_PASSWORD_RESET}" id=${id}`);
    _policyIdAdminPasswordReset = id;
  } else {
    _policyIdAdminPasswordReset = apr.id;
  }

  // Per-mailbox legacy protocol re-enable (counter-Modern-Auth at per-mailbox level)
  let lpr = await db.queryOne(
    'SELECT id FROM alert_policies WHERE name = ? LIMIT 1',
    [POLICY_LEGACY_PROTOCOL_REENABLED]
  );
  if (!lpr) {
    const id = await db.insert(
      `INSERT INTO alert_policies
         (name, description, category, severity, polling_tier, notification_target, detection_logic, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        POLICY_LEGACY_PROTOCOL_REENABLED,
        'A Set-CASMailbox cmdlet re-enabled a legacy protocol (IMAP, POP, ActiveSync, EWS, MAPI) on a specific mailbox. Legacy protocols bypass Modern Auth + Conditional Access — they\'re the canonical MFA-bypass vector. Counter-ENT-09 at the per-mailbox level: at the org level Modern Auth security setting can be enforced, but per-mailbox CAS settings can re-enable legacy access for individual users without disturbing the org-wide setting. Severity escalates to severe when 2+ legacy protocols re-enabled simultaneously (clear attack pattern). Source: Office 365 Management Activity API (Audit.Exchange, Set-CASMailbox).',
        'threat_mgmt',
        'high',
        'critical',
        'both',
        JSON.stringify({ ual_evaluator: 'legacy_protocol_reenabled' }),
      ]
    );
    console.log(`[UalEvaluators] Created alert policy "${POLICY_LEGACY_PROTOCOL_REENABLED}" id=${id}`);
    _policyIdLegacyProtocolReenabled = id;
  } else {
    _policyIdLegacyProtocolReenabled = lpr.id;
  }

  // ── Bundle F policy ──────────────────────────────────────────────────

  // Microsoft Defender incident ingestion (correlated multi-alert stories)
  let dfi = await db.queryOne(
    'SELECT id FROM alert_policies WHERE name = ? LIMIT 1',
    [POLICY_DEFENDER_INCIDENT]
  );
  if (!dfi) {
    const id = await db.insert(
      `INSERT INTO alert_policies
         (name, description, category, severity, polling_tier, notification_target, detection_logic, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        POLICY_DEFENDER_INCIDENT,
        'A Microsoft Defender XDR incident — Microsoft\'s correlation of multiple Defender alerts into a single multi-stage attack story (e.g., phishing email + suspicious sign-in + new mailbox rule + external forwarding linked as one timeline). Different layer than Bundle D-1 Defender alerts (single events). Source: Microsoft Graph Security API (/v1.0/security/incidents). Severity inherited from Microsoft. Fires on (a) new incident arrival, (b) severity escalation on existing incident, (c) new alerts joined to existing incident.',
        'threat_mgmt',
        'high',
        'critical',
        'both',
        JSON.stringify({ ual_evaluator: 'defender_incident' }),
      ]
    );
    console.log(`[UalEvaluators] Created alert policy "${POLICY_DEFENDER_INCIDENT}" id=${id}`);
    _policyIdDefenderIncident = id;
  } else {
    _policyIdDefenderIncident = dfi.id;
  }
}

ensureUalAlertPolicies().catch((err) => {
  console.error('[UalEvaluators] ensureUalAlertPolicies failed at module load:', err.message);
});

// ──────────────────────────────────────────────────────────────────────
// Bundle C (May 6, 2026) — ual_burst_state table
// ──────────────────────────────────────────────────────────────────────
//
// Backs the mass-deletion burst evaluator (C-3). One row per (tenant, user,
// detection_id) — captures the last time we alerted on a burst for that
// combination and how big the burst was. Anti-flapping: if last_alerted_at is
// within the cooldown window, suppress further alerts on the same user/day.
//
// Schema deliberately tenant_id+user_id+detection_id keyed so future burst-
// shaped evaluators can reuse the same table without colliding.
let _burstSchemaReady = false;
async function ensureUalBurstStateSchema() {
  if (_burstSchemaReady) return;
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS ual_burst_state (
        tenant_id        INT UNSIGNED NOT NULL,
        user_id          VARCHAR(320) NOT NULL COMMENT 'UPN of the user the burst was attributed to',
        detection_id     VARCHAR(64)  NOT NULL COMMENT 'Evaluator key — e.g. mass_delete',
        last_alerted_at  DATETIME(3)  NOT NULL,
        last_count       INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Event count in the most recent burst',
        last_window_end  DATETIME(3)  DEFAULT NULL COMMENT 'creation_time of the latest event in the burst',
        updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (tenant_id, user_id, detection_id),
        INDEX idx_ual_burst_temporal (tenant_id, detection_id, last_alerted_at),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    _burstSchemaReady = true;
    console.log('[UalEvaluators] ual_burst_state schema ready');
  } catch (err) {
    console.error('[UalEvaluators] ensureUalBurstStateSchema failed:', err.message);
  }
}

ensureUalBurstStateSchema().catch((err) => {
  console.error('[UalEvaluators] ensureUalBurstStateSchema failed at module load:', err.message);
});

// ──────────────────────────────────────────────────────────────────────
// Helpers — UAL record parsers
// ──────────────────────────────────────────────────────────────────────

/**
 * Pull a Parameter value out of a Microsoft UAL record.
 * Microsoft uses a Parameters: [{Name, Value}, ...] array on cmdlet-driven
 * Exchange records. Case-insensitive on Name.
 */
function getParam(record, name) {
  const params = Array.isArray(record?.Parameters) ? record.Parameters : [];
  const want = String(name).toLowerCase();
  const hit = params.find(p => String(p?.Name || '').toLowerCase() === want);
  return hit?.Value;
}

/**
 * Parse an Add-MailboxPermission / Add-RecipientPermission record into the
 * fields the evaluator needs. Returns null if the record is malformed or
 * doesn't represent a permission grant we want to alert on.
 */
function parseMailboxPermissionRecord(record) {
  if (!record) return null;
  const operation = record.Operation;
  if (operation !== 'Add-MailboxPermission' && operation !== 'Add-RecipientPermission') {
    return null;
  }

  // Microsoft inconsistently fills these — fall back through likely names.
  const grantee =
    getParam(record, 'User')
    || getParam(record, 'Trustee')
    || getParam(record, 'AccessRightsGrantee')
    || null;
  const accessRights =
    getParam(record, 'AccessRights')
    || getParam(record, 'Permission')
    || null;
  // Prefer the most-canonical UPN form available. MailboxOwnerUPN is
  // always a UPN if present; ObjectId is usually a UPN on these records;
  // Identity is the cmdlet -Identity parameter value, often a SAM-style
  // short form ("soumissions" instead of "soumissions@cuisi.ca"). Using
  // the short form breaks the grantee-equals-owner self-grant check.
  const mailboxIdentity =
    record.MailboxOwnerUPN
    || record.ObjectId
    || getParam(record, 'Identity')
    || null;
  const operator = record.UserId || null;

  if (!grantee || !mailboxIdentity || !operator) return null;

  return {
    grantee: String(grantee),
    accessRights: String(accessRights || 'unspecified'),
    mailboxIdentity: String(mailboxIdentity),
    operator: String(operator),
    clientIp: record.ClientIP || null,
  };
}

/**
 * Decide whether a parsed mailbox-permission grant warrants an alert.
 *  - Self-grant (operator == grantee == owner): suppressed (admin updating
 *    their own mailbox permissions, not interesting)
 *  - Owner grants to themselves: suppressed (rare but benign)
 *  - Otherwise: alert. Severity inherited from policy unless we want to
 *    escalate to severe based on access rights (FullAccess, SendAs are
 *    higher value than ReadPermission, ChangePermission).
 */
function classifyMailboxPermission(parsed) {
  // Compare on local part when one side is short-form and the other is UPN —
  // Microsoft mixes formats freely on these records. "soumissions@cuisi.ca"
  // matches "soumissions". We don't worry about cross-domain collisions
  // because Add-MailboxPermission events are scoped to a single tenant.
  const localPart = (s) => String(s || '').toLowerCase().split('@')[0];
  const granteeLocal = localPart(parsed.grantee);
  const ownerLocal = localPart(parsed.mailboxIdentity);
  const operatorLocal = localPart(parsed.operator);

  // Self-grant heuristic: grantee == owner. Skip — owner already has access
  // to their own mailbox; granting to self is a no-op.
  if (granteeLocal && ownerLocal && granteeLocal === ownerLocal) {
    return { alert: false, reason: 'grantee equals mailbox owner — no privilege change' };
  }
  // Operator granting themselves access to their own mailbox: skip.
  if (granteeLocal === operatorLocal && operatorLocal === ownerLocal) {
    return { alert: false, reason: 'operator self-grant on own mailbox' };
  }

  // Severity escalation for high-value access rights.
  const rights = String(parsed.accessRights).toLowerCase();
  const isHighValue = /fullaccess|sendas|sendonbehalf|externalaccount/.test(rights);
  return {
    alert: true,
    severity: isHighValue ? 'severe' : 'high',
    reason: `${parsed.operator} granted ${parsed.accessRights} on ${parsed.mailboxIdentity} to ${parsed.grantee}`,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Evaluator: Add-MailboxPermission
// ──────────────────────────────────────────────────────────────────────

async function evaluateAddMailboxPermission(tenant, sinceTime, untilTime) {
  if (!_policyIdMailboxPerm) {
    console.warn('[UalEvaluators] mailbox-permission policy not yet bootstrapped; skipping');
    return { fired: 0, skipped: 0 };
  }

  const policy = await db.queryOne(
    'SELECT id, name, severity, category, notification_target, notification_limit, enabled FROM alert_policies WHERE id = ? LIMIT 1',
    [_policyIdMailboxPerm]
  );
  if (!policy) return { fired: 0, skipped: 0 };
  if (!policy.enabled) return { fired: 0, skipped: 0, disabled: true };

  const events = await ualEvents.lookupEvents({
    tenantId: tenant.id,
    since: sinceTime,
    until: untilTime,
    workload: 'Exchange',
    limit: 1000,
  });

  // Filter to permission-grant operations only — lookupEvents can take a
  // single operation filter, but we want both Add-MailboxPermission and
  // Add-RecipientPermission, so we filter in JS after a workload-scoped fetch.
  const candidates = events.filter(e =>
    e.operation === 'Add-MailboxPermission' || e.operation === 'Add-RecipientPermission'
  );

  let fired = 0;
  let skipped = 0;

  for (const event of candidates) {
    const record = event.raw_record;
    const parsed = parseMailboxPermissionRecord(record);
    if (!parsed) {
      skipped += 1;
      continue;
    }

    const decision = classifyMailboxPermission(parsed);
    if (!decision.alert) {
      skipped += 1;
      continue;
    }

    // Build the alert payload. Structured i18n via message_template_key +
    // params (per the Phase 9 i18n contract — alerts.message_format.<key>
    // entries in en/fr/es).
    const alertData = {
      dedup_key: `ual_mbx_perm:${event.id}`,
      severity: decision.severity,
      message: decision.reason, // English fallback for log lines
      raw_data: {
        message_template_key: 'ual_mailbox_permission_added',
        message_template_params: {
          ...buildPolicyNameParams(policy.name),
          operator: parsed.operator,
          grantee: parsed.grantee,
          mailbox: parsed.mailboxIdentity,
          accessRights: parsed.accessRights,
        },
        ual_event_id: event.id,
        ual_record_id: event.record_id,
        creation_time: event.creation_time,
        client_ip: parsed.clientIp,
        operator: parsed.operator,
        grantee: parsed.grantee,
        mailbox: parsed.mailboxIdentity,
        accessRights: parsed.accessRights,
        // For change-log auto-attribution match — UPN of the operator
        upn: parsed.operator,
      },
    };

    try {
      const result = await alertEngine.createOrUpdateAlert(tenant, policy, alertData);
      if (result?.isNew) fired += 1;
      else skipped += 1;
      // Fire-and-forget AI analysis + email/Teams notification + AI sev-
      // adjust pipeline (May 12, 2026 extract — see alert-engine.processNewAlert).
      // UAL alerts previously inserted silently with no Haiku and no email.
      if (result?.isNew) {
        alertEngine.processNewAlert(result, tenant).catch((e) => {
          console.error(`[UalEvaluators] processNewAlert failed for alert ${result.id}: ${e.message}`);
        });
      }
    } catch (err) {
      console.error(`[UalEvaluators] mailbox-permission alert insert failed for tenant ${tenant.id} event ${event.id}: ${err.message}`);
    }
  }

  return { fired, skipped };
}

// ──────────────────────────────────────────────────────────────────────
// Evaluator: Anomalous-geo File Access
// ──────────────────────────────────────────────────────────────────────

async function evaluateAnomalousGeoFileAccess(tenant, sinceTime, untilTime) {
  if (!_policyIdAnomGeoFile) {
    console.warn('[UalEvaluators] anomalous-geo-file policy not yet bootstrapped; skipping');
    return { fired: 0, skipped: 0, suppressed: 0 };
  }

  const policy = await db.queryOne(
    'SELECT id, name, severity, category, notification_target, notification_limit, enabled FROM alert_policies WHERE id = ? LIMIT 1',
    [_policyIdAnomGeoFile]
  );
  if (!policy) return { fired: 0, skipped: 0, suppressed: 0 };
  if (!policy.enabled) return { fired: 0, skipped: 0, suppressed: 0, disabled: true };

  // Allowed-countries derivation reuses the existing alert-engine helper
  // so UAL geo gating stays consistent with sign-in geo gating.
  let allowedCountries = [];
  try {
    const set = await alertEngine.deriveAllowedCountriesFromCa(tenant.tenant_id);
    allowedCountries = [...(set || [])];
  } catch (err) {
    console.warn(`[UalEvaluators] deriveAllowedCountriesFromCa failed for tenant ${tenant.id}: ${err.message}`);
  }

  // If the tenant has no allowlist (no CA geo-block policy), every country
  // is "normal" — nothing is anomalous, no alerts. Skip cleanly.
  if (allowedCountries.length === 0) {
    return { fired: 0, skipped: 0, suppressed: 0, reason: 'tenant has no CA-derived allowed countries' };
  }

  const events = await ualEvents.lookupEvents({
    tenantId: tenant.id,
    since: sinceTime,
    until: untilTime,
    workload: 'SharePoint',
    limit: 2000,
  });

  const candidates = events.filter(e =>
    e.operation === 'FileAccessed' || e.operation === 'FileDownloaded'
  );

  let fired = 0;
  let skipped = 0;
  let suppressed = 0;

  for (const event of candidates) {
    const record = event.raw_record;
    const userUpn = event.user_upn || record?.UserId || null;
    const eventIp = event.client_ip || record?.ClientIP || null;
    if (!userUpn) {
      skipped += 1;
      continue;
    }

    // Correlate against the cached signIn for this UPN around the event time.
    let correl;
    try {
      correl = await correlation.correlate({
        tenantId: tenant.id,
        userUpn,
        eventTime: event.creation_time,
        eventIp,
      });
    } catch (err) {
      console.warn(`[UalEvaluators] correlate() failed for tenant ${tenant.id} event ${event.id}: ${err.message}`);
      skipped += 1;
      continue;
    }

    // Without a matched sign-in we can't determine the country — skip.
    // This is a low-confidence path; not worth firing on weak attribution.
    if (!correl.matchedSignIn || !correl.matchedSignIn.country) {
      skipped += 1;
      continue;
    }

    const country = String(correl.matchedSignIn.country).toUpperCase();
    const isAnomalous = !allowedCountries.map(c => String(c).toUpperCase()).includes(country);
    if (!isAnomalous) {
      skipped += 1;
      continue;
    }

    // Anomalous geo. Run the suppression check — was it actually permitted
    // because the device is compliant?
    const suppressDecision = correlation.shouldSuppressGeoAlert({
      correlation: correl,
      allowedCountries,
    });
    if (suppressDecision.suppress) {
      suppressed += 1;
      continue;
    }

    // Build the alert.
    const fileName = record?.SourceFileName || record?.ObjectId || '(unknown file)';
    const sitePath = record?.SiteUrl || record?.SourceRelativeUrl || '';

    const alertData = {
      dedup_key: `ual_geo_file:${event.id}`,
      severity: policy.severity, // High by default; let policy carry it
      message: `${userUpn} ${event.operation} from ${country}: ${fileName}`,
      raw_data: {
        message_template_key: 'ual_file_access_anomalous_geo',
        message_template_params: {
          ...buildPolicyNameParams(policy.name),
          user: userUpn,
          country,
          city: correl.matchedSignIn.city || '',
          operation: event.operation,
          fileName,
        },
        ual_event_id: event.id,
        ual_record_id: event.record_id,
        creation_time: event.creation_time,
        operation: event.operation,
        user: userUpn,
        client_ip: eventIp,
        country,
        city: correl.matchedSignIn.city || null,
        is_compliant: correl.matchedSignIn.isCompliant,
        is_managed: correl.matchedSignIn.isManaged,
        ca_status: correl.matchedSignIn.caStatus,
        confidence: correl.confidence,
        file_name: fileName,
        site_path: sitePath,
        // Change-log auto-attribution
        upn: userUpn,
      },
    };

    try {
      const result = await alertEngine.createOrUpdateAlert(tenant, policy, alertData);
      if (result?.isNew) fired += 1;
      else skipped += 1;
      // Fire-and-forget AI analysis + email/Teams notification + AI sev-
      // adjust pipeline (May 12, 2026 extract — see alert-engine.processNewAlert).
      // UAL alerts previously inserted silently with no Haiku and no email.
      if (result?.isNew) {
        alertEngine.processNewAlert(result, tenant).catch((e) => {
          console.error(`[UalEvaluators] processNewAlert failed for alert ${result.id}: ${e.message}`);
        });
      }
    } catch (err) {
      console.error(`[UalEvaluators] anomalous-geo-file alert insert failed for tenant ${tenant.id} event ${event.id}: ${err.message}`);
    }
  }

  return { fired, skipped, suppressed };
}

// ──────────────────────────────────────────────────────────────────────
// Shared helpers — Audit.AzureActiveDirectory record parsing
// ──────────────────────────────────────────────────────────────────────

/**
 * Build a name → newValue map from a UAL ModifiedProperties array.
 * Microsoft's format: ModifiedProperties: [{ Name, OldValue, NewValue }, ...]
 * NewValue is sometimes a JSON-stringified array, sometimes a plain string.
 */
function modifiedPropertyMap(record) {
  const out = {};
  const props = Array.isArray(record?.ModifiedProperties) ? record.ModifiedProperties : [];
  for (const p of props) {
    if (p?.Name) out[p.Name] = p.NewValue;
  }
  return out;
}

/**
 * Find a target in the UAL Target[] array by Type code.
 * Microsoft's Type codes for Audit.AzureActiveDirectory:
 *   0 = Account/User string (User Principal Name format)
 *   2 = ServicePrincipal / Application (object ID)
 *   4 = Group
 *   5 = User
 *   6 = Other
 */
function findTarget(record, type) {
  const targets = Array.isArray(record?.Target) ? record.Target : [];
  return targets.find(t => t && (t.Type === type || t.type === type)) || null;
}

/**
 * High-risk OAuth scopes — when granted via consent these warrant severity
 * escalation. Comparison is case-insensitive substring match because Microsoft
 * occasionally varies prefix conventions (e.g. "https://graph.microsoft.com/Mail.Read").
 */
const HIGH_RISK_SCOPE_TOKENS = [
  'mail.read',
  'mail.readwrite',
  'mail.send',
  'files.read.all',
  'files.readwrite.all',
  'sites.read.all',
  'sites.readwrite.all',
  'offline_access',
  'full_access_as_app',
  'directory.read.all',
  'directory.readwrite.all',
  'user.read.all',
  'user.readwrite.all',
  'application.readwrite.all',
  'approleassignment.readwrite.all',
];

function isHighRiskScope(scope) {
  if (!scope) return false;
  const s = String(scope).toLowerCase();
  return HIGH_RISK_SCOPE_TOKENS.some(tok => s.includes(tok));
}

/**
 * Microsoft well-known role template IDs for the privileged-role evaluator.
 * Mapped to Panoptica severity. Only roles in this map fire alerts; unmapped
 * roles (low-priv readers, custom roles) are silently ignored.
 *
 * Reference: https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/permissions-reference
 */
const ROLE_PRIORITY = new Map([
  // Apex — full tenant control
  ['62e90394-69f5-4237-9190-012177145e10', { name: 'Global Administrator',                  severity: 'severe' }],
  ['e8611ab8-c189-46e8-94e1-60213ab1f814', { name: 'Privileged Role Administrator',         severity: 'severe' }],
  ['7be44c8a-adaf-4e2a-84d6-ab2649e08a13', { name: 'Privileged Authentication Administrator', severity: 'severe' }],
  ['194ae4cb-b126-40b2-bd5b-6091b380977d', { name: 'Security Administrator',                severity: 'severe' }],

  // High-leverage — application/identity-adjacent
  ['9b895d92-2cd3-44c7-9d02-a6ac2d5ea5c3', { name: 'Application Administrator',             severity: 'high' }],
  ['158c047a-c907-4556-b7ef-446551a6b5f7', { name: 'Cloud Application Administrator',       severity: 'high' }],
  ['29232cdf-9323-42fd-ade2-1d097af3e4de', { name: 'Exchange Administrator',                severity: 'high' }],
  ['f28a1f50-f6e7-4571-818b-6a12f2af6b6c', { name: 'SharePoint Administrator',              severity: 'high' }],
  ['69091246-20e8-4a56-aa4d-066075b2a7a8', { name: 'Teams Administrator',                   severity: 'high' }],
  ['966707d0-3269-4727-9be2-8c3a10f19b9d', { name: 'Password Administrator',                severity: 'high' }],
  ['b0f54661-2d74-4c50-afa3-1ec803f12efe', { name: 'Billing Administrator',                 severity: 'high' }],
  ['f023fd81-a637-4b56-95fd-791ac0226033', { name: 'Service Support Administrator',         severity: 'high' }],
  ['3a2c62db-5318-420d-8d74-23affee5d9d5', { name: 'Intune Administrator',                  severity: 'high' }],
  ['e6d1a23a-da11-4be4-9570-befc86d067a7', { name: 'Compliance Administrator',              severity: 'high' }],

  // Medium — operational privilege
  ['fe930be7-5e62-47db-91af-98c3a49a38b1', { name: 'User Administrator',                    severity: 'medium' }],
  ['729827e3-9c14-49f7-bb1b-9608f156bbb8', { name: 'Helpdesk Administrator',                severity: 'medium' }],
  ['790c1fb9-7f7d-4f88-86a1-ef1f95c05c1b', { name: 'Security Reader',                       severity: 'medium' }],
  ['f2ef992c-3afb-46b9-b7cf-a126ee74c451', { name: 'Global Reader',                         severity: 'medium' }],
]);

/**
 * Look up a role's severity by template ID OR display name. Microsoft sometimes
 * omits one or the other in older audit records; try both.
 * @returns {{name, severity}|null}
 */
function classifyRole({ templateId, displayName }) {
  if (templateId && ROLE_PRIORITY.has(String(templateId).toLowerCase())) {
    return ROLE_PRIORITY.get(String(templateId).toLowerCase());
  }
  if (displayName) {
    const want = String(displayName).toLowerCase();
    for (const [, info] of ROLE_PRIORITY) {
      if (info.name.toLowerCase() === want) return info;
    }
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────────
// Evaluator: OAuth consent / app role grant
// ──────────────────────────────────────────────────────────────────────

/**
 * Parse a consent / app-role-grant record.
 * Returns null if the record is malformed or doesn't represent a consent we
 * want to alert on.
 */
function parseConsentRecord(record) {
  if (!record) return null;
  const op = String(record.Operation || '').toLowerCase();
  const isConsent = op.startsWith('consent to application')
                 || op.startsWith('add app role assignment grant to user')
                 || op.startsWith('add delegated permission grant');
  if (!isConsent) return null;

  const operator = record.UserId || null;
  const props = modifiedPropertyMap(record);

  // Scopes: Microsoft puts them in a few different fields depending on the
  // exact operation. Try a few names.
  const scopesRaw =
    props['ConsentAction.Permissions']
    || props['Permissions']
    || props['Scopes']
    || '';
  const scopes = String(scopesRaw);

  // Admin vs user consent
  const isAdminConsentRaw = props['ConsentContext.IsAdminConsent'] || '';
  const isAdminConsent = /true/i.test(String(isAdminConsentRaw));

  // Target app — Type=2 is ServicePrincipal/Application in AAD audit records
  const appTarget = findTarget(record, 2);
  const appId = appTarget?.ID || record.ApplicationId || null;
  const appName =
    props['TargetId.ServicePrincipalNames']
    || props['TargetId.DisplayName']
    || appId
    || '(unknown app)';

  if (!operator || !appId) return null;

  // Detect high-risk scopes
  const highRisk = isHighRiskScope(scopes);

  return {
    operator: String(operator),
    appId: String(appId),
    appName: String(appName),
    scopes,
    isAdminConsent,
    highRiskScopes: highRisk,
    clientIp: record.ClientIP || null,
  };
}

function classifyConsent(parsed) {
  // Severity ladder:
  //   Admin consent + high-risk scopes → severe (apex OAuth phish pattern)
  //   Admin consent + safe scopes → high (still warrants visibility)
  //   User consent + high-risk scopes → high (user-only consent for risky scope is a tell)
  //   User consent + safe scopes → medium (background visibility)
  let severity;
  if (parsed.isAdminConsent && parsed.highRiskScopes) severity = 'severe';
  else if (parsed.isAdminConsent || parsed.highRiskScopes) severity = 'high';
  else severity = 'medium';

  return {
    alert: true,
    severity,
    reason: `${parsed.operator} ${parsed.isAdminConsent ? 'admin-consented' : 'consented'} to "${parsed.appName}" — scopes: ${parsed.scopes || '(none recorded)'}`,
  };
}

async function evaluateOauthConsent(tenant, sinceTime, untilTime) {
  if (!_policyIdOauthConsent) return { fired: 0, skipped: 0 };

  const policy = await db.queryOne(
    'SELECT id, name, severity, category, notification_target, notification_limit, enabled FROM alert_policies WHERE id = ? LIMIT 1',
    [_policyIdOauthConsent]
  );
  if (!policy) return { fired: 0, skipped: 0 };
  if (!policy.enabled) return { fired: 0, skipped: 0, disabled: true };

  const events = await ualEvents.lookupEvents({
    tenantId: tenant.id,
    since: sinceTime,
    until: untilTime,
    workload: 'AzureActiveDirectory',
    limit: 1000,
  });

  const candidates = events.filter(e => {
    const op = String(e.operation || '').toLowerCase();
    return op.startsWith('consent to application')
        || op.startsWith('add app role assignment grant to user')
        || op.startsWith('add delegated permission grant');
  });

  let fired = 0;
  let skipped = 0;

  for (const event of candidates) {
    const parsed = parseConsentRecord(event.raw_record);
    if (!parsed) { skipped += 1; continue; }
    const decision = classifyConsent(parsed);

    const alertData = {
      dedup_key: `ual_oauth_consent:${event.id}`,
      severity: decision.severity,
      message: decision.reason,
      raw_data: {
        message_template_key: 'ual_oauth_consent',
        message_template_params: {
          ...buildPolicyNameParams(policy.name),
          operator: parsed.operator,
          appName: parsed.appName,
          consentType: parsed.isAdminConsent ? 'admin' : 'user',
          scopes: parsed.scopes || '(none recorded)',
        },
        ual_event_id: event.id,
        ual_record_id: event.record_id,
        creation_time: event.creation_time,
        operator: parsed.operator,
        appId: parsed.appId,
        appName: parsed.appName,
        scopes: parsed.scopes,
        isAdminConsent: parsed.isAdminConsent,
        highRiskScopes: parsed.highRiskScopes,
        client_ip: parsed.clientIp,
        upn: parsed.operator,
        // Feature 8.9 §10.1 — deep-link this alert to the app's row in the
        // Applications tab, so marking it known-good (which auto-resolves this
        // alert) is one click for the operator.
        deepLink: { view: 'tenant-dashboard', tenantId: tenant.id, tab: 'applications', appId: parsed.appId },
      },
    };

    try {
      const result = await alertEngine.createOrUpdateAlert(tenant, policy, alertData);
      // Feature 8.9 §10.2 — a consent alert for a blessed (known-good) app is
      // inserted pre-resolved by createOrUpdateAlert (isAutoResolved). Don't run
      // the notify/AI pipeline on it — the operator already vouched for the app.
      if (result?.isNew && !result.isAutoResolved) fired += 1; else skipped += 1;
      // Fire-and-forget AI analysis + email/Teams notification + AI sev-
      // adjust pipeline (May 12, 2026 extract — see alert-engine.processNewAlert).
      if (result?.isNew && !result.isAutoResolved) {
        alertEngine.processNewAlert(result, tenant).catch((e) => {
          console.error(`[UalEvaluators] processNewAlert failed for alert ${result.id}: ${e.message}`);
        });
      }
    } catch (err) {
      console.error(`[UalEvaluators] oauth-consent alert insert failed for tenant ${tenant.id} event ${event.id}: ${err.message}`);
    }
  }

  return { fired, skipped };
}

// ──────────────────────────────────────────────────────────────────────
// Evaluator: Service principal credentials added
// ──────────────────────────────────────────────────────────────────────

function parseSpCredentialRecord(record) {
  if (!record) return null;
  const op = String(record.Operation || '').toLowerCase();
  const isCredentialAdd = op.startsWith('add service principal credentials')
                       || op.startsWith('update application – certificates and secrets management')
                       || op.startsWith('update application - certificates and secrets management')
                       || op.startsWith('update application certificates and secrets management')
                       || op.startsWith('add owner to service principal');
  if (!isCredentialAdd) return null;

  const operator = record.UserId || null;
  const props = modifiedPropertyMap(record);

  // Target app/SP
  const appTarget = findTarget(record, 2);
  const appId = appTarget?.ID || record.ObjectId || null;
  const appName =
    props['TargetId.ServicePrincipalNames']
    || props['TargetId.DisplayName']
    || appId
    || '(unknown service principal)';

  // Credential metadata. Microsoft includes a KeyDescription field with a
  // structured value like:
  //   [Name=foo, KeyIdentifier=..., KeyType=Password, KeyUsage=Verify, EndDate=2027-...]
  const keyDescRaw = props['KeyDescription'] || '';
  const keyDesc = String(keyDescRaw);
  const keyTypeMatch = /KeyType=([A-Za-z0-9]+)/.exec(keyDesc);
  const keyType = keyTypeMatch ? keyTypeMatch[1] : 'unspecified';
  const endDateMatch = /EndDate=([0-9TZ:.\-]+)/.exec(keyDesc);
  const endDate = endDateMatch ? endDateMatch[1] : null;

  if (!operator || !appId) return null;

  return {
    operator: String(operator),
    appId: String(appId),
    appName: String(appName),
    keyType,
    endDate,
    clientIp: record.ClientIP || null,
  };
}

async function evaluateSpCredentials(tenant, sinceTime, untilTime) {
  if (!_policyIdSpCredentials) return { fired: 0, skipped: 0 };

  const policy = await db.queryOne(
    'SELECT id, name, severity, category, notification_target, notification_limit, enabled FROM alert_policies WHERE id = ? LIMIT 1',
    [_policyIdSpCredentials]
  );
  if (!policy) return { fired: 0, skipped: 0 };
  if (!policy.enabled) return { fired: 0, skipped: 0, disabled: true };

  const events = await ualEvents.lookupEvents({
    tenantId: tenant.id,
    since: sinceTime,
    until: untilTime,
    workload: 'AzureActiveDirectory',
    limit: 1000,
  });

  const candidates = events.filter(e => {
    const op = String(e.operation || '').toLowerCase();
    return op.startsWith('add service principal credentials')
        || op.startsWith('update application – certificates and secrets management')
        || op.startsWith('update application - certificates and secrets management')
        || op.startsWith('update application certificates and secrets management');
  });

  let fired = 0;
  let skipped = 0;

  for (const event of candidates) {
    const parsed = parseSpCredentialRecord(event.raw_record);
    if (!parsed) { skipped += 1; continue; }

    // Always severe — these events are rare and apex persistence indicators.
    const alertData = {
      dedup_key: `ual_sp_creds:${event.id}`,
      severity: 'severe',
      message: `${parsed.operator} added ${parsed.keyType} credential to "${parsed.appName}"`,
      raw_data: {
        message_template_key: 'ual_sp_credentials_added',
        message_template_params: {
          ...buildPolicyNameParams(policy.name),
          operator: parsed.operator,
          appName: parsed.appName,
          keyType: parsed.keyType,
          endDate: parsed.endDate || '(no expiry recorded)',
        },
        ual_event_id: event.id,
        ual_record_id: event.record_id,
        creation_time: event.creation_time,
        operator: parsed.operator,
        appId: parsed.appId,
        appName: parsed.appName,
        keyType: parsed.keyType,
        endDate: parsed.endDate,
        client_ip: parsed.clientIp,
        upn: parsed.operator,
      },
    };

    try {
      const result = await alertEngine.createOrUpdateAlert(tenant, policy, alertData);
      if (result?.isNew) fired += 1; else skipped += 1;
      // Fire-and-forget AI analysis + email/Teams notification + AI sev-
      // adjust pipeline (May 12, 2026 extract — see alert-engine.processNewAlert).
      if (result?.isNew) {
        alertEngine.processNewAlert(result, tenant).catch((e) => {
          console.error(`[UalEvaluators] processNewAlert failed for alert ${result.id}: ${e.message}`);
        });
      }
    } catch (err) {
      console.error(`[UalEvaluators] sp-credentials alert insert failed for tenant ${tenant.id} event ${event.id}: ${err.message}`);
    }
  }

  return { fired, skipped };
}

// ──────────────────────────────────────────────────────────────────────
// Evaluator: Privileged role assignment (broadened from GA-only)
// ──────────────────────────────────────────────────────────────────────

function parseRoleAssignmentRecord(record) {
  if (!record) return null;
  const op = String(record.Operation || '').toLowerCase();
  if (!op.startsWith('add member to role')) return null;

  const operator = record.UserId || null;

  // Target user — Type=5 in AAD audit records
  const userTarget = findTarget(record, 5);
  const targetUser = userTarget?.ID || null;

  const props = modifiedPropertyMap(record);

  // Role identification — try template ID first, fall back to display name
  const templateIdRaw = props['Role.TemplateId'] || '';
  // ModifiedProperty values can be JSON-stringified arrays — extract the GUID.
  const templateIdMatch = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(String(templateIdRaw));
  const templateId = templateIdMatch ? templateIdMatch[1].toLowerCase() : null;

  const displayNameRaw = props['Role.DisplayName'] || '';
  // Strip surrounding quotes / brackets that Microsoft sometimes includes.
  const displayName = String(displayNameRaw).replace(/^[\[\]"']+|[\[\]"']+$/g, '');

  if (!operator || !targetUser) return null;

  return {
    operator: String(operator),
    targetUser: String(targetUser),
    templateId,
    displayName,
    clientIp: record.ClientIP || null,
  };
}

async function evaluatePrivilegedRoleAssignment(tenant, sinceTime, untilTime) {
  if (!_policyIdPrivilegedRole) return { fired: 0, skipped: 0 };

  const policy = await db.queryOne(
    'SELECT id, name, severity, category, notification_target, notification_limit, enabled FROM alert_policies WHERE id = ? LIMIT 1',
    [_policyIdPrivilegedRole]
  );
  if (!policy) return { fired: 0, skipped: 0 };
  if (!policy.enabled) return { fired: 0, skipped: 0, disabled: true };

  const events = await ualEvents.lookupEvents({
    tenantId: tenant.id,
    since: sinceTime,
    until: untilTime,
    workload: 'AzureActiveDirectory',
    limit: 1000,
  });

  const candidates = events.filter(e => {
    const op = String(e.operation || '').toLowerCase();
    return op.startsWith('add member to role');
  });

  let fired = 0;
  let skipped = 0;

  for (const event of candidates) {
    const parsed = parseRoleAssignmentRecord(event.raw_record);
    if (!parsed) { skipped += 1; continue; }

    const roleInfo = classifyRole({ templateId: parsed.templateId, displayName: parsed.displayName });
    if (!roleInfo) {
      // Role not in the priority list — skip silently. Custom roles, low-priv
      // readers, etc. — not worth alerting on per the strategy doc.
      skipped += 1;
      continue;
    }

    const alertData = {
      dedup_key: `ual_priv_role:${event.id}`,
      severity: roleInfo.severity,
      message: `${parsed.operator} assigned "${roleInfo.name}" to ${parsed.targetUser}`,
      raw_data: {
        message_template_key: 'ual_privileged_role_assigned',
        message_template_params: {
          ...buildPolicyNameParams(policy.name),
          operator: parsed.operator,
          targetUser: parsed.targetUser,
          roleName: roleInfo.name,
        },
        ual_event_id: event.id,
        ual_record_id: event.record_id,
        creation_time: event.creation_time,
        operator: parsed.operator,
        targetUser: parsed.targetUser,
        roleName: roleInfo.name,
        roleTemplateId: parsed.templateId,
        client_ip: parsed.clientIp,
        upn: parsed.operator,
      },
    };

    try {
      const result = await alertEngine.createOrUpdateAlert(tenant, policy, alertData);
      if (result?.isNew) fired += 1; else skipped += 1;
      // Fire-and-forget AI analysis + email/Teams notification + AI sev-
      // adjust pipeline (May 12, 2026 extract — see alert-engine.processNewAlert).
      if (result?.isNew) {
        alertEngine.processNewAlert(result, tenant).catch((e) => {
          console.error(`[UalEvaluators] processNewAlert failed for alert ${result.id}: ${e.message}`);
        });
      }
    } catch (err) {
      console.error(`[UalEvaluators] privileged-role alert insert failed for tenant ${tenant.id} event ${event.id}: ${err.message}`);
    }
  }

  return { fired, skipped };
}

// ──────────────────────────────────────────────────────────────────────
// Bundle B helpers — Audit.Exchange parameter extraction
// ──────────────────────────────────────────────────────────────────────

function extractDomain(addr) {
  if (!addr) return null;
  const m = String(addr).match(/@([^\s>;]+)/);
  return m ? m[1].toLowerCase() : null;
}

// MoveToFolder destinations that suggest evasion (auto-hide attacker mail)
const EVASION_FOLDERS = new Set([
  'deleted items',
  'deleteditems',
  'rss feeds',
  'rssfeeds',
  'rss subscriptions',
  'junk email',
  'junkemail',
  'archive',
  'conversation history',
]);

function isEvasionFolder(folderName) {
  if (!folderName) return false;
  return EVASION_FOLDERS.has(String(folderName).toLowerCase().trim());
}

// ──────────────────────────────────────────────────────────────────────
// Evaluator: Transport Rule changed
// ──────────────────────────────────────────────────────────────────────

function parseTransportRuleRecord(record) {
  if (!record) return null;
  const op = String(record.Operation || '');
  const knownOps = new Set([
    'New-TransportRule', 'Set-TransportRule', 'Remove-TransportRule',
    'Enable-TransportRule', 'Disable-TransportRule',
  ]);
  if (!knownOps.has(op)) return null;

  const operator = record.UserId || null;
  if (!operator) return null;

  const ruleName = getParam(record, 'Name') || getParam(record, 'Identity') || '(unnamed)';
  const bcc = getParam(record, 'BlindCopyTo');
  const redirect = getParam(record, 'RedirectMessageTo');
  const moderator = getParam(record, 'ModerateMessageByUser');
  const subjectPrefix = getParam(record, 'PrependSubject') || getParam(record, 'SetSubjectPrefix');

  return {
    operation: op,
    operator: String(operator),
    ruleName: String(ruleName),
    blindCopyTo: bcc ? String(bcc) : null,
    redirectMessageTo: redirect ? String(redirect) : null,
    moderateBy: moderator ? String(moderator) : null,
    subjectPrefix: subjectPrefix ? String(subjectPrefix) : null,
    clientIp: record.ClientIP || null,
  };
}

function classifyTransportRule(parsed) {
  const hasForwardingAction = parsed.blindCopyTo || parsed.redirectMessageTo;
  return {
    severity: hasForwardingAction ? 'severe' : 'high',
    forwardingTarget: parsed.blindCopyTo || parsed.redirectMessageTo || null,
  };
}

/**
 * Break-Glass Governance — SEVERE alert on any sign-in by a designated
 * emergency-access account. Matches UAL `UserLoggedIn` events against the
 * tenant's break-glass roster (by UPN and object id). UAL-based on purpose: it
 * works even without Entra P1 (directory sign-in logs 403 on Business Standard).
 * One alert per distinct sign-in event (dedup on the UAL event id).
 */
/**
 * Break-Glass Governance — continuous coverage check. Fires HIGH when the
 * tenant's break-glass GROUP is no longer excluded from every enforceable CA
 * policy (a removed exclusion, or a new policy without it). Runs only for
 * tenants that have a break-glass group configured, so it adds zero Graph load
 * for everyone else. Not UAL-dependent — invoked from the unconditional
 * pre-cutover block in runEvaluators. One alert per tenant (dedup), updated
 * each cycle; the operator resolves it after re-applying the exclusion.
 */
async function evaluateBreakGlassCoverage(tenant) {
  if (!_policyIdBreakGlassCoverage) return { fired: 0, skipped: 0 };

  // Gate FIRST on a configured group — no group ⇒ one cheap DB read, no Graph.
  let group;
  try { group = await accessReviewStore.getGroupConfig(tenant.id); }
  catch (e) { return { fired: 0, skipped: 0, error: e.message }; }
  if (!group) return { fired: 0, skipped: 0 };

  const policy = await db.queryOne(
    'SELECT id, name, severity, category, notification_target, notification_limit, enabled FROM alert_policies WHERE id = ? LIMIT 1',
    [_policyIdBreakGlassCoverage]
  );
  if (!policy || !policy.enabled) return { fired: 0, skipped: 0, disabled: !policy || !policy.enabled };

  // Need the Azure GUID for Graph; the evaluator tenant may carry only the DB id.
  let guid = tenant.tenant_id;
  if (!guid) {
    const t = await db.queryOne('SELECT tenant_id FROM tenants WHERE id = ? LIMIT 1', [tenant.id]);
    guid = t && t.tenant_id;
  }
  if (!guid) return { fired: 0, skipped: 0 };

  let cov;
  try {
    // Security Defaults ⇒ no CA to cover; nothing to alert on.
    if (await bgGraph.securityDefaultsEnabled(guid)) return { fired: 0, skipped: 0, securityDefaults: true };
    cov = await bgGraph.coverage(guid, group.group_id);
  } catch (e) {
    return { fired: 0, skipped: 0, error: e.message };
  }
  if (!cov || cov.total === 0 || !cov.gaps.length) return { fired: 0, skipped: 0 };

  const gapNames = cov.gaps.map(g => g.name).filter(Boolean);
  const alertData = {
    dedup_key: `bg_coverage_gap:${tenant.id}`,
    severity: 'high',
    message: `Break-glass group "${group.group_name || group.group_id}" is excluded from only ${cov.covered} of ${cov.total} Conditional Access policies`,
    raw_data: {
      message_template_key: 'bg_coverage_gap',
      message_template_params: {
        ...buildPolicyNameParams(policy.name),
        group: group.group_name || '',
        covered: cov.covered,
        total: cov.total,
        gaps: gapNames.join(', '),
      },
      group_id: group.group_id,
      group_name: group.group_name,
      covered: cov.covered,
      total: cov.total,
      gaps: cov.gaps,
    },
  };

  try {
    const result = await alertEngine.createOrUpdateAlert(tenant, policy, alertData);
    if (result?.isNew) {
      alertEngine.processNewAlert(result, tenant).catch((e) => {
        console.error(`[UalEvaluators] processNewAlert failed for alert ${result.id}: ${e.message}`);
      });
      return { fired: 1, skipped: 0 };
    }
    return { fired: 0, skipped: 1 };
  } catch (err) {
    console.error(`[UalEvaluators] break-glass coverage alert insert failed for tenant ${tenant.id}: ${err.message}`);
    return { fired: 0, skipped: 0, error: err.message };
  }
}

async function evaluateBreakGlassSignin(tenant, sinceTime, untilTime) {
  if (!_policyIdBreakGlassSignin) return { fired: 0, skipped: 0 };

  const policy = await db.queryOne(
    'SELECT id, name, severity, category, notification_target, notification_limit, enabled FROM alert_policies WHERE id = ? LIMIT 1',
    [_policyIdBreakGlassSignin]
  );
  if (!policy) return { fired: 0, skipped: 0 };
  if (!policy.enabled) return { fired: 0, skipped: 0, disabled: true };

  // Roster of break-glass accounts for this tenant. No accounts ⇒ nothing to do.
  let bgAccounts = [];
  try { bgAccounts = await accessReviewStore.listBreakGlass(tenant.id); }
  catch (e) { return { fired: 0, skipped: 0, error: e.message }; }
  if (!bgAccounts.length) return { fired: 0, skipped: 0 };

  // Narrow to UserLoggedIn at the DB layer (these are high-volume; the roster
  // match keeps only the rare emergency-account sign-ins).
  const events = await ualEvents.lookupEvents({
    tenantId: tenant.id,
    since: sinceTime,
    until: untilTime,
    workload: 'AzureActiveDirectory',
    operation: 'UserLoggedIn',
    limit: 1000,
  });
  if (!events.length) return { fired: 0, skipped: 0 };

  // UAL UserLoggedIn records identify the signer by UPN (both record.UserId and
  // UserPrincipalName are the UPN — there's no object id in the normalized
  // event). An operator can move the account's domain (UPN changes) while the
  // object id stays put, so we build the match set from BOTH the stored UPN AND
  // the CURRENT UPN resolved live from the stable object id. Resolved only now
  // that we know there are sign-in events to check (keeps quiet cycles free of
  // Graph calls), best-effort per account.
  let guid = tenant.tenant_id;
  if (!guid) {
    const t = await db.queryOne('SELECT tenant_id FROM tenants WHERE id = ? LIMIT 1', [tenant.id]);
    guid = t && t.tenant_id;
  }
  const bgByUpn = new Map(); // lowercased UPN → account (stored + current)
  for (const a of bgAccounts) {
    if (a.user_principal_name) bgByUpn.set(String(a.user_principal_name).toLowerCase(), a);
    if (guid && a.user_id) {
      try {
        const live = await bgGraph.getUserById(guid, a.user_id);
        if (live && live.userPrincipalName) bgByUpn.set(String(live.userPrincipalName).toLowerCase(), a);
      } catch (e) { /* best-effort current-UPN resolve; stored UPN still matched */ }
    }
  }

  let fired = 0;
  let skipped = 0;

  for (const event of events) {
    const upn = String(event.user_upn || '').toLowerCase();
    const acct = bgByUpn.get(upn) || bgByUpn.get(String(event.user_id || '').toLowerCase());
    if (!acct) { skipped += 1; continue; }
    const displayUpn = event.user_upn || acct.user_principal_name || upn;

    // Dedup per ACCOUNT per DAY, not per event: a single interactive sign-in
    // emits a burst of UserLoggedIn records (one per resource/app), and per-event
    // keys would raise a stack of SEVERE alerts + tickets for one sign-in. With
    // this key the burst (and repeat sign-ins the same day) collapse into one
    // alert whose recurrence_count ticks up; a sign-in on a later day — or after
    // the operator resolves it — raises a fresh one. Keyed on the stable object
    // id so a UPN/domain change doesn't split it.
    const dayKey = String(event.creation_time || '').slice(0, 10);
    const alertData = {
      dedup_key: `ual_breakglass_signin:${acct.user_id || upn}:${dayKey}`,
      severity: 'severe',
      message: `Break-glass account ${displayUpn} signed in${event.client_ip ? ' from ' + event.client_ip : ''}`,
      raw_data: {
        message_template_key: 'ual_breakglass_signin',
        message_template_params: {
          ...buildPolicyNameParams(policy.name),
          upn: displayUpn,
          clientIp: event.client_ip || '',
        },
        ual_event_id: event.id,
        ual_record_id: event.record_id,
        creation_time: event.creation_time,
        upn: displayUpn,
        client_ip: event.client_ip || null,
      },
    };

    try {
      const result = await alertEngine.createOrUpdateAlert(tenant, policy, alertData);
      if (result?.isNew) {
        fired += 1;
        // Notifier + PSA ticket + AI live in processNewAlert (imperative
        // producers must call it themselves — feedback_imperative_alerts_need_processnewalert).
        alertEngine.processNewAlert(result, tenant).catch((e) => {
          console.error(`[UalEvaluators] processNewAlert failed for alert ${result.id}: ${e.message}`);
        });
      } else skipped += 1;
    } catch (err) {
      console.error(`[UalEvaluators] break-glass signin alert insert failed for tenant ${tenant.id} event ${event.id}: ${err.message}`);
    }
  }

  return { fired, skipped };
}

async function evaluateTransportRule(tenant, sinceTime, untilTime) {
  if (!_policyIdTransportRule) return { fired: 0, skipped: 0 };
  const policy = await db.queryOne(
    'SELECT id, name, severity, category, notification_target, notification_limit, enabled FROM alert_policies WHERE id = ? LIMIT 1',
    [_policyIdTransportRule]
  );
  if (!policy) return { fired: 0, skipped: 0 };
  if (!policy.enabled) return { fired: 0, skipped: 0, disabled: true };

  const events = await ualEvents.lookupEvents({
    tenantId: tenant.id, since: sinceTime, until: untilTime,
    workload: 'Exchange', limit: 1000,
  });
  const candidates = events.filter(e => /^(New|Set|Remove|Enable|Disable)-TransportRule$/.test(e.operation || ''));

  let fired = 0, skipped = 0;
  for (const event of candidates) {
    const parsed = parseTransportRuleRecord(event.raw_record);
    if (!parsed) { skipped += 1; continue; }
    const decision = classifyTransportRule(parsed);

    const alertData = {
      dedup_key: `ual_transport_rule:${event.id}`,
      severity: decision.severity,
      message: `${parsed.operator} ${parsed.operation} "${parsed.ruleName}"${decision.forwardingTarget ? ' → ' + decision.forwardingTarget : ''}`,
      raw_data: {
        message_template_key: 'ual_transport_rule_changed',
        message_template_params: {
          ...buildPolicyNameParams(policy.name),
          operator: parsed.operator,
          operation: parsed.operation,
          ruleName: parsed.ruleName,
          forwardingTarget: decision.forwardingTarget || '(none)',
        },
        ual_event_id: event.id,
        ual_record_id: event.record_id,
        creation_time: event.creation_time,
        operator: parsed.operator,
        operation: parsed.operation,
        ruleName: parsed.ruleName,
        blindCopyTo: parsed.blindCopyTo,
        redirectMessageTo: parsed.redirectMessageTo,
        client_ip: parsed.clientIp,
        upn: parsed.operator,
      },
    };

    try {
      const result = await alertEngine.createOrUpdateAlert(tenant, policy, alertData);
      if (result?.isNew) fired += 1; else skipped += 1;
      // Fire-and-forget AI analysis + email/Teams notification + AI sev-
      // adjust pipeline (May 12, 2026 extract — see alert-engine.processNewAlert).
      if (result?.isNew) {
        alertEngine.processNewAlert(result, tenant).catch((e) => {
          console.error(`[UalEvaluators] processNewAlert failed for alert ${result.id}: ${e.message}`);
        });
      }
    } catch (err) {
      console.error(`[UalEvaluators] transport-rule alert insert failed for tenant ${tenant.id} event ${event.id}: ${err.message}`);
    }
  }
  return { fired, skipped };
}

// ──────────────────────────────────────────────────────────────────────
// Evaluator: Set-Mailbox forwarding (UAL-enriched)
// ──────────────────────────────────────────────────────────────────────

function parseMailboxForwardingRecord(record) {
  if (!record) return null;
  if (record.Operation !== 'Set-Mailbox') return null;

  const fwdSmtp = getParam(record, 'ForwardingSmtpAddress');
  const fwdAddr = getParam(record, 'ForwardingAddress');
  // Skip when no forwarding parameter was touched, OR when both are explicitly
  // empty (user cleared forwarding — that's a removal, not a new threat).
  const hasFwd = (fwdSmtp && String(fwdSmtp).trim() !== '' && String(fwdSmtp).trim() !== '$null')
              || (fwdAddr && String(fwdAddr).trim() !== '' && String(fwdAddr).trim() !== '$null');
  if (!hasFwd) return null;

  const operator = record.UserId || null;
  const mailbox = getParam(record, 'Identity') || record.MailboxOwnerUPN || record.ObjectId || null;
  if (!operator || !mailbox) return null;

  // Extract a clean SMTP destination. Forwarding parameters can be:
  //   - Plain email: user@example.com
  //   - SMTP-prefixed: smtp:user@example.com
  //   - Recipient object name: "John Smith"  (when ForwardingAddress is set
  //     to an existing mailbox/contact rather than an SMTP literal)
  const rawDest = String(fwdSmtp || fwdAddr).replace(/^smtp:/i, '').trim();
  const destDomain = extractDomain(rawDest);
  const mailboxDomain = extractDomain(mailbox);
  const isExternal = destDomain && mailboxDomain && destDomain !== mailboxDomain;

  return {
    operator: String(operator),
    mailbox: String(mailbox),
    destination: rawDest,
    destDomain,
    mailboxDomain,
    isExternal,
    clientIp: record.ClientIP || null,
  };
}

async function evaluateMailboxForwarding(tenant, sinceTime, untilTime) {
  if (!_policyIdMailboxFwd) return { fired: 0, skipped: 0 };
  const policy = await db.queryOne(
    'SELECT id, name, severity, category, notification_target, notification_limit, enabled FROM alert_policies WHERE id = ? LIMIT 1',
    [_policyIdMailboxFwd]
  );
  if (!policy) return { fired: 0, skipped: 0 };
  if (!policy.enabled) return { fired: 0, skipped: 0, disabled: true };

  const events = await ualEvents.lookupEvents({
    tenantId: tenant.id, since: sinceTime, until: untilTime,
    workload: 'Exchange', limit: 1000,
  });
  const candidates = events.filter(e => e.operation === 'Set-Mailbox');

  let fired = 0, skipped = 0;
  for (const event of candidates) {
    const parsed = parseMailboxForwardingRecord(event.raw_record);
    if (!parsed) { skipped += 1; continue; }

    const severity = parsed.isExternal ? 'severe' : 'high';

    const alertData = {
      dedup_key: `ual_mbx_fwd:${event.id}`,
      severity,
      message: `${parsed.operator} set forwarding on ${parsed.mailbox} → ${parsed.destination}${parsed.isExternal ? ' (external domain)' : ''}`,
      raw_data: {
        message_template_key: 'ual_mailbox_forwarding_set',
        message_template_params: {
          ...buildPolicyNameParams(policy.name),
          operator: parsed.operator,
          mailbox: parsed.mailbox,
          destination: parsed.destination,
          domainScope: parsed.isExternal ? 'external' : 'internal',
        },
        ual_event_id: event.id,
        ual_record_id: event.record_id,
        creation_time: event.creation_time,
        operator: parsed.operator,
        mailbox: parsed.mailbox,
        destination: parsed.destination,
        destDomain: parsed.destDomain,
        mailboxDomain: parsed.mailboxDomain,
        isExternal: parsed.isExternal,
        client_ip: parsed.clientIp,
        upn: parsed.operator,
      },
    };

    try {
      const result = await alertEngine.createOrUpdateAlert(tenant, policy, alertData);
      if (result?.isNew) fired += 1; else skipped += 1;
      // Fire-and-forget AI analysis + email/Teams notification + AI sev-
      // adjust pipeline (May 12, 2026 extract — see alert-engine.processNewAlert).
      if (result?.isNew) {
        alertEngine.processNewAlert(result, tenant).catch((e) => {
          console.error(`[UalEvaluators] processNewAlert failed for alert ${result.id}: ${e.message}`);
        });
      }
    } catch (err) {
      console.error(`[UalEvaluators] mailbox-forwarding alert insert failed for tenant ${tenant.id} event ${event.id}: ${err.message}`);
    }
  }
  return { fired, skipped };
}

// ──────────────────────────────────────────────────────────────────────
// Evaluator: Inbox rule changed (UAL-enriched)
// ──────────────────────────────────────────────────────────────────────

function parseInboxRuleRecord(record) {
  if (!record) return null;
  const op = String(record.Operation || '');
  const knownOps = new Set([
    'New-InboxRule', 'Set-InboxRule', 'Update-InboxRule',
    'Enable-InboxRule', 'Disable-InboxRule',
  ]);
  if (!knownOps.has(op)) return null;

  const operator = record.UserId || null;
  // The mailbox the rule belongs to. Microsoft writes it on the record either
  // as MailboxOwnerUPN (newer schema) or via the -Mailbox cmdlet parameter on
  // older records.
  const mailbox = record.MailboxOwnerUPN
                || getParam(record, 'Mailbox')
                || record.ObjectId
                || null;
  if (!operator || !mailbox) return null;

  const ruleName = getParam(record, 'Name') || getParam(record, 'Identity') || '(unnamed)';
  const forwardTo = getParam(record, 'ForwardTo');
  const forwardAsAttachmentTo = getParam(record, 'ForwardAsAttachmentTo');
  const redirectTo = getParam(record, 'RedirectTo');
  const moveToFolder = getParam(record, 'MoveToFolder');
  const deleteMessage = getParam(record, 'DeleteMessage');
  // DeleteMessage may be a string ('True'/'False') depending on Microsoft's
  // schema variation; coerce to boolean.
  const deletesMail = /true/i.test(String(deleteMessage || ''));

  return {
    operation: op,
    operator: String(operator),
    mailbox: String(mailbox),
    ruleName: String(ruleName),
    forwardTo: forwardTo ? String(forwardTo) : null,
    forwardAsAttachmentTo: forwardAsAttachmentTo ? String(forwardAsAttachmentTo) : null,
    redirectTo: redirectTo ? String(redirectTo) : null,
    moveToFolder: moveToFolder ? String(moveToFolder) : null,
    deletesMail,
    clientIp: record.ClientIP || null,
  };
}

function classifyInboxRule(parsed) {
  const localPart = (s) => String(s || '').toLowerCase().split('@')[0];
  const operatorIsOther = localPart(parsed.operator) !== localPart(parsed.mailbox);
  const hasForwardingAction = !!(parsed.forwardTo || parsed.forwardAsAttachmentTo || parsed.redirectTo);
  const hasEvasionFolder = isEvasionFolder(parsed.moveToFolder);

  let severity, severityReason;
  if (operatorIsOther) {
    severity = 'severe';
    severityReason = 'operator differs from mailbox owner — admin or compromised account modifying someone else\'s rules';
  } else if (hasForwardingAction || parsed.deletesMail) {
    severity = 'severe';
    severityReason = parsed.deletesMail
      ? 'rule auto-deletes mail (evidence destruction pattern)'
      : 'rule forwards/redirects mail (exfiltration pattern)';
  } else if (hasEvasionFolder) {
    severity = 'high';
    severityReason = `rule moves mail to ${parsed.moveToFolder} (evasion pattern)`;
  } else {
    severity = 'medium';
    severityReason = 'inbox rule change without forwarding/deletion/evasion patterns';
  }

  return { severity, severityReason, operatorIsOther, hasForwardingAction, hasEvasionFolder };
}

async function evaluateInboxRuleUal(tenant, sinceTime, untilTime) {
  if (!_policyIdInboxRuleUal) return { fired: 0, skipped: 0 };
  const policy = await db.queryOne(
    'SELECT id, name, severity, category, notification_target, notification_limit, enabled FROM alert_policies WHERE id = ? LIMIT 1',
    [_policyIdInboxRuleUal]
  );
  if (!policy) return { fired: 0, skipped: 0 };
  if (!policy.enabled) return { fired: 0, skipped: 0, disabled: true };

  const events = await ualEvents.lookupEvents({
    tenantId: tenant.id, since: sinceTime, until: untilTime,
    workload: 'Exchange', limit: 2000,
  });
  const candidates = events.filter(e => /^(New|Set|Update|Enable|Disable)-InboxRule$/.test(e.operation || ''));

  let fired = 0, skipped = 0;
  for (const event of candidates) {
    const parsed = parseInboxRuleRecord(event.raw_record);
    if (!parsed) { skipped += 1; continue; }
    const decision = classifyInboxRule(parsed);

    const fwdTarget = parsed.forwardTo || parsed.redirectTo || parsed.forwardAsAttachmentTo;

    const alertData = {
      dedup_key: `ual_inbox_rule:${event.id}`,
      severity: decision.severity,
      message: `${parsed.operator} ${parsed.operation} "${parsed.ruleName}" on ${parsed.mailbox} — ${decision.severityReason}`,
      raw_data: {
        message_template_key: 'ual_inbox_rule_changed',
        message_template_params: {
          ...buildPolicyNameParams(policy.name),
          operator: parsed.operator,
          operation: parsed.operation,
          ruleName: parsed.ruleName,
          mailbox: parsed.mailbox,
          severityReason: decision.severityReason,
        },
        ual_event_id: event.id,
        ual_record_id: event.record_id,
        creation_time: event.creation_time,
        operator: parsed.operator,
        operation: parsed.operation,
        ruleName: parsed.ruleName,
        mailbox: parsed.mailbox,
        forwardTo: parsed.forwardTo,
        redirectTo: parsed.redirectTo,
        moveToFolder: parsed.moveToFolder,
        deletesMail: parsed.deletesMail,
        operatorIsOther: decision.operatorIsOther,
        forwardingTarget: fwdTarget,
        client_ip: parsed.clientIp,
        upn: parsed.operator,
      },
    };

    try {
      const result = await alertEngine.createOrUpdateAlert(tenant, policy, alertData);
      if (result?.isNew) fired += 1; else skipped += 1;
      // Fire-and-forget AI analysis + email/Teams notification + AI sev-
      // adjust pipeline (May 12, 2026 extract — see alert-engine.processNewAlert).
      if (result?.isNew) {
        alertEngine.processNewAlert(result, tenant).catch((e) => {
          console.error(`[UalEvaluators] processNewAlert failed for alert ${result.id}: ${e.message}`);
        });
      }
    } catch (err) {
      console.error(`[UalEvaluators] inbox-rule-ual alert insert failed for tenant ${tenant.id} event ${event.id}: ${err.message}`);
    }
  }
  return { fired, skipped };
}

// ══════════════════════════════════════════════════════════════════════
// Bundle C (May 6, 2026) — SharePoint, Compliance, Identity-tampering
// ══════════════════════════════════════════════════════════════════════

// ──────────────────────────────────────────────────────────────────────
// Evaluator: AnonymousLink creation (SharePoint "anyone with the link")
// ──────────────────────────────────────────────────────────────────────
//
// Two operations capture this surface:
//   - AnonymousLinkCreated — direct anonymous-link creation
//   - SharingSet — generic sharing event; we only fire when TargetUserOrGroupType
//                  is Anonymous or Everyone (Microsoft's terminology for
//                  unauthenticated access)
//
// This is the top SMB exfiltration vector. Severity is medium baseline.
// v2 candidate: site-sensitivity tagging to escalate to high when the resource
// lives in a sensitive site (legal, HR, finance) — defer until we have a
// site-classification surface.

const ANON_TARGET_TYPES = new Set(['Anonymous', 'Everyone', 'Guest']);

function parseAnonymousLinkRecord(record) {
  if (!record) return null;
  const op = record.Operation;
  if (op !== 'AnonymousLinkCreated' && op !== 'SharingSet') return null;

  // SharingSet fires on every share — only the anonymous variants are interesting.
  // TargetUserOrGroupType is the canonical field; fall back through likely names.
  const targetType =
    record.TargetUserOrGroupType
    || record.TargetUserType
    || (record.SharingType && /anonymous|everyone|guest/i.test(record.SharingType) ? record.SharingType : null);

  if (op === 'SharingSet' && !ANON_TARGET_TYPES.has(String(targetType || ''))) {
    return null;
  }

  const operator = record.UserId || null;
  if (!operator) return null;

  const resourceUrl =
    record.ObjectId
    || record.SourceFileName
    || record.SiteUrl
    || '(unknown resource)';
  const fileName = record.SourceFileName || record.SourceRelativeUrl || resourceUrl;
  const sitePath = record.SiteUrl || '';

  return {
    operation: String(op),
    operator: String(operator),
    targetType: String(targetType || 'Anonymous'),
    resourceUrl: String(resourceUrl),
    fileName: String(fileName),
    sitePath: String(sitePath),
    clientIp: record.ClientIP || null,
  };
}

async function evaluateAnonymousLink(tenant, sinceTime, untilTime) {
  if (!_policyIdAnonymousLink) return { fired: 0, skipped: 0 };
  const policy = await db.queryOne(
    'SELECT id, name, severity, category, notification_target, notification_limit, enabled FROM alert_policies WHERE id = ? LIMIT 1',
    [_policyIdAnonymousLink]
  );
  if (!policy) return { fired: 0, skipped: 0 };
  if (!policy.enabled) return { fired: 0, skipped: 0, disabled: true };

  const events = await ualEvents.lookupEvents({
    tenantId: tenant.id, since: sinceTime, until: untilTime,
    workload: 'SharePoint', limit: 2000,
  });
  const candidates = events.filter(e =>
    e.operation === 'AnonymousLinkCreated' || e.operation === 'SharingSet'
  );

  let fired = 0, skipped = 0;
  for (const event of candidates) {
    const parsed = parseAnonymousLinkRecord(event.raw_record);
    if (!parsed) { skipped += 1; continue; }

    const alertData = {
      dedup_key: `ual_anon_link:${event.id}`,
      severity: policy.severity, // Medium by default per policy row
      message: `${parsed.operator} created anonymous-link share on ${parsed.fileName}`,
      raw_data: {
        message_template_key: 'ual_anonymous_link',
        message_template_params: {
          ...buildPolicyNameParams(policy.name),
          operator: parsed.operator,
          fileName: parsed.fileName,
          targetType: parsed.targetType,
        },
        ual_event_id: event.id,
        ual_record_id: event.record_id,
        creation_time: event.creation_time,
        operator: parsed.operator,
        operation: parsed.operation,
        target_type: parsed.targetType,
        resource_url: parsed.resourceUrl,
        file_name: parsed.fileName,
        site_path: parsed.sitePath,
        client_ip: parsed.clientIp,
        upn: parsed.operator,
      },
    };

    try {
      const result = await alertEngine.createOrUpdateAlert(tenant, policy, alertData);
      if (result?.isNew) fired += 1; else skipped += 1;
      // Fire-and-forget AI analysis + email/Teams notification + AI sev-
      // adjust pipeline (May 12, 2026 extract — see alert-engine.processNewAlert).
      if (result?.isNew) {
        alertEngine.processNewAlert(result, tenant).catch((e) => {
          console.error(`[UalEvaluators] processNewAlert failed for alert ${result.id}: ${e.message}`);
        });
      }
    } catch (err) {
      console.error(`[UalEvaluators] anonymous-link alert insert failed for tenant ${tenant.id} event ${event.id}: ${err.message}`);
    }
  }
  return { fired, skipped };
}

// ──────────────────────────────────────────────────────────────────────
// Evaluator: Mass file deletion burst (SharePoint/OneDrive)
// ──────────────────────────────────────────────────────────────────────
//
// Aggregate FileDeleted events per (tenant, user) within a sliding window.
// Threshold and cooldown read from alert_policies.detection_logic JSON so
// they're tunable per-tenant in the future (currently read once per
// evaluator run from the global policy row).
//
// Anti-flapping: ual_burst_state.last_alerted_at gates re-firing within the
// cooldown window. After cooldown expires, the next burst on the same user
// fires again with the NEW count — so a sustained delete attack still
// produces alerts every cooldown_minutes, not just once forever.

async function evaluateMassFileDeletion(tenant, sinceTime, untilTime) {
  if (!_policyIdMassDelete) return { fired: 0, skipped: 0, suppressed: 0 };
  const policy = await db.queryOne(
    'SELECT id, name, severity, category, notification_target, notification_limit, detection_logic, enabled FROM alert_policies WHERE id = ? LIMIT 1',
    [_policyIdMassDelete]
  );
  if (!policy) return { fired: 0, skipped: 0, suppressed: 0 };
  if (!policy.enabled) return { fired: 0, skipped: 0, suppressed: 0, disabled: true };

  let logic = {};
  try { logic = JSON.parse(policy.detection_logic || '{}'); } catch { logic = {}; }
  const threshold = Math.max(parseInt(logic.threshold, 10) || 50, 5);
  const windowMinutes = Math.max(parseInt(logic.window_minutes, 10) || 15, 1);
  const cooldownMinutes = Math.max(parseInt(logic.cooldown_minutes, 10) || 60, 5);

  const events = await ualEvents.lookupEvents({
    tenantId: tenant.id, since: sinceTime, until: untilTime,
    workload: 'SharePoint', limit: 5000,
  });
  const candidates = events
    .filter(e => e.operation === 'FileDeleted' && e.user_upn)
    // Sort ascending by creation_time so sliding-window count works left-to-right.
    .sort((a, b) => new Date(a.creation_time) - new Date(b.creation_time));

  let fired = 0, skipped = 0, suppressed = 0;

  // Group events per user, then walk each user's series with a sliding window.
  const byUser = new Map();
  for (const e of candidates) {
    const upn = String(e.user_upn).toLowerCase();
    if (!byUser.has(upn)) byUser.set(upn, []);
    byUser.get(upn).push(e);
  }

  for (const [upn, userEvents] of byUser.entries()) {
    if (userEvents.length < threshold) { skipped += 1; continue; }

    // Sliding window: for each event, count how many events within the
    // preceding windowMinutes fall in the same user's series. If that count
    // crosses threshold, we have a burst at this event's timestamp.
    let burstWindowEnd = null;
    let burstCount = 0;
    for (let i = 0; i < userEvents.length; i++) {
      const endT = new Date(userEvents[i].creation_time);
      const startT = new Date(endT.getTime() - windowMinutes * 60 * 1000);
      let count = 0;
      for (let j = i; j >= 0; j--) {
        const t = new Date(userEvents[j].creation_time);
        if (t < startT) break;
        count++;
      }
      if (count >= threshold) {
        burstWindowEnd = endT;
        burstCount = count;
        break;
      }
    }
    if (!burstWindowEnd) { skipped += 1; continue; }

    // Anti-flapping check against ual_burst_state.
    const state = await db.queryOne(
      `SELECT last_alerted_at FROM ual_burst_state
        WHERE tenant_id = ? AND user_id = ? AND detection_id = ? LIMIT 1`,
      [tenant.id, upn, 'mass_delete']
    );
    if (state && state.last_alerted_at) {
      const lastT = new Date(state.last_alerted_at);
      const cutoffT = new Date(burstWindowEnd.getTime() - cooldownMinutes * 60 * 1000);
      if (lastT > cutoffT) {
        suppressed += 1;
        continue;
      }
    }

    // Sample 3 paths from the burst events for the alert body.
    const samplePaths = userEvents
      .slice(-burstCount)
      .map(e => e.raw_record?.SourceFileName || e.raw_record?.ObjectId || '(unknown)')
      .slice(0, 3);

    const triggeringEvent = userEvents.find(e => new Date(e.creation_time).getTime() === burstWindowEnd.getTime())
                          || userEvents[userEvents.length - 1];

    const alertData = {
      dedup_key: `ual_mass_delete:${tenant.id}:${upn}:${burstWindowEnd.toISOString()}`,
      severity: policy.severity,
      message: `${upn} deleted ${burstCount} files in ${windowMinutes} min`,
      raw_data: {
        message_template_key: 'ual_mass_file_deletion',
        message_template_params: {
          ...buildPolicyNameParams(policy.name),
          actor: upn,
          count: burstCount,
          windowMinutes,
          samplePaths: samplePaths.join(', '),
        },
        ual_event_id: triggeringEvent.id,
        ual_record_id: triggeringEvent.record_id,
        creation_time: triggeringEvent.creation_time,
        actor: upn,
        count: burstCount,
        window_minutes: windowMinutes,
        sample_paths: samplePaths,
        upn,
      },
    };

    try {
      const result = await alertEngine.createOrUpdateAlert(tenant, policy, alertData);
      if (result?.isNew) {
        fired += 1;
        // Fire-and-forget AI analysis + email/Teams notification + AI sev-
        // adjust pipeline (May 12, 2026 extract — see alert-engine.processNewAlert).
        alertEngine.processNewAlert(result, tenant).catch((e) => {
          console.error(`[UalEvaluators] processNewAlert failed for alert ${result.id}: ${e.message}`);
        });
        // Update burst state — UTC_TIMESTAMP per memory feedback_mysql_utc_timestamp.md.
        // Use INSERT ... ON DUPLICATE KEY UPDATE so subsequent bursts overwrite
        // the same row instead of inserting duplicates.
        try {
          await db.execute(
            `INSERT INTO ual_burst_state
               (tenant_id, user_id, detection_id, last_alerted_at, last_count, last_window_end)
             VALUES (?, ?, ?, UTC_TIMESTAMP(3), ?, ?)
             ON DUPLICATE KEY UPDATE
               last_alerted_at = UTC_TIMESTAMP(3),
               last_count = VALUES(last_count),
               last_window_end = VALUES(last_window_end)`,
            [tenant.id, upn, 'mass_delete', burstCount, ualEvents.toMysqlDatetime(burstWindowEnd)]
          );
        } catch (err) {
          console.warn(`[UalEvaluators] burst-state update failed for tenant ${tenant.id} user ${upn}: ${err.message}`);
        }
      } else {
        skipped += 1;
      }
    } catch (err) {
      console.error(`[UalEvaluators] mass-deletion alert insert failed for tenant ${tenant.id} user ${upn}: ${err.message}`);
    }
  }

  return { fired, skipped, suppressed, threshold, windowMinutes, cooldownMinutes };
}

// ──────────────────────────────────────────────────────────────────────
// Evaluator: Compliance / Mailbox eDiscovery search
// ──────────────────────────────────────────────────────────────────────
//
// Operations watched:
//   - New-ComplianceSearch / Start-ComplianceSearch (Audit.General — Purview)
//   - New-MailboxSearch (Audit.Exchange — older eDiscovery cmdlet)
//   - SearchCreated (Audit.SharePoint — content search)
//
// Auto-attribution: cross-checks raw_data.UserId against msp_audit_events for
// the tenant within a configurable window. When matched, alert still records
// but flags `auto_attributed=true` so the operator UI can render it as
// already-explained-by-operator-action rather than a noisy alert.

const DISCOVERY_OPS = new Set([
  'New-ComplianceSearch',
  'Start-ComplianceSearch',
  'New-MailboxSearch',
  'SearchCreated',
]);

function parseDiscoverySearchRecord(record) {
  if (!record) return null;
  if (!DISCOVERY_OPS.has(record.Operation)) return null;
  const operator = record.UserId || null;
  if (!operator) return null;

  const searchName =
    getParam(record, 'Name')
    || getParam(record, 'Identity')
    || record.SearchName
    || '(unnamed search)';
  const searchScope =
    getParam(record, 'ExchangeLocation')
    || getParam(record, 'SharePointLocation')
    || getParam(record, 'SearchQuery')
    || '(scope unspecified)';

  return {
    operation: String(record.Operation),
    operator: String(operator),
    searchName: String(searchName),
    searchScope: String(searchScope),
    clientIp: record.ClientIP || null,
  };
}

async function isOperatorActionAttested(tenantId, operatorUpn, eventTime, windowMinutes) {
  if (!operatorUpn || !eventTime) return false;
  try {
    const lower = new Date(new Date(eventTime).getTime() - windowMinutes * 60 * 1000);
    const upper = new Date(new Date(eventTime).getTime() + 60 * 1000); // +1 min slack for clock skew
    const lowerStr = ualEvents.toMysqlDatetime(lower);
    const upperStr = ualEvents.toMysqlDatetime(upper);
    // msp_audit_events stores operator email — match on UPN for attribution.
    const hit = await db.queryOne(
      `SELECT id FROM msp_audit_events
        WHERE tenant_id = ?
          AND LOWER(operator_email) = LOWER(?)
          AND created_at >= ? AND created_at <= ?
        LIMIT 1`,
      [tenantId, operatorUpn, lowerStr, upperStr]
    );
    return !!hit;
  } catch (err) {
    // If msp_audit_events doesn't exist on this server (older deployment), do
    // not crash the evaluator — fall back to "not attested".
    console.warn(`[UalEvaluators] discovery-search attribution lookup failed: ${err.message}`);
    return false;
  }
}

async function evaluateDiscoverySearch(tenant, sinceTime, untilTime) {
  if (!_policyIdDiscoverySearch) return { fired: 0, skipped: 0, attributed: 0 };
  const policy = await db.queryOne(
    'SELECT id, name, severity, category, notification_target, notification_limit, detection_logic, enabled FROM alert_policies WHERE id = ? LIMIT 1',
    [_policyIdDiscoverySearch]
  );
  if (!policy) return { fired: 0, skipped: 0, attributed: 0 };
  if (!policy.enabled) return { fired: 0, skipped: 0, attributed: 0, disabled: true };

  let logic = {};
  try { logic = JSON.parse(policy.detection_logic || '{}'); } catch { logic = {}; }
  const attributionWindow = Math.max(parseInt(logic.attribution_window_minutes, 10) || 15, 1);

  // Pull from BOTH Audit.General and Audit.Exchange — discovery operations
  // are split across workloads. Two queries because lookupEvents only takes
  // a single workload filter.
  const [generalEvents, exchangeEvents, sharepointEvents] = await Promise.all([
    ualEvents.lookupEvents({ tenantId: tenant.id, since: sinceTime, until: untilTime, workload: 'General', limit: 1000 }),
    ualEvents.lookupEvents({ tenantId: tenant.id, since: sinceTime, until: untilTime, workload: 'Exchange', limit: 1000 }),
    ualEvents.lookupEvents({ tenantId: tenant.id, since: sinceTime, until: untilTime, workload: 'SharePoint', limit: 1000 }),
  ]);
  const candidates = [...generalEvents, ...exchangeEvents, ...sharepointEvents]
    .filter(e => DISCOVERY_OPS.has(e.operation));

  let fired = 0, skipped = 0, attributed = 0;
  for (const event of candidates) {
    const parsed = parseDiscoverySearchRecord(event.raw_record);
    if (!parsed) { skipped += 1; continue; }

    const isAttested = await isOperatorActionAttested(
      tenant.id, parsed.operator, event.creation_time, attributionWindow
    );

    const alertData = {
      dedup_key: `ual_discovery_search:${event.id}`,
      severity: policy.severity,
      message: `${parsed.operator} ${parsed.operation} "${parsed.searchName}"${isAttested ? ' (attributed)' : ''}`,
      raw_data: {
        message_template_key: 'ual_discovery_search',
        message_template_params: {
          ...buildPolicyNameParams(policy.name),
          actor: parsed.operator,
          operation: parsed.operation,
          searchName: parsed.searchName,
          searchScope: parsed.searchScope,
          attributed: isAttested ? 'attributed' : 'unattributed',
        },
        ual_event_id: event.id,
        ual_record_id: event.record_id,
        creation_time: event.creation_time,
        operator: parsed.operator,
        operation: parsed.operation,
        search_name: parsed.searchName,
        search_scope: parsed.searchScope,
        client_ip: parsed.clientIp,
        auto_attributed: isAttested,
        upn: parsed.operator,
      },
    };

    try {
      const result = await alertEngine.createOrUpdateAlert(tenant, policy, alertData);
      if (result?.isNew) {
        fired += 1;
        if (isAttested) attributed += 1;
        // Fire-and-forget AI analysis + email/Teams notification + AI sev-
        // adjust pipeline (May 12, 2026 extract — see alert-engine.processNewAlert).
        alertEngine.processNewAlert(result, tenant).catch((e) => {
          console.error(`[UalEvaluators] processNewAlert failed for alert ${result.id}: ${e.message}`);
        });
      } else {
        skipped += 1;
      }
    } catch (err) {
      console.error(`[UalEvaluators] discovery-search alert insert failed for tenant ${tenant.id} event ${event.id}: ${err.message}`);
    }
  }
  return { fired, skipped, attributed };
}

// ──────────────────────────────────────────────────────────────────────
// Evaluator: Mail flow rule disabled or removed
// ──────────────────────────────────────────────────────────────────────
//
// Inverse of Bundle B's TransportRule "rule created" detection. Watches:
//   - Disable-TransportRule
//   - Remove-TransportRule
//   - Set-TransportRule with State=Disabled in ModifiedProperties
//
// Excludes Panoptica-managed rules — currently EXO-05's outbound notification
// rule. Add new entries to PANOPTICA_MANAGED_RULES below if Panoptica writers
// start managing additional named rules. Match is case-insensitive substring
// against the operator-set rule name. v2: track by rule GUID where present.

const PANOPTICA_MANAGED_RULES = [
  // EXO-05 outbound notification rule — name varies per tenant template, but
  // Panoptica's writer sets a stable prefix.
  'panoptica',
  // Panoptica's external-spam outbound notification (some tenants use this name).
  'spam outbound notification',
];

function isPanopticaManagedRule(ruleName) {
  if (!ruleName) return false;
  const lower = String(ruleName).toLowerCase();
  return PANOPTICA_MANAGED_RULES.some(prefix => lower.includes(prefix));
}

function parseMailFlowDisabledRecord(record) {
  if (!record) return null;
  const op = record.Operation;

  // Direct disable/remove ops
  if (op === 'Disable-TransportRule' || op === 'Remove-TransportRule') {
    const ruleName = getParam(record, 'Identity') || getParam(record, 'Name') || '(unnamed)';
    const operator = record.UserId || null;
    if (!operator) return null;
    return {
      operation: op,
      operator: String(operator),
      ruleName: String(ruleName),
      stateChange: op === 'Disable-TransportRule' ? 'Enabled→Disabled' : 'Removed',
      clientIp: record.ClientIP || null,
    };
  }

  // Set-TransportRule that flips State to Disabled
  if (op === 'Set-TransportRule') {
    const stateParam = getParam(record, 'State');
    if (!stateParam || !/disabled/i.test(String(stateParam))) return null;
    const ruleName = getParam(record, 'Identity') || getParam(record, 'Name') || '(unnamed)';
    const operator = record.UserId || null;
    if (!operator) return null;
    return {
      operation: op,
      operator: String(operator),
      ruleName: String(ruleName),
      stateChange: 'Set State=Disabled',
      clientIp: record.ClientIP || null,
    };
  }

  return null;
}

async function evaluateMailFlowDisabled(tenant, sinceTime, untilTime) {
  if (!_policyIdMailFlowDisabled) return { fired: 0, skipped: 0 };
  const policy = await db.queryOne(
    'SELECT id, name, severity, category, notification_target, notification_limit, enabled FROM alert_policies WHERE id = ? LIMIT 1',
    [_policyIdMailFlowDisabled]
  );
  if (!policy) return { fired: 0, skipped: 0 };
  if (!policy.enabled) return { fired: 0, skipped: 0, disabled: true };

  const events = await ualEvents.lookupEvents({
    tenantId: tenant.id, since: sinceTime, until: untilTime,
    workload: 'Exchange', limit: 1000,
  });
  const candidates = events.filter(e =>
    e.operation === 'Disable-TransportRule'
    || e.operation === 'Remove-TransportRule'
    || e.operation === 'Set-TransportRule'
  );

  let fired = 0, skipped = 0, panopticaSelf = 0;
  for (const event of candidates) {
    const parsed = parseMailFlowDisabledRecord(event.raw_record);
    if (!parsed) { skipped += 1; continue; }

    if (isPanopticaManagedRule(parsed.ruleName)) {
      panopticaSelf += 1;
      continue; // Suppress — Panoptica's own writer touched this rule.
    }

    const alertData = {
      dedup_key: `ual_mail_flow_disabled:${event.id}`,
      severity: policy.severity,
      message: `${parsed.operator} ${parsed.stateChange} on transport rule "${parsed.ruleName}"`,
      raw_data: {
        message_template_key: 'ual_transport_rule_disabled',
        message_template_params: {
          ...buildPolicyNameParams(policy.name),
          actor: parsed.operator,
          ruleName: parsed.ruleName,
          stateChange: parsed.stateChange,
          operation: parsed.operation,
        },
        ual_event_id: event.id,
        ual_record_id: event.record_id,
        creation_time: event.creation_time,
        operator: parsed.operator,
        operation: parsed.operation,
        rule_name: parsed.ruleName,
        state_change: parsed.stateChange,
        client_ip: parsed.clientIp,
        upn: parsed.operator,
      },
    };

    try {
      const result = await alertEngine.createOrUpdateAlert(tenant, policy, alertData);
      if (result?.isNew) fired += 1; else skipped += 1;
      // Fire-and-forget AI analysis + email/Teams notification + AI sev-
      // adjust pipeline (May 12, 2026 extract — see alert-engine.processNewAlert).
      if (result?.isNew) {
        alertEngine.processNewAlert(result, tenant).catch((e) => {
          console.error(`[UalEvaluators] processNewAlert failed for alert ${result.id}: ${e.message}`);
        });
      }
    } catch (err) {
      console.error(`[UalEvaluators] mail-flow-disabled alert insert failed for tenant ${tenant.id} event ${event.id}: ${err.message}`);
    }
  }
  return { fired, skipped, panopticaSelf };
}

// ──────────────────────────────────────────────────────────────────────
// Evaluator: Application URI / RedirectUri modified
// ──────────────────────────────────────────────────────────────────────
//
// Watches operation='Update application' on Audit.AzureActiveDirectory.
// ModifiedProperties is a verbose array; we extract URI-shaped deltas
// specifically and ignore cosmetic property changes (display name, owner,
// etc.). Only fires when at least one URI delta is present.

const APP_URI_PROPS = new Set([
  'AppAddress',                     // Microsoft's umbrella name for ReplyUrls in older logs
  'IdentifierUris',
  'ReplyUrls',
  'Web.RedirectUris',
  'Web.HomePageUrl',
  'Web.LogoutUrl',
  'AvailableToOtherTenants',        // tenant scope flip — adjacent token-theft surface
]);

function parseAppModifiedProps(record) {
  if (!record) return { uriDeltas: [], otherDeltas: [] };
  const props = Array.isArray(record.ModifiedProperties) ? record.ModifiedProperties : [];
  const uriDeltas = [];
  const otherDeltas = [];
  for (const p of props) {
    const name = String(p?.Name || '');
    const old = p?.OldValue == null ? '' : String(p.OldValue);
    const next = p?.NewValue == null ? '' : String(p.NewValue);
    const entry = { prop: name, old, new: next };
    if (APP_URI_PROPS.has(name)) uriDeltas.push(entry);
    else otherDeltas.push(entry);
  }
  return { uriDeltas, otherDeltas };
}

function parseAppUriRecord(record) {
  if (!record) return null;
  if (record.Operation !== 'Update application') return null;
  const operator = record.UserId || null;
  if (!operator) return null;

  const { uriDeltas, otherDeltas } = parseAppModifiedProps(record);
  if (uriDeltas.length === 0) return null; // cosmetic change only — skip

  // Target app — Type=2 is ServicePrincipal/Application in AAD audit records
  const appTarget = findTarget(record, 2);
  const appId = appTarget?.ID || record.ApplicationId || null;
  const props = modifiedPropertyMap(record);
  const appName =
    props['DisplayName']
    || props['TargetId.DisplayName']
    || appId
    || '(unknown app)';

  return {
    operator: String(operator),
    appId: String(appId || ''),
    appName: String(appName),
    uriDeltas,
    otherDeltas,
    clientIp: record.ClientIP || null,
  };
}

async function evaluateAppUriModified(tenant, sinceTime, untilTime) {
  if (!_policyIdAppUriModified) return { fired: 0, skipped: 0 };
  const policy = await db.queryOne(
    'SELECT id, name, severity, category, notification_target, notification_limit, enabled FROM alert_policies WHERE id = ? LIMIT 1',
    [_policyIdAppUriModified]
  );
  if (!policy) return { fired: 0, skipped: 0 };
  if (!policy.enabled) return { fired: 0, skipped: 0, disabled: true };

  const events = await ualEvents.lookupEvents({
    tenantId: tenant.id, since: sinceTime, until: untilTime,
    workload: 'AzureActiveDirectory', limit: 1000,
  });
  const candidates = events.filter(e => e.operation === 'Update application');

  let fired = 0, skipped = 0;
  for (const event of candidates) {
    const parsed = parseAppUriRecord(event.raw_record);
    if (!parsed) { skipped += 1; continue; }

    // Compact rendering of URI deltas for the alert body.
    const uriChanges = parsed.uriDeltas
      .map(d => `${d.prop}: ${d.old || '(empty)'} → ${d.new || '(empty)'}`)
      .join('; ');

    const alertData = {
      dedup_key: `ual_app_uri:${event.id}`,
      severity: policy.severity,
      message: `${parsed.operator} modified URIs on "${parsed.appName}": ${uriChanges}`,
      raw_data: {
        message_template_key: 'ual_app_uri_modified',
        message_template_params: {
          ...buildPolicyNameParams(policy.name),
          actor: parsed.operator,
          appName: parsed.appName,
          uriChanges,
        },
        ual_event_id: event.id,
        ual_record_id: event.record_id,
        creation_time: event.creation_time,
        operator: parsed.operator,
        app_id: parsed.appId,
        app_name: parsed.appName,
        uri_deltas: parsed.uriDeltas,
        other_deltas: parsed.otherDeltas,
        client_ip: parsed.clientIp,
        upn: parsed.operator,
      },
    };

    try {
      const result = await alertEngine.createOrUpdateAlert(tenant, policy, alertData);
      if (result?.isNew) fired += 1; else skipped += 1;
      // Fire-and-forget AI analysis + email/Teams notification + AI sev-
      // adjust pipeline (May 12, 2026 extract — see alert-engine.processNewAlert).
      if (result?.isNew) {
        alertEngine.processNewAlert(result, tenant).catch((e) => {
          console.error(`[UalEvaluators] processNewAlert failed for alert ${result.id}: ${e.message}`);
        });
      }
    } catch (err) {
      console.error(`[UalEvaluators] app-uri-modified alert insert failed for tenant ${tenant.id} event ${event.id}: ${err.message}`);
    }
  }
  return { fired, skipped };
}

// ──────────────────────────────────────────────────────────────────────
// Evaluator: Send-As / SendOnBehalf permission grant
// ──────────────────────────────────────────────────────────────────────
//
// Two patterns:
//   (a) Add-RecipientPermission with AccessRights containing SendAs
//   (b) Set-Mailbox with GrantSendOnBehalfTo delta in ModifiedProperties
//        (or as a parameter — Microsoft inconsistent on this)
//
// Phase 4's Add-MailboxPermission evaluator covers FullAccess. This evaluator
// covers the two impersonation vectors that Phase 4 misses. Same self-grant
// suppression heuristic as Phase 4 (operator == grantee == owner is a no-op).

function parseSendAsGrantRecord(record) {
  if (!record) return null;
  const op = record.Operation;

  // (a) Add-RecipientPermission with SendAs
  if (op === 'Add-RecipientPermission') {
    const accessRights = String(getParam(record, 'AccessRights') || '');
    if (!/sendas/i.test(accessRights)) return null;
    const grantee = getParam(record, 'Trustee') || getParam(record, 'User') || null;
    const mailbox = getParam(record, 'Identity') || record.ObjectId || null;
    const operator = record.UserId || null;
    if (!grantee || !mailbox || !operator) return null;
    return {
      operation: op,
      operator: String(operator),
      grantee: String(grantee),
      mailbox: String(mailbox),
      permissionType: 'SendAs',
      clientIp: record.ClientIP || null,
    };
  }

  // (b) Set-Mailbox with GrantSendOnBehalfTo
  if (op === 'Set-Mailbox') {
    // Try parameter form first
    let granteeRaw = getParam(record, 'GrantSendOnBehalfTo');
    // Fall back to ModifiedProperties form
    if (!granteeRaw) {
      const props = modifiedPropertyMap(record);
      granteeRaw = props['GrantSendOnBehalfTo'];
    }
    if (!granteeRaw || String(granteeRaw).trim() === '' || String(granteeRaw).trim() === '$null') {
      return null;
    }
    const mailbox = getParam(record, 'Identity') || record.MailboxOwnerUPN || record.ObjectId || null;
    const operator = record.UserId || null;
    if (!mailbox || !operator) return null;
    return {
      operation: op,
      operator: String(operator),
      grantee: String(granteeRaw),
      mailbox: String(mailbox),
      permissionType: 'SendOnBehalf',
      clientIp: record.ClientIP || null,
    };
  }

  return null;
}

function classifySendAsGrant(parsed) {
  const localPart = (s) => String(s || '').toLowerCase().split('@')[0];
  const granteeLocal = localPart(parsed.grantee);
  const ownerLocal = localPart(parsed.mailbox);
  const operatorLocal = localPart(parsed.operator);
  if (granteeLocal && ownerLocal && granteeLocal === ownerLocal) {
    return { alert: false, reason: 'grantee equals mailbox owner — no privilege change' };
  }
  if (granteeLocal === operatorLocal && operatorLocal === ownerLocal) {
    return { alert: false, reason: 'operator self-grant on own mailbox' };
  }
  return { alert: true };
}

async function evaluateSendAsGrant(tenant, sinceTime, untilTime) {
  if (!_policyIdSendAsGrant) return { fired: 0, skipped: 0 };
  const policy = await db.queryOne(
    'SELECT id, name, severity, category, notification_target, notification_limit, enabled FROM alert_policies WHERE id = ? LIMIT 1',
    [_policyIdSendAsGrant]
  );
  if (!policy) return { fired: 0, skipped: 0 };
  if (!policy.enabled) return { fired: 0, skipped: 0, disabled: true };

  const events = await ualEvents.lookupEvents({
    tenantId: tenant.id, since: sinceTime, until: untilTime,
    workload: 'Exchange', limit: 1000,
  });
  const candidates = events.filter(e =>
    e.operation === 'Add-RecipientPermission' || e.operation === 'Set-Mailbox'
  );

  let fired = 0, skipped = 0;
  for (const event of candidates) {
    const parsed = parseSendAsGrantRecord(event.raw_record);
    if (!parsed) { skipped += 1; continue; }
    const decision = classifySendAsGrant(parsed);
    if (!decision.alert) { skipped += 1; continue; }

    const alertData = {
      dedup_key: `ual_sendas_grant:${event.id}`,
      severity: policy.severity,
      message: `${parsed.operator} granted ${parsed.permissionType} on ${parsed.mailbox} to ${parsed.grantee}`,
      raw_data: {
        message_template_key: 'ual_sendas_grant',
        message_template_params: {
          ...buildPolicyNameParams(policy.name),
          actor: parsed.operator,
          targetMailbox: parsed.mailbox,
          grantee: parsed.grantee,
          permissionType: parsed.permissionType,
        },
        ual_event_id: event.id,
        ual_record_id: event.record_id,
        creation_time: event.creation_time,
        operator: parsed.operator,
        grantee: parsed.grantee,
        mailbox: parsed.mailbox,
        permission_type: parsed.permissionType,
        client_ip: parsed.clientIp,
        upn: parsed.operator,
      },
    };

    try {
      const result = await alertEngine.createOrUpdateAlert(tenant, policy, alertData);
      if (result?.isNew) fired += 1; else skipped += 1;
      // Fire-and-forget AI analysis + email/Teams notification + AI sev-
      // adjust pipeline (May 12, 2026 extract — see alert-engine.processNewAlert).
      if (result?.isNew) {
        alertEngine.processNewAlert(result, tenant).catch((e) => {
          console.error(`[UalEvaluators] processNewAlert failed for alert ${result.id}: ${e.message}`);
        });
      }
    } catch (err) {
      console.error(`[UalEvaluators] sendas-grant alert insert failed for tenant ${tenant.id} event ${event.id}: ${err.message}`);
    }
  }
  return { fired, skipped };
}

// ══════════════════════════════════════════════════════════════════════
// Bundle D (May 6, 2026 late) — Defender ingestion + sabotage detection
// ══════════════════════════════════════════════════════════════════════

// ──────────────────────────────────────────────────────────────────────
// Evaluator: Microsoft Defender alert ingestion
// ──────────────────────────────────────────────────────────────────────
//
// Wraps Microsoft Defender XDR's correlated alerts through Panoptica's
// pipeline. Microsoft does the heavy detection lifting (Defender for
// Endpoint / O365 / Identity / Cloud Apps); we surface those alerts with
// our routing + AI analysis + i18n + MSP audit log.
//
// Severity mapping: Microsoft → Panoptica
//   Informational → info
//   Low           → low
//   Medium        → medium
//   High          → high
//   (Panoptica's `severe` is reserved for our most-critical first-party
//   findings; Microsoft High is rare and notable but doesn't warrant
//   automatic severe escalation. Operators can override via policy edit.)
//
// IncidentId capture: when the alert is part of a Defender XDR incident,
// raw_data.incident_id is captured so Bundle E (Graph Security API
// incident ingestion) can retroactively join historical alerts to incidents
// once that integration ships.
//
// Dedup: dedup_key = `ual_defender:${AlertId}` so the same Microsoft alert
// doesn't fire twice if UAL re-presents it.

const DEFENDER_SEVERITY_MAP = {
  'informational': 'info',
  'low':           'low',
  'medium':        'medium',
  'high':          'high',
};

function parseDefenderAlertRecord(record) {
  if (!record) return null;
  if (record.Operation !== 'AlertEntityGenerated') return null;

  // Microsoft is inconsistent about field casing across surfaces; prefer
  // standard PascalCase but fall through to camelCase variants.
  const alertId =
    record.AlertId
    || record.AlertEntityId
    || record.alertId
    || null;
  const alertType =
    record.AlertType
    || record.Name
    || record.DisplayName
    || record.AlertName
    || '(unnamed alert)';
  const msSeverity = String(record.Severity || record.AlertSeverity || 'medium').toLowerCase();
  const status = record.Status || record.AlertStatus || null;
  const affectedUser = record.AffectedUser || record.UserId || null;
  const source = record.Source || record.AlertSource || record.DetectionSource || null;
  const category = record.Category || record.AlertCategory || null;
  const incidentId = record.IncidentId || record.alertIncidentId || null;
  const description = record.Description || record.DisplayDescription || null;

  if (!alertId) return null; // can't dedupe without an ID — skip

  return {
    alertId: String(alertId),
    alertType: String(alertType),
    msSeverity,
    status: status ? String(status) : null,
    affectedUser: affectedUser ? String(affectedUser) : null,
    source: source ? String(source) : null,
    category: category ? String(category) : null,
    incidentId: incidentId ? String(incidentId) : null,
    description: description ? String(description) : null,
  };
}

async function evaluateDefenderAlert(tenant, sinceTime, untilTime) {
  if (!_policyIdDefenderAlert) return { fired: 0, skipped: 0 };
  const policy = await db.queryOne(
    'SELECT id, name, severity, category, notification_target, notification_limit, enabled FROM alert_policies WHERE id = ? LIMIT 1',
    [_policyIdDefenderAlert]
  );
  if (!policy) return { fired: 0, skipped: 0 };
  if (!policy.enabled) return { fired: 0, skipped: 0, disabled: true };

  const events = await ualEvents.lookupEvents({
    tenantId: tenant.id, since: sinceTime, until: untilTime,
    workload: 'General', limit: 1000,
  });
  const candidates = events.filter(e => e.operation === 'AlertEntityGenerated');

  let fired = 0, skipped = 0;
  for (const event of candidates) {
    const parsed = parseDefenderAlertRecord(event.raw_record);
    if (!parsed) { skipped += 1; continue; }

    // Inherit severity from Microsoft's classification, fall back to policy default.
    const mappedSeverity = DEFENDER_SEVERITY_MAP[parsed.msSeverity] || policy.severity;

    const alertData = {
      dedup_key: `ual_defender:${parsed.alertId}`,
      severity: mappedSeverity,
      message: `Defender alert: ${parsed.alertType}${parsed.affectedUser ? ' affecting ' + parsed.affectedUser : ''}`,
      raw_data: {
        message_template_key: 'ual_defender_alert',
        message_template_params: {
          ...buildPolicyNameParams(policy.name),
          alertType: parsed.alertType,
          source: parsed.source || 'Microsoft Defender',
          affectedUser: parsed.affectedUser || '(none)',
          msSeverity: parsed.msSeverity,
        },
        ual_event_id: event.id,
        ual_record_id: event.record_id,
        creation_time: event.creation_time,
        defender_alert_id: parsed.alertId,
        defender_alert_type: parsed.alertType,
        defender_severity: parsed.msSeverity,
        defender_status: parsed.status,
        defender_source: parsed.source,
        defender_category: parsed.category,
        defender_description: parsed.description,
        // Bundle E forward-compat hook — captures the linkage so that when
        // Graph Security API incident ingestion ships, we can join historical
        // alerts to their parent incidents.
        incident_id: parsed.incidentId,
        affected_user: parsed.affectedUser,
        upn: parsed.affectedUser,
      },
    };

    try {
      const result = await alertEngine.createOrUpdateAlert(tenant, policy, alertData);
      if (result?.isNew) fired += 1; else skipped += 1;
      // Fire-and-forget AI analysis + email/Teams notification + AI sev-
      // adjust pipeline (May 12, 2026 extract — see alert-engine.processNewAlert).
      if (result?.isNew) {
        alertEngine.processNewAlert(result, tenant).catch((e) => {
          console.error(`[UalEvaluators] processNewAlert failed for alert ${result.id}: ${e.message}`);
        });
      }
    } catch (err) {
      console.error(`[UalEvaluators] defender-alert insert failed for tenant ${tenant.id} event ${event.id}: ${err.message}`);
    }
  }
  return { fired, skipped };
}

// ──────────────────────────────────────────────────────────────────────
// Evaluator: Site collection administrator added (SharePoint privilege escalation)
// ──────────────────────────────────────────────────────────────────────

function parseSiteCollectionAdminRecord(record) {
  if (!record) return null;
  if (record.Operation !== 'Added site collection admin') return null;

  const operator = record.UserId || null;
  if (!operator) return null;

  // Microsoft puts the elevated user in TargetUserOrGroupName / TargetUser /
  // ObjectId depending on the SharePoint event variant.
  const targetUser =
    record.TargetUserOrGroupName
    || record.TargetUser
    || record.ObjectId
    || '(unknown user)';
  const siteUrl = record.SiteUrl || record.Site || record.ObjectId || '(unknown site)';

  return {
    operator: String(operator),
    targetUser: String(targetUser),
    siteUrl: String(siteUrl),
    clientIp: record.ClientIP || null,
  };
}

async function evaluateSiteCollectionAdminAdded(tenant, sinceTime, untilTime) {
  if (!_policyIdSiteCollectionAdmin) return { fired: 0, skipped: 0 };
  const policy = await db.queryOne(
    'SELECT id, name, severity, category, notification_target, notification_limit, enabled FROM alert_policies WHERE id = ? LIMIT 1',
    [_policyIdSiteCollectionAdmin]
  );
  if (!policy) return { fired: 0, skipped: 0 };
  if (!policy.enabled) return { fired: 0, skipped: 0, disabled: true };

  const events = await ualEvents.lookupEvents({
    tenantId: tenant.id, since: sinceTime, until: untilTime,
    workload: 'SharePoint', limit: 1000,
  });
  const candidates = events.filter(e => e.operation === 'Added site collection admin');

  let fired = 0, skipped = 0;
  for (const event of candidates) {
    const parsed = parseSiteCollectionAdminRecord(event.raw_record);
    if (!parsed) { skipped += 1; continue; }

    const alertData = {
      dedup_key: `ual_site_admin:${event.id}`,
      severity: policy.severity,
      message: `${parsed.operator} elevated ${parsed.targetUser} to Site Collection Administrator on ${parsed.siteUrl}`,
      raw_data: {
        message_template_key: 'ual_site_collection_admin_added',
        message_template_params: {
          ...buildPolicyNameParams(policy.name),
          actor: parsed.operator,
          targetUser: parsed.targetUser,
          siteUrl: parsed.siteUrl,
        },
        ual_event_id: event.id,
        ual_record_id: event.record_id,
        creation_time: event.creation_time,
        operator: parsed.operator,
        target_user: parsed.targetUser,
        site_url: parsed.siteUrl,
        client_ip: parsed.clientIp,
        upn: parsed.operator,
      },
    };

    try {
      const result = await alertEngine.createOrUpdateAlert(tenant, policy, alertData);
      if (result?.isNew) fired += 1; else skipped += 1;
      // Fire-and-forget AI analysis + email/Teams notification + AI sev-
      // adjust pipeline (May 12, 2026 extract — see alert-engine.processNewAlert).
      if (result?.isNew) {
        alertEngine.processNewAlert(result, tenant).catch((e) => {
          console.error(`[UalEvaluators] processNewAlert failed for alert ${result.id}: ${e.message}`);
        });
      }
    } catch (err) {
      console.error(`[UalEvaluators] site-collection-admin alert insert failed for tenant ${tenant.id} event ${event.id}: ${err.message}`);
    }
  }
  return { fired, skipped };
}

// ──────────────────────────────────────────────────────────────────────
// Evaluator: Outbound connector created or modified
// ──────────────────────────────────────────────────────────────────────

const OUTBOUND_CONNECTOR_OPS = new Set([
  'New-OutboundConnector',
  'Set-OutboundConnector',
  'Remove-OutboundConnector',
]);

function parseOutboundConnectorRecord(record) {
  if (!record) return null;
  if (!OUTBOUND_CONNECTOR_OPS.has(record.Operation)) return null;

  const operator = record.UserId || null;
  if (!operator) return null;

  const connectorName = getParam(record, 'Name') || getParam(record, 'Identity') || '(unnamed)';
  const smartHosts = getParam(record, 'SmartHosts');
  const tlsSettings = getParam(record, 'TlsSettings');
  const enabled = getParam(record, 'Enabled');
  const useMxRecord = getParam(record, 'UseMXRecord');

  return {
    operation: String(record.Operation),
    operator: String(operator),
    connectorName: String(connectorName),
    smartHosts: smartHosts ? String(smartHosts) : null,
    tlsSettings: tlsSettings ? String(tlsSettings) : null,
    enabled: enabled !== undefined ? String(enabled) : null,
    useMxRecord: useMxRecord !== undefined ? String(useMxRecord) : null,
    clientIp: record.ClientIP || null,
  };
}

async function evaluateOutboundConnector(tenant, sinceTime, untilTime) {
  if (!_policyIdOutboundConnector) return { fired: 0, skipped: 0 };
  const policy = await db.queryOne(
    'SELECT id, name, severity, category, notification_target, notification_limit, enabled FROM alert_policies WHERE id = ? LIMIT 1',
    [_policyIdOutboundConnector]
  );
  if (!policy) return { fired: 0, skipped: 0 };
  if (!policy.enabled) return { fired: 0, skipped: 0, disabled: true };

  const events = await ualEvents.lookupEvents({
    tenantId: tenant.id, since: sinceTime, until: untilTime,
    workload: 'Exchange', limit: 1000,
  });
  const candidates = events.filter(e => OUTBOUND_CONNECTOR_OPS.has(e.operation));

  let fired = 0, skipped = 0;
  for (const event of candidates) {
    const parsed = parseOutboundConnectorRecord(event.raw_record);
    if (!parsed) { skipped += 1; continue; }

    const alertData = {
      dedup_key: `ual_outbound_connector:${event.id}`,
      severity: policy.severity,
      message: `${parsed.operator} ${parsed.operation} on outbound connector "${parsed.connectorName}"${parsed.smartHosts ? ' → ' + parsed.smartHosts : ''}`,
      raw_data: {
        message_template_key: 'ual_outbound_connector_changed',
        message_template_params: {
          ...buildPolicyNameParams(policy.name),
          actor: parsed.operator,
          operation: parsed.operation,
          connectorName: parsed.connectorName,
          smartHosts: parsed.smartHosts || '(none)',
        },
        ual_event_id: event.id,
        ual_record_id: event.record_id,
        creation_time: event.creation_time,
        operator: parsed.operator,
        operation: parsed.operation,
        connector_name: parsed.connectorName,
        smart_hosts: parsed.smartHosts,
        tls_settings: parsed.tlsSettings,
        connector_enabled: parsed.enabled,
        use_mx_record: parsed.useMxRecord,
        client_ip: parsed.clientIp,
        upn: parsed.operator,
      },
    };

    try {
      const result = await alertEngine.createOrUpdateAlert(tenant, policy, alertData);
      if (result?.isNew) fired += 1; else skipped += 1;
      // Fire-and-forget AI analysis + email/Teams notification + AI sev-
      // adjust pipeline (May 12, 2026 extract — see alert-engine.processNewAlert).
      if (result?.isNew) {
        alertEngine.processNewAlert(result, tenant).catch((e) => {
          console.error(`[UalEvaluators] processNewAlert failed for alert ${result.id}: ${e.message}`);
        });
      }
    } catch (err) {
      console.error(`[UalEvaluators] outbound-connector alert insert failed for tenant ${tenant.id} event ${event.id}: ${err.message}`);
    }
  }
  return { fired, skipped };
}

// ──────────────────────────────────────────────────────────────────────
// Evaluator: Mailbox disabled or removed (data destruction)
// ──────────────────────────────────────────────────────────────────────
//
// Auto-attribution: legitimate offboarding usually involves an MSP audit log
// entry within ±15 min (operator clicks Remove in Panoptica or some other
// orchestration tool). When matched, alert flags auto_attributed=true so the
// operator UI renders it as already-explained. Pattern mirrors C-4 Discovery
// Search's attribution check.

const MAILBOX_DESTRUCTION_OPS = new Set([
  'Disable-Mailbox',
  'Remove-Mailbox',
]);

function parseMailboxDestructionRecord(record) {
  if (!record) return null;
  if (!MAILBOX_DESTRUCTION_OPS.has(record.Operation)) return null;

  const operator = record.UserId || null;
  if (!operator) return null;

  const mailbox =
    getParam(record, 'Identity')
    || record.MailboxOwnerUPN
    || record.ObjectId
    || '(unknown mailbox)';

  return {
    operation: String(record.Operation),
    operator: String(operator),
    mailbox: String(mailbox),
    clientIp: record.ClientIP || null,
  };
}

async function evaluateMailboxDestruction(tenant, sinceTime, untilTime) {
  if (!_policyIdMailboxDestruction) return { fired: 0, skipped: 0, attributed: 0 };
  const policy = await db.queryOne(
    'SELECT id, name, severity, category, notification_target, notification_limit, detection_logic, enabled FROM alert_policies WHERE id = ? LIMIT 1',
    [_policyIdMailboxDestruction]
  );
  if (!policy) return { fired: 0, skipped: 0, attributed: 0 };
  if (!policy.enabled) return { fired: 0, skipped: 0, attributed: 0, disabled: true };

  let logic = {};
  try { logic = JSON.parse(policy.detection_logic || '{}'); } catch { logic = {}; }
  const attributionWindow = Math.max(parseInt(logic.attribution_window_minutes, 10) || 15, 1);

  const events = await ualEvents.lookupEvents({
    tenantId: tenant.id, since: sinceTime, until: untilTime,
    workload: 'Exchange', limit: 1000,
  });
  const candidates = events.filter(e => MAILBOX_DESTRUCTION_OPS.has(e.operation));

  let fired = 0, skipped = 0, attributed = 0;
  for (const event of candidates) {
    const parsed = parseMailboxDestructionRecord(event.raw_record);
    if (!parsed) { skipped += 1; continue; }

    const isAttested = await isOperatorActionAttested(
      tenant.id, parsed.operator, event.creation_time, attributionWindow
    );

    const alertData = {
      dedup_key: `ual_mbx_destruction:${event.id}`,
      severity: policy.severity,
      message: `${parsed.operator} ${parsed.operation} on mailbox ${parsed.mailbox}${isAttested ? ' (attributed)' : ''}`,
      raw_data: {
        message_template_key: 'ual_mailbox_destruction',
        message_template_params: {
          ...buildPolicyNameParams(policy.name),
          actor: parsed.operator,
          operation: parsed.operation,
          mailbox: parsed.mailbox,
          attributed: isAttested ? 'attributed' : 'unattributed',
        },
        ual_event_id: event.id,
        ual_record_id: event.record_id,
        creation_time: event.creation_time,
        operator: parsed.operator,
        operation: parsed.operation,
        mailbox: parsed.mailbox,
        client_ip: parsed.clientIp,
        auto_attributed: isAttested,
        upn: parsed.operator,
      },
    };

    try {
      const result = await alertEngine.createOrUpdateAlert(tenant, policy, alertData);
      if (result?.isNew) {
        fired += 1;
        if (isAttested) attributed += 1;
        // Fire-and-forget AI analysis + email/Teams notification + AI sev-
        // adjust pipeline (May 12, 2026 extract — see alert-engine.processNewAlert).
        alertEngine.processNewAlert(result, tenant).catch((e) => {
          console.error(`[UalEvaluators] processNewAlert failed for alert ${result.id}: ${e.message}`);
        });
      } else {
        skipped += 1;
      }
    } catch (err) {
      console.error(`[UalEvaluators] mailbox-destruction alert insert failed for tenant ${tenant.id} event ${event.id}: ${err.message}`);
    }
  }
  return { fired, skipped, attributed };
}

// ──────────────────────────────────────────────────────────────────────
// Evaluator: Org-wide Exchange config tampering
// ──────────────────────────────────────────────────────────────────────
//
// Watches Set-OrganizationConfig for changes to security-relevant properties.
// Cosmetic property changes (DefaultPublicFolderAgeLimit, etc.) are filtered
// out; only the security-floor properties trigger alerts.
//
// Severity escalation: ModernAuthEnabled → False is the worst case (MFA bypass
// setup via legacy basic auth). AutoForwardingEnabled → True is the second
// worst (org-wide policy hole for exfiltration). Both escalate to severe.

const SECURITY_RELEVANT_ORG_PROPS = new Set([
  'AutoForwardingEnabled',
  'ModernAuthEnabled',
  'OAuth2ClientProfileEnabled',
  'BlockMailboxRulesAffectedByModernAuthIssue',
  'ConnectorsEnabled',
  'ConnectorsActionableMessagesEnabled',
  'AdminAuditLogEnabled',                  // disabling admin audit log is itself a tamper
  'AuditDisabled',                          // tenant-wide audit disable
]);

function parseOrgConfigTamperRecord(record) {
  if (!record) return null;
  if (record.Operation !== 'Set-OrganizationConfig') return null;

  const operator = record.UserId || null;
  if (!operator) return null;

  // Pull deltas from BOTH ModifiedProperties (preferred) and Parameters (some
  // Set-* events emit param-only when the property hasn't been seen before).
  const propDeltas = [];
  const props = Array.isArray(record.ModifiedProperties) ? record.ModifiedProperties : [];
  for (const p of props) {
    if (SECURITY_RELEVANT_ORG_PROPS.has(p?.Name)) {
      propDeltas.push({
        prop: p.Name,
        old: p.OldValue == null ? '' : String(p.OldValue),
        new: p.NewValue == null ? '' : String(p.NewValue),
      });
    }
  }
  // Parameters fallback — only check security-relevant ones to avoid noise.
  for (const propName of SECURITY_RELEVANT_ORG_PROPS) {
    const v = getParam(record, propName);
    if (v !== undefined && !propDeltas.find(d => d.prop === propName)) {
      propDeltas.push({ prop: propName, old: '(unknown)', new: String(v) });
    }
  }

  if (propDeltas.length === 0) return null; // cosmetic change — skip

  return {
    operator: String(operator),
    propDeltas,
    clientIp: record.ClientIP || null,
  };
}

function classifyOrgConfigTamper(parsed) {
  // Severity ladder:
  //   ModernAuthEnabled=False (MFA bypass) → severe
  //   AutoForwardingEnabled=True (exfiltration) → severe
  //   AdminAuditLogEnabled=False (audit tamper) → severe
  //   AuditDisabled=True (tenant audit off) → severe
  //   Anything else → high
  for (const d of parsed.propDeltas) {
    const newLow = String(d.new).toLowerCase();
    if (d.prop === 'ModernAuthEnabled' && newLow === 'false') return 'severe';
    if (d.prop === 'AutoForwardingEnabled' && newLow === 'true') return 'severe';
    if (d.prop === 'AdminAuditLogEnabled' && newLow === 'false') return 'severe';
    if (d.prop === 'AuditDisabled' && newLow === 'true') return 'severe';
  }
  return 'high';
}

async function evaluateOrgConfigTamper(tenant, sinceTime, untilTime) {
  if (!_policyIdOrgConfigTamper) return { fired: 0, skipped: 0 };
  const policy = await db.queryOne(
    'SELECT id, name, severity, category, notification_target, notification_limit, enabled FROM alert_policies WHERE id = ? LIMIT 1',
    [_policyIdOrgConfigTamper]
  );
  if (!policy) return { fired: 0, skipped: 0 };
  if (!policy.enabled) return { fired: 0, skipped: 0, disabled: true };

  const events = await ualEvents.lookupEvents({
    tenantId: tenant.id, since: sinceTime, until: untilTime,
    workload: 'Exchange', limit: 1000,
  });
  const candidates = events.filter(e => e.operation === 'Set-OrganizationConfig');

  let fired = 0, skipped = 0;
  for (const event of candidates) {
    const parsed = parseOrgConfigTamperRecord(event.raw_record);
    if (!parsed) { skipped += 1; continue; }

    const severity = classifyOrgConfigTamper(parsed);
    const propsChanged = parsed.propDeltas
      .map(d => `${d.prop}: ${d.old || '(empty)'} → ${d.new || '(empty)'}`)
      .join('; ');

    const alertData = {
      dedup_key: `ual_org_config:${event.id}`,
      severity,
      message: `${parsed.operator} tampered with org-wide config — ${propsChanged}`,
      raw_data: {
        message_template_key: 'ual_org_config_tamper',
        message_template_params: {
          ...buildPolicyNameParams(policy.name),
          actor: parsed.operator,
          propsChanged,
        },
        ual_event_id: event.id,
        ual_record_id: event.record_id,
        creation_time: event.creation_time,
        operator: parsed.operator,
        prop_deltas: parsed.propDeltas,
        client_ip: parsed.clientIp,
        upn: parsed.operator,
      },
    };

    try {
      const result = await alertEngine.createOrUpdateAlert(tenant, policy, alertData);
      if (result?.isNew) fired += 1; else skipped += 1;
      // Fire-and-forget AI analysis + email/Teams notification + AI sev-
      // adjust pipeline (May 12, 2026 extract — see alert-engine.processNewAlert).
      if (result?.isNew) {
        alertEngine.processNewAlert(result, tenant).catch((e) => {
          console.error(`[UalEvaluators] processNewAlert failed for alert ${result.id}: ${e.message}`);
        });
      }
    } catch (err) {
      console.error(`[UalEvaluators] org-config-tamper alert insert failed for tenant ${tenant.id} event ${event.id}: ${err.message}`);
    }
  }
  return { fired, skipped };
}

// ══════════════════════════════════════════════════════════════════════
// Bundle E (May 6, 2026 latest) — Account-takeover + RBAC-bypass surfaces
// ══════════════════════════════════════════════════════════════════════

// ──────────────────────────────────────────────────────────────────────
// Evaluator: MFA method tamper (admin-on-behalf-of-user)
// ──────────────────────────────────────────────────────────────────────
//
// Watches admin-driven MFA method registration / deletion. Self-changes
// (operator==target) suppressed — users managing their own MFA is normal.
// Auto-attribution against msp_audit_events ±15 min flags helpdesk activity.
//
// Operation surface (Microsoft varies by tenant config):
//   - "Admin registered security info" / "Admin deleted security info"
//   - "User registered security info" / "User deleted security info" (only
//     surfaced when admin == operator != target user)
//   - "Update user" with StrongAuthenticationRequirements / StrongAuthentication
//     PhoneAppDetail / etc. in ModifiedProperties

const MFA_TAMPER_OPS = new Set([
  'Admin registered security info',
  'Admin deleted security info',
  'User registered security info',
  'User deleted security info',
  'Reset user authentication method',
  'User started security info registration',
  'User completed security info registration',
]);

const MFA_RELEVANT_PROPS = new Set([
  'StrongAuthenticationRequirements',
  'StrongAuthenticationMethods',
  'StrongAuthenticationPhoneAppDetail',
  'StrongAuthenticationUserDetails',
]);

function parseMfaMethodTamperRecord(record) {
  if (!record) return null;
  const op = record.Operation;

  // Direct MFA-method ops
  if (MFA_TAMPER_OPS.has(op)) {
    const operator = record.UserId || null;
    if (!operator) return null;
    // Target user: prefer ObjectId (for "Admin... on behalf of user X"), fall
    // back to a Type=5 (User) Target entry, then ResultStatus context.
    const targetTarget = findTarget(record, 5) || findTarget(record, 0);
    const targetUser = targetTarget?.ID || record.ObjectId || null;
    if (!targetUser) return null;
    return {
      operation: String(op),
      operator: String(operator),
      targetUser: String(targetUser),
      changeType: /delete|remove|reset/i.test(op) ? 'removal' : 'addition',
      clientIp: record.ClientIP || null,
    };
  }

  // "Update user" with MFA-relevant property delta
  if (op === 'Update user') {
    const operator = record.UserId || null;
    if (!operator) return null;
    const props = Array.isArray(record.ModifiedProperties) ? record.ModifiedProperties : [];
    const mfaDeltas = props.filter(p => p?.Name && MFA_RELEVANT_PROPS.has(p.Name));
    if (mfaDeltas.length === 0) return null;
    const targetTarget = findTarget(record, 5) || findTarget(record, 0);
    const targetUser = targetTarget?.ID || record.ObjectId || null;
    if (!targetUser) return null;
    return {
      operation: String(op),
      operator: String(operator),
      targetUser: String(targetUser),
      changeType: 'modification',
      mfaDeltas,
      clientIp: record.ClientIP || null,
    };
  }

  return null;
}

function classifyMfaMethodTamper(parsed) {
  const localPart = (s) => String(s || '').toLowerCase().split('@')[0];
  const operatorLocal = localPart(parsed.operator);
  const targetLocal = localPart(parsed.targetUser);
  // Self-change: user managing own MFA — suppress
  if (operatorLocal && targetLocal && operatorLocal === targetLocal) {
    return { alert: false, reason: 'self-managed MFA — no privilege concern' };
  }
  // Removal by admin is the apex pattern (account-takeover finishing move).
  // Severity defaults from policy unless removal — escalate to severe for
  // removals because "admin removed someone else's MFA" is the classic
  // post-compromise persistence consolidation.
  return {
    alert: true,
    severity: parsed.changeType === 'removal' ? 'severe' : 'high',
  };
}

async function evaluateMfaMethodTamper(tenant, sinceTime, untilTime) {
  if (!_policyIdMfaMethodTamper) return { fired: 0, skipped: 0, attributed: 0 };
  const policy = await db.queryOne(
    'SELECT id, name, severity, category, notification_target, notification_limit, detection_logic, enabled FROM alert_policies WHERE id = ? LIMIT 1',
    [_policyIdMfaMethodTamper]
  );
  if (!policy) return { fired: 0, skipped: 0, attributed: 0 };
  if (!policy.enabled) return { fired: 0, skipped: 0, attributed: 0, disabled: true };

  let logic = {};
  try { logic = JSON.parse(policy.detection_logic || '{}'); } catch { logic = {}; }
  const attributionWindow = Math.max(parseInt(logic.attribution_window_minutes, 10) || 15, 1);

  const events = await ualEvents.lookupEvents({
    tenantId: tenant.id, since: sinceTime, until: untilTime,
    workload: 'AzureActiveDirectory', limit: 1000,
  });
  const candidates = events.filter(e =>
    MFA_TAMPER_OPS.has(e.operation) || e.operation === 'Update user'
  );

  let fired = 0, skipped = 0, attributed = 0;
  for (const event of candidates) {
    const parsed = parseMfaMethodTamperRecord(event.raw_record);
    if (!parsed) { skipped += 1; continue; }
    const decision = classifyMfaMethodTamper(parsed);
    if (!decision.alert) { skipped += 1; continue; }

    const isAttested = await isOperatorActionAttested(
      tenant.id, parsed.operator, event.creation_time, attributionWindow
    );

    const alertData = {
      dedup_key: `ual_mfa_tamper:${event.id}`,
      severity: decision.severity,
      message: `${parsed.operator} ${parsed.changeType} MFA on ${parsed.targetUser}${isAttested ? ' (attributed)' : ''}`,
      raw_data: {
        message_template_key: 'ual_mfa_method_tamper',
        message_template_params: {
          ...buildPolicyNameParams(policy.name),
          actor: parsed.operator,
          targetUser: parsed.targetUser,
          changeType: parsed.changeType,
          attributed: isAttested ? 'attributed' : 'unattributed',
        },
        ual_event_id: event.id,
        ual_record_id: event.record_id,
        creation_time: event.creation_time,
        operator: parsed.operator,
        operation: parsed.operation,
        target_user: parsed.targetUser,
        change_type: parsed.changeType,
        client_ip: parsed.clientIp,
        auto_attributed: isAttested,
        upn: parsed.operator,
      },
    };

    try {
      const result = await alertEngine.createOrUpdateAlert(tenant, policy, alertData);
      if (result?.isNew) {
        fired += 1;
        if (isAttested) attributed += 1;
        // Fire-and-forget AI analysis + email/Teams notification + AI sev-
        // adjust pipeline (May 12, 2026 extract — see alert-engine.processNewAlert).
        alertEngine.processNewAlert(result, tenant).catch((e) => {
          console.error(`[UalEvaluators] processNewAlert failed for alert ${result.id}: ${e.message}`);
        });
      } else {
        skipped += 1;
      }
    } catch (err) {
      console.error(`[UalEvaluators] mfa-method-tamper alert insert failed for tenant ${tenant.id} event ${event.id}: ${err.message}`);
    }
  }
  return { fired, skipped, attributed };
}

// ──────────────────────────────────────────────────────────────────────
// Evaluator: Exchange role group membership changed
// ──────────────────────────────────────────────────────────────────────
//
// Different from Bundle A's privileged-role-assignment which only watches
// Entra roles. Exchange RBAC is its own system — Organization Management,
// Discovery Management, Recipient Management, etc. — and grants Exchange-
// scope superpowers without showing up in Entra role assignment audit.

const EXCHANGE_RBAC_OPS = new Set([
  'Add-RoleGroupMember',
  'Remove-RoleGroupMember',
  'New-RoleGroup',
  'Set-RoleGroup',
  'Remove-RoleGroup',
  'New-ManagementRoleAssignment',
  'Remove-ManagementRoleAssignment',
]);

// Sensitive Exchange role groups — escalate to severe when these are touched.
// Ordered by severity (most sensitive first) but used as a Set for membership
// check.
const SENSITIVE_EXCHANGE_ROLE_GROUPS = new Set([
  'Organization Management',
  'Discovery Management',
  'Compliance Management',
  'Records Management',
  'Recipient Management',
]);

function parseExchangeRoleGroupRecord(record) {
  if (!record) return null;
  if (!EXCHANGE_RBAC_OPS.has(record.Operation)) return null;
  const operator = record.UserId || null;
  if (!operator) return null;

  const roleGroup =
    getParam(record, 'Identity')
    || getParam(record, 'Name')
    || getParam(record, 'RoleGroup')
    || '(unknown role group)';
  const member =
    getParam(record, 'Member')
    || getParam(record, 'Members')
    || getParam(record, 'User')
    || null;

  return {
    operation: String(record.Operation),
    operator: String(operator),
    roleGroup: String(roleGroup),
    member: member ? String(member) : null,
    clientIp: record.ClientIP || null,
  };
}

function classifyExchangeRoleGroup(parsed) {
  // Escalate to severe when the touched role group is in our sensitive set.
  // Comparison is case-insensitive substring — Microsoft sometimes adds
  // suffixes/prefixes in different EXO module versions.
  const groupLower = String(parsed.roleGroup).toLowerCase();
  for (const g of SENSITIVE_EXCHANGE_ROLE_GROUPS) {
    if (groupLower.includes(g.toLowerCase())) return 'severe';
  }
  return 'high';
}

async function evaluateExchangeRoleGroupChanged(tenant, sinceTime, untilTime) {
  if (!_policyIdExchangeRoleGroup) return { fired: 0, skipped: 0 };
  const policy = await db.queryOne(
    'SELECT id, name, severity, category, notification_target, notification_limit, enabled FROM alert_policies WHERE id = ? LIMIT 1',
    [_policyIdExchangeRoleGroup]
  );
  if (!policy) return { fired: 0, skipped: 0 };
  if (!policy.enabled) return { fired: 0, skipped: 0, disabled: true };

  const events = await ualEvents.lookupEvents({
    tenantId: tenant.id, since: sinceTime, until: untilTime,
    workload: 'Exchange', limit: 1000,
  });
  const candidates = events.filter(e => EXCHANGE_RBAC_OPS.has(e.operation));

  let fired = 0, skipped = 0;
  for (const event of candidates) {
    const parsed = parseExchangeRoleGroupRecord(event.raw_record);
    if (!parsed) { skipped += 1; continue; }
    const severity = classifyExchangeRoleGroup(parsed);

    const alertData = {
      dedup_key: `ual_exchange_rbac:${event.id}`,
      severity,
      message: `${parsed.operator} ${parsed.operation} on Exchange role group "${parsed.roleGroup}"${parsed.member ? ' for member ' + parsed.member : ''}`,
      raw_data: {
        message_template_key: 'ual_exchange_role_group_changed',
        message_template_params: {
          ...buildPolicyNameParams(policy.name),
          actor: parsed.operator,
          operation: parsed.operation,
          roleGroup: parsed.roleGroup,
          member: parsed.member || '(none)',
        },
        ual_event_id: event.id,
        ual_record_id: event.record_id,
        creation_time: event.creation_time,
        operator: parsed.operator,
        operation: parsed.operation,
        role_group: parsed.roleGroup,
        member: parsed.member,
        client_ip: parsed.clientIp,
        upn: parsed.operator,
      },
    };

    try {
      const result = await alertEngine.createOrUpdateAlert(tenant, policy, alertData);
      if (result?.isNew) fired += 1; else skipped += 1;
      // Fire-and-forget AI analysis + email/Teams notification + AI sev-
      // adjust pipeline (May 12, 2026 extract — see alert-engine.processNewAlert).
      if (result?.isNew) {
        alertEngine.processNewAlert(result, tenant).catch((e) => {
          console.error(`[UalEvaluators] processNewAlert failed for alert ${result.id}: ${e.message}`);
        });
      }
    } catch (err) {
      console.error(`[UalEvaluators] exchange-rbac alert insert failed for tenant ${tenant.id} event ${event.id}: ${err.message}`);
    }
  }
  return { fired, skipped };
}

// ──────────────────────────────────────────────────────────────────────
// Evaluator: Per-mailbox audit tamper (counter-EXO-09)
// ──────────────────────────────────────────────────────────────────────
//
// At the org level, EXO-09 (Strict Mailbox Audit Posture) enforces audit on
// all mailboxes. At the per-mailbox level, a Set-Mailbox cmdlet can disable
// auditing on one specific victim — the "turn off the camera before the heist"
// pattern. Different from EXO-09's drift detection (state-snapshot diff);
// this fires on the cmdlet event itself.

function parsePerMailboxAuditTamperRecord(record) {
  if (!record) return null;
  if (record.Operation !== 'Set-Mailbox') return null;
  const operator = record.UserId || null;
  if (!operator) return null;

  // Detect from Parameters first (cmdlet form), fall back to ModifiedProperties
  // (post-execution shape). Microsoft varies which form gets emitted depending
  // on whether the property was previously set.
  let auditEnabledFlip = null;
  let auditBypassFlip = null;

  const auditEnabledParam = getParam(record, 'AuditEnabled');
  if (auditEnabledParam !== undefined) {
    if (/^false$/i.test(String(auditEnabledParam))) auditEnabledFlip = 'False';
  }
  const auditBypassParam = getParam(record, 'AuditBypassEnabled');
  if (auditBypassParam !== undefined) {
    if (/^true$/i.test(String(auditBypassParam))) auditBypassFlip = 'True';
  }

  // ModifiedProperties fallback
  if (!auditEnabledFlip && !auditBypassFlip) {
    const props = Array.isArray(record.ModifiedProperties) ? record.ModifiedProperties : [];
    for (const p of props) {
      if (p?.Name === 'AuditEnabled' && /false/i.test(String(p.NewValue || ''))) {
        auditEnabledFlip = 'False';
      }
      if (p?.Name === 'AuditBypassEnabled' && /true/i.test(String(p.NewValue || ''))) {
        auditBypassFlip = 'True';
      }
    }
  }

  if (!auditEnabledFlip && !auditBypassFlip) return null;

  const mailbox =
    getParam(record, 'Identity')
    || record.MailboxOwnerUPN
    || record.ObjectId
    || '(unknown mailbox)';

  return {
    operator: String(operator),
    mailbox: String(mailbox),
    auditEnabledFlip,
    auditBypassFlip,
    clientIp: record.ClientIP || null,
  };
}

async function evaluatePerMailboxAuditTamper(tenant, sinceTime, untilTime) {
  if (!_policyIdPerMailboxAuditTamper) return { fired: 0, skipped: 0 };
  const policy = await db.queryOne(
    'SELECT id, name, severity, category, notification_target, notification_limit, enabled FROM alert_policies WHERE id = ? LIMIT 1',
    [_policyIdPerMailboxAuditTamper]
  );
  if (!policy) return { fired: 0, skipped: 0 };
  if (!policy.enabled) return { fired: 0, skipped: 0, disabled: true };

  const events = await ualEvents.lookupEvents({
    tenantId: tenant.id, since: sinceTime, until: untilTime,
    workload: 'Exchange', limit: 1000,
  });
  const candidates = events.filter(e => e.operation === 'Set-Mailbox');

  let fired = 0, skipped = 0;
  for (const event of candidates) {
    const parsed = parsePerMailboxAuditTamperRecord(event.raw_record);
    if (!parsed) { skipped += 1; continue; }

    const tampers = [];
    if (parsed.auditEnabledFlip) tampers.push(`AuditEnabled=${parsed.auditEnabledFlip}`);
    if (parsed.auditBypassFlip) tampers.push(`AuditBypassEnabled=${parsed.auditBypassFlip}`);
    const tamperStr = tampers.join(', ');

    const alertData = {
      dedup_key: `ual_per_mbx_audit:${event.id}`,
      severity: policy.severity,
      message: `${parsed.operator} disabled mailbox audit on ${parsed.mailbox} (${tamperStr})`,
      raw_data: {
        message_template_key: 'ual_per_mailbox_audit_tamper',
        message_template_params: {
          ...buildPolicyNameParams(policy.name),
          actor: parsed.operator,
          mailbox: parsed.mailbox,
          tampers: tamperStr,
        },
        ual_event_id: event.id,
        ual_record_id: event.record_id,
        creation_time: event.creation_time,
        operator: parsed.operator,
        mailbox: parsed.mailbox,
        audit_enabled_flip: parsed.auditEnabledFlip,
        audit_bypass_flip: parsed.auditBypassFlip,
        client_ip: parsed.clientIp,
        upn: parsed.operator,
      },
    };

    try {
      const result = await alertEngine.createOrUpdateAlert(tenant, policy, alertData);
      if (result?.isNew) fired += 1; else skipped += 1;
      // Fire-and-forget AI analysis + email/Teams notification + AI sev-
      // adjust pipeline (May 12, 2026 extract — see alert-engine.processNewAlert).
      if (result?.isNew) {
        alertEngine.processNewAlert(result, tenant).catch((e) => {
          console.error(`[UalEvaluators] processNewAlert failed for alert ${result.id}: ${e.message}`);
        });
      }
    } catch (err) {
      console.error(`[UalEvaluators] per-mailbox-audit-tamper alert insert failed for tenant ${tenant.id} event ${event.id}: ${err.message}`);
    }
  }
  return { fired, skipped };
}

// ──────────────────────────────────────────────────────────────────────
// Evaluator: Admin-initiated password reset
// ──────────────────────────────────────────────────────────────────────
//
// Fires when operator != target. Self password changes are normal and
// suppressed. Auto-attribution against msp_audit_events for legitimate
// helpdesk activity (same pattern as C-4 / D-4).

const ADMIN_PWD_RESET_OPS = new Set([
  'Reset user password',
  'Change user password',
]);

function parseAdminPasswordResetRecord(record) {
  if (!record) return null;
  if (!ADMIN_PWD_RESET_OPS.has(record.Operation)) return null;
  const operator = record.UserId || null;
  if (!operator) return null;

  const targetTarget = findTarget(record, 5) || findTarget(record, 0);
  const targetUser = targetTarget?.ID || record.ObjectId || null;
  if (!targetUser) return null;

  // Self-change suppression
  const localPart = (s) => String(s || '').toLowerCase().split('@')[0];
  if (localPart(operator) === localPart(targetUser)) return null;

  return {
    operation: String(record.Operation),
    operator: String(operator),
    targetUser: String(targetUser),
    clientIp: record.ClientIP || null,
  };
}

async function evaluateAdminPasswordReset(tenant, sinceTime, untilTime) {
  if (!_policyIdAdminPasswordReset) return { fired: 0, skipped: 0, attributed: 0 };
  const policy = await db.queryOne(
    'SELECT id, name, severity, category, notification_target, notification_limit, detection_logic, enabled FROM alert_policies WHERE id = ? LIMIT 1',
    [_policyIdAdminPasswordReset]
  );
  if (!policy) return { fired: 0, skipped: 0, attributed: 0 };
  if (!policy.enabled) return { fired: 0, skipped: 0, attributed: 0, disabled: true };

  let logic = {};
  try { logic = JSON.parse(policy.detection_logic || '{}'); } catch { logic = {}; }
  const attributionWindow = Math.max(parseInt(logic.attribution_window_minutes, 10) || 15, 1);

  const events = await ualEvents.lookupEvents({
    tenantId: tenant.id, since: sinceTime, until: untilTime,
    workload: 'AzureActiveDirectory', limit: 1000,
  });
  const candidates = events.filter(e => ADMIN_PWD_RESET_OPS.has(e.operation));

  let fired = 0, skipped = 0, attributed = 0;
  for (const event of candidates) {
    const parsed = parseAdminPasswordResetRecord(event.raw_record);
    if (!parsed) { skipped += 1; continue; }

    const isAttested = await isOperatorActionAttested(
      tenant.id, parsed.operator, event.creation_time, attributionWindow
    );

    const alertData = {
      dedup_key: `ual_admin_pwd_reset:${event.id}`,
      severity: policy.severity,
      message: `${parsed.operator} reset password for ${parsed.targetUser}${isAttested ? ' (attributed)' : ''}`,
      raw_data: {
        message_template_key: 'ual_admin_password_reset',
        message_template_params: {
          ...buildPolicyNameParams(policy.name),
          actor: parsed.operator,
          targetUser: parsed.targetUser,
          attributed: isAttested ? 'attributed' : 'unattributed',
        },
        ual_event_id: event.id,
        ual_record_id: event.record_id,
        creation_time: event.creation_time,
        operator: parsed.operator,
        target_user: parsed.targetUser,
        client_ip: parsed.clientIp,
        auto_attributed: isAttested,
        upn: parsed.operator,
      },
    };

    try {
      const result = await alertEngine.createOrUpdateAlert(tenant, policy, alertData);
      if (result?.isNew) {
        fired += 1;
        if (isAttested) attributed += 1;
        // Fire-and-forget AI analysis + email/Teams notification + AI sev-
        // adjust pipeline (May 12, 2026 extract — see alert-engine.processNewAlert).
        alertEngine.processNewAlert(result, tenant).catch((e) => {
          console.error(`[UalEvaluators] processNewAlert failed for alert ${result.id}: ${e.message}`);
        });
      } else {
        skipped += 1;
      }
    } catch (err) {
      console.error(`[UalEvaluators] admin-password-reset alert insert failed for tenant ${tenant.id} event ${event.id}: ${err.message}`);
    }
  }
  return { fired, skipped, attributed };
}

// ──────────────────────────────────────────────────────────────────────
// Evaluator: Per-mailbox legacy protocol re-enable
// ──────────────────────────────────────────────────────────────────────
//
// Set-CASMailbox can flip per-protocol enable flags. Legacy protocols (IMAP,
// POP, ActiveSync, EWS, MAPI) bypass Modern Auth + CA — the canonical MFA-
// bypass vector. Counter-ENT-09 at per-mailbox level: ENT-09 enforces Modern
// Auth org-wide; per-mailbox CAS settings can re-enable legacy protocols on
// individual users without disturbing the org setting.
//
// Severity escalation: 2+ legacy protocols re-enabled simultaneously → severe.
// Single protocol re-enable → high.

const LEGACY_PROTOCOL_PROPS = [
  'ImapEnabled',
  'PopEnabled',
  'ActiveSyncEnabled',
  'EwsEnabled',
  'MAPIEnabled',
];

function parseLegacyProtocolReEnableRecord(record) {
  if (!record) return null;
  if (record.Operation !== 'Set-CASMailbox') return null;
  const operator = record.UserId || null;
  if (!operator) return null;

  // Collect protocols flipped to True. Detect from Parameters (cmdlet form)
  // and ModifiedProperties (post-execution form) — Microsoft varies.
  const enabled = [];
  for (const propName of LEGACY_PROTOCOL_PROPS) {
    const v = getParam(record, propName);
    if (v !== undefined && /^true$/i.test(String(v))) {
      enabled.push(propName);
      continue;
    }
    // ModifiedProperties fallback
    const props = Array.isArray(record.ModifiedProperties) ? record.ModifiedProperties : [];
    for (const p of props) {
      if (p?.Name === propName && /true/i.test(String(p.NewValue || ''))) {
        if (!enabled.includes(propName)) enabled.push(propName);
      }
    }
  }

  if (enabled.length === 0) return null;

  const mailbox =
    getParam(record, 'Identity')
    || record.MailboxOwnerUPN
    || record.ObjectId
    || '(unknown mailbox)';

  return {
    operator: String(operator),
    mailbox: String(mailbox),
    protocols: enabled,
    clientIp: record.ClientIP || null,
  };
}

function classifyLegacyProtocolReEnable(parsed) {
  // 2+ legacy protocols in one Set-CASMailbox call = clear attack pattern
  // (legitimate admin work usually toggles one at a time).
  return parsed.protocols.length >= 2 ? 'severe' : 'high';
}

async function evaluateLegacyProtocolReEnabled(tenant, sinceTime, untilTime) {
  if (!_policyIdLegacyProtocolReenabled) return { fired: 0, skipped: 0 };
  const policy = await db.queryOne(
    'SELECT id, name, severity, category, notification_target, notification_limit, enabled FROM alert_policies WHERE id = ? LIMIT 1',
    [_policyIdLegacyProtocolReenabled]
  );
  if (!policy) return { fired: 0, skipped: 0 };
  if (!policy.enabled) return { fired: 0, skipped: 0, disabled: true };

  const events = await ualEvents.lookupEvents({
    tenantId: tenant.id, since: sinceTime, until: untilTime,
    workload: 'Exchange', limit: 1000,
  });
  const candidates = events.filter(e => e.operation === 'Set-CASMailbox');

  let fired = 0, skipped = 0;
  for (const event of candidates) {
    const parsed = parseLegacyProtocolReEnableRecord(event.raw_record);
    if (!parsed) { skipped += 1; continue; }
    const severity = classifyLegacyProtocolReEnable(parsed);
    const protoList = parsed.protocols.join(', ');

    const alertData = {
      dedup_key: `ual_legacy_proto:${event.id}`,
      severity,
      message: `${parsed.operator} re-enabled legacy protocols on ${parsed.mailbox}: ${protoList}`,
      raw_data: {
        message_template_key: 'ual_legacy_protocol_re_enabled',
        message_template_params: {
          ...buildPolicyNameParams(policy.name),
          actor: parsed.operator,
          mailbox: parsed.mailbox,
          protocols: protoList,
          count: parsed.protocols.length,
        },
        ual_event_id: event.id,
        ual_record_id: event.record_id,
        creation_time: event.creation_time,
        operator: parsed.operator,
        mailbox: parsed.mailbox,
        protocols: parsed.protocols,
        client_ip: parsed.clientIp,
        upn: parsed.operator,
      },
    };

    try {
      const result = await alertEngine.createOrUpdateAlert(tenant, policy, alertData);
      if (result?.isNew) fired += 1; else skipped += 1;
      // Fire-and-forget AI analysis + email/Teams notification + AI sev-
      // adjust pipeline (May 12, 2026 extract — see alert-engine.processNewAlert).
      if (result?.isNew) {
        alertEngine.processNewAlert(result, tenant).catch((e) => {
          console.error(`[UalEvaluators] processNewAlert failed for alert ${result.id}: ${e.message}`);
        });
      }
    } catch (err) {
      console.error(`[UalEvaluators] legacy-protocol-reenable alert insert failed for tenant ${tenant.id} event ${event.id}: ${err.message}`);
    }
  }
  return { fired, skipped };
}

// ══════════════════════════════════════════════════════════════════════
// Bundle F (May 6, 2026 evening) — Defender Incidents (Graph Security API)
// ══════════════════════════════════════════════════════════════════════
//
// Different surface than UAL: this reads from Microsoft Graph Security API
// (/v1.0/security/incidents) via src/lib/defender-incidents.js. Incidents are
// Microsoft's correlated multi-alert stories, not single events. Bundle D-1
// already ingests individual Defender alerts via UAL AlertEntityGenerated;
// Bundle F adds the incident grouping layer that ties those alerts together
// into kill-chain timelines.
//
// Severity-mapping mirrors Bundle D-1: Microsoft Informational/Low/Medium/High
// → Panoptica info/low/medium/high. Panoptica's `severe` reserved for first-
// party detections. Operators can override via policy edit.
//
// Three fire conditions:
//   (a) NEW — incident has never been evaluated (evaluated_at_severity IS NULL).
//   (b) ESCALATED — Microsoft raised the severity since our last evaluation.
//   (c) GREW — alerts_count increased since our last evaluation (new alerts
//              joined to the incident's correlation timeline).
//
// Forward-compat note: Bundle D-1 captures `incident_id` in raw_data of every
// Defender alert. UI/API can join alerts↔incidents via that field once F is
// surfacing incidents.
//
// License gating: incidents only fire on tenants with Defender XDR (Defender
// for Business + Defender for O365 P1 minimum). Lower-tier tenants get fail-
// quiet — fetcher catches 401/403/404 and returns license_gated:true so the
// per-tenant loop continues to other evaluators without errors.

const DEFENDER_INCIDENT_SEVERITY_MAP = {
  'informational': 'info',
  'low':           'low',
  'medium':        'medium',
  'high':          'high',
};

// Severity ordering for escalation detection. Higher number = more severe.
const DEFENDER_INCIDENT_SEVERITY_RANK = {
  'informational': 1,
  'info':          1,
  'low':           2,
  'medium':        3,
  'high':          4,
};

function classifyIncidentChange(row) {
  // Returns { fire, reason } for an incident row from defender_incidents.
  // fire=false means already-evaluated AND nothing changed.
  if (row.evaluated_at_severity === null || row.evaluated_at_severity === undefined) {
    return { fire: true, reason: 'new' };
  }
  const oldRank = DEFENDER_INCIDENT_SEVERITY_RANK[String(row.evaluated_at_severity).toLowerCase()] || 0;
  const newRank = DEFENDER_INCIDENT_SEVERITY_RANK[String(row.severity || '').toLowerCase()] || 0;
  if (newRank > oldRank) return { fire: true, reason: 'severity_escalated' };
  // Don't fire on de-escalation — Microsoft may revise downward and we don't
  // want to spam operators with "good news" alerts.
  if ((row.alerts_count || 0) > (row.evaluated_at_alerts_count || 0)) {
    return { fire: true, reason: 'alerts_joined' };
  }
  return { fire: false, reason: 'unchanged' };
}

async function evaluateDefenderIncident(tenant, _sinceTime, _untilTime) {
  if (!_policyIdDefenderIncident) return { fired: 0, skipped: 0 };
  const policy = await db.queryOne(
    'SELECT id, name, severity, category, notification_target, notification_limit, enabled FROM alert_policies WHERE id = ? LIMIT 1',
    [_policyIdDefenderIncident]
  );
  if (!policy) return { fired: 0, skipped: 0 };
  if (!policy.enabled) return { fired: 0, skipped: 0, disabled: true };

  // Fetch incidents fresh from Graph BEFORE evaluating. This ties Bundle F's
  // ingestion + evaluation into one cycle so we don't need a separate cron
  // job. Fail-quiet on license-gated tenants.
  let fetchResult;
  try {
    fetchResult = await defenderIncidents.fetchDefenderIncidents(tenant);
  } catch (err) {
    console.error(`[UalEvaluators] defender-incident fetch failed for tenant ${tenant.id}: ${err.message}`);
    return { fired: 0, skipped: 0, fetch_error: err.message };
  }

  if (fetchResult.license_gated) {
    return { fired: 0, skipped: 0, license_gated: true };
  }

  // Pull incidents that need evaluation (new, severity-escalated, or
  // alerts_count grew since last evaluation).
  let candidates;
  try {
    candidates = await defenderIncidents.lookupUnevaluatedIncidents(tenant.id, 200);
  } catch (err) {
    console.error(`[UalEvaluators] defender-incident lookup failed for tenant ${tenant.id}: ${err.message}`);
    return { fired: 0, skipped: 0, lookup_error: err.message };
  }

  let fired = 0, skipped = 0, escalated = 0, grew = 0, newCount = 0;
  for (const row of candidates) {
    const decision = classifyIncidentChange(row);
    if (!decision.fire) {
      skipped += 1;
      continue;
    }

    const mappedSeverity = DEFENDER_INCIDENT_SEVERITY_MAP[String(row.severity || '').toLowerCase()] || policy.severity;
    const reasonLabel = decision.reason; // 'new' | 'severity_escalated' | 'alerts_joined'

    const alertData = {
      // Dedup_key includes reason + severity + alerts_count so escalation /
      // growth events get distinct alerts (operator wants visibility into
      // each transition, not just the first fire). Same incident_id with
      // unchanged metrics dedupes via the underlying alerts table dedup.
      dedup_key: `ual_defender_incident:${row.incident_id}:${reasonLabel}:${row.severity}:${row.alerts_count}`,
      severity: mappedSeverity,
      message: `Defender incident: ${row.display_name || '(unnamed)'}${reasonLabel === 'new' ? '' : ' [' + reasonLabel + ']'}`,
      raw_data: {
        message_template_key: 'ual_defender_incident',
        message_template_params: {
          // policyNameKey + policyNameFallback via buildPolicyNameParams
          // so the renderer translates via alert_policy_names.<slug> and
          // strips the "UAL:" internal prefix from operator-facing copy.
          ...buildPolicyNameParams(policy.name),
          incidentName: row.display_name || '(unnamed)',
          msSeverity: row.severity || 'unknown',
          alertsCount: row.alerts_count || 0,
          status: row.status || 'unknown',
          reason: reasonLabel,
        },
        defender_incident_id: row.incident_id,
        incident_name: row.display_name,
        incident_description: row.description,
        defender_severity: row.severity,
        defender_status: row.status,
        defender_classification: row.classification,
        defender_determination: row.determination,
        alerts_count: row.alerts_count,
        previous_severity: row.evaluated_at_severity,
        previous_alerts_count: row.evaluated_at_alerts_count,
        change_reason: reasonLabel,
        incident_web_url: row.incident_web_url,
        last_updated_at: row.last_updated_at_utc,
      },
    };

    try {
      const result = await alertEngine.createOrUpdateAlert(tenant, policy, alertData);
      if (result?.isNew) fired += 1; else skipped += 1;
      if (reasonLabel === 'new') newCount += 1;
      else if (reasonLabel === 'severity_escalated') escalated += 1;
      else if (reasonLabel === 'alerts_joined') grew += 1;
      // Run the post-creation pipeline (Haiku analysis + email/Teams
      // notification + AI sev-adjust) — extracted into alertEngine.
      // processNewAlert on May 12, 2026 specifically to close this gap.
      // Previously UAL alerts silently inserted with no AI/email. Fire-
      // and-forget so a Haiku timeout doesn't stall the evaluator loop.
      if (result?.isNew) {
        alertEngine.processNewAlert(result, tenant).catch((err) => {
          console.error(`[UalEvaluators] defender-incident processNewAlert failed for alert ${result.id}: ${err.message}`);
        });
      }
      // Mark evaluated regardless of new vs duplicate-dedup, so we don't
      // re-fire on the same state. Exception: on insert failure we leave
      // evaluated_at unchanged so next cycle retries.
      try {
        await defenderIncidents.markEvaluated(row.id, row.severity, row.alerts_count);
      } catch (err) {
        console.warn(`[UalEvaluators] defender-incident markEvaluated failed for tenant ${tenant.id} incident ${row.incident_id}: ${err.message}`);
      }
    } catch (err) {
      console.error(`[UalEvaluators] defender-incident alert insert failed for tenant ${tenant.id} incident ${row.incident_id}: ${err.message}`);
    }
  }

  return {
    fired,
    skipped,
    fetch: { fetched: fetchResult.fetched, inserted: fetchResult.inserted, updated: fetchResult.updated },
    new: newCount,
    escalated,
    grew,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Orchestrator
// ──────────────────────────────────────────────────────────────────────

/**
 * Run all UAL evaluators for one tenant. Called by ual-worker after a
 * successful ingestion cycle for that tenant.
 *
 * Time bookend semantics:
 *   - Lower bound: MAX(ual_first_seen_at, ual_last_evaluated_at)
 *     ual_first_seen_at = forward-only cutover (Phase 4 design)
 *     ual_last_evaluated_at = avoid re-processing events in subsequent cycles
 *   - Upper bound: NOW (UTC)
 *
 * On success, ual_last_evaluated_at is advanced to the upper bound. On
 * failure, last_evaluated stays where it was so next cycle retries.
 *
 * Audit-only tenants: skipped via shouldProcessTenant.
 *
 * @param {object} tenant  Row from tenants table — must include id and tenant_id
 * @returns {Promise<object>}  Summary of evaluator runs
 */
// ──────────────────────────────────────────────────────────────────────
// Evaluator: native CA policy created outside Panoptica (Adopt-in-Place §7.4)
// ──────────────────────────────────────────────────────────────────────
//
// Near-real-time companion to the daily discovery loop. A "Add conditional
// access policy" UAL event means a CA policy was just created directly in the
// Microsoft console — so we run the read-only CA reconcile NOW (creates the
// tenant-sourced card + fires the "configuration created outside Panoptica"
// alert). The reconcile is watermark-gated (no flood on a never-imported
// tenant) and uses the same dedup key as the daily loop (no double-fire).
//
// Intune config creation is NOT reliably present in the Office 365 UAL — Intune
// admin actions land in deviceManagement/auditEvents, a separate pipeline — so
// Intune near-real-time is intentionally deferred; the daily loop is the Intune
// backstop. (Documented follow-up.)
async function evaluateAdoptNativeConfig(tenant, sinceTime, untilTime) {
  const events = await ualEvents.lookupEvents({
    tenantId: tenant.id,
    since: sinceTime,
    until: untilTime,
    workload: 'AzureActiveDirectory',
    limit: 1000,
  });
  const caAdds = events.filter(e =>
    String(e.operation || '').toLowerCase().startsWith('add conditional access policy'));
  if (!caAdds.length) return { fired: 0, skipped: 0 };

  // One reconcile sweeps up every CA policy added in the window.
  const r = await adoptService.reconcileTenantSurface(tenant, 'ca', { fireAlerts: true });
  if (r && r.skipped) return { fired: 0, skipped: 1, reason: r.skipped };
  return { fired: (r && r.newObjects) || 0, skipped: 0, triggers: caAdds.length };
}

async function runEvaluators(tenant) {
  if (!tenant?.id) return { skipped: 'no-tenant' };

  if (!await tenantMode.shouldProcessTenant(tenant.id)) {
    return { skipped: 'audit-only' };
  }

  // Bundle F (Defender Incidents) has its own watermark in defender_incidents
  // and does NOT depend on UAL events / ual_first_seen_at / ual_last_evaluated_at.
  // Run it FIRST and unconditionally before the UAL-cutover gate below so we
  // never miss Defender incidents on tenants whose UAL pipeline is delayed,
  // unconsented, or otherwise gated. Wrapped in its own try/catch so a Bundle F
  // failure doesn't poison the UAL evaluators that follow.
  const bundleFResult = { tenantId: tenant.id };
  try {
    bundleFResult.defenderIncident = await evaluateDefenderIncident(tenant);
  } catch (err) {
    console.error(`[UalEvaluators] defenderIncident evaluator failed for tenant ${tenant.id}: ${err.message}`);
    bundleFResult.defenderIncident = { error: err.message };
  }

  // Break-glass CA coverage — Graph-based, NOT UAL-dependent, so run it here in
  // the unconditional block (a stalled UAL cutover must not blind us to an
  // emergency account losing its CA exclusion). Self-gates on a configured group.
  try {
    bundleFResult.breakGlassCoverage = await evaluateBreakGlassCoverage(tenant);
  } catch (err) {
    console.error(`[UalEvaluators] breakGlassCoverage evaluator failed for tenant ${tenant.id}: ${err.message}`);
    bundleFResult.breakGlassCoverage = { error: err.message };
  }

  const cutover = await ualEvents.getTenantCutoverState(tenant.id);
  if (!cutover.ual_first_seen_at) {
    // No UAL cutover yet — should have been set by ualWorker on first poll.
    // Skip UAL evaluators; the next cycle will catch up. Bundle F already ran
    // above so a stalled UAL cutover can't blind us to Defender XDR incidents.
    return { ...bundleFResult, skipped: 'no-cutover' };
  }

  // Lower bound = whichever is later
  const sinceTime = cutover.ual_last_evaluated_at && cutover.ual_last_evaluated_at > cutover.ual_first_seen_at
    ? cutover.ual_last_evaluated_at
    : cutover.ual_first_seen_at;
  const untilTime = new Date();

  // If sinceTime >= untilTime, nothing to do (clock skew or extremely fast cycles).
  if (sinceTime >= untilTime) {
    return { ...bundleFResult, skipped: 'no-window', sinceTime, untilTime };
  }

  // Each evaluator wrapped individually so one failure doesn't abandon the
  // others. Watermark advances only if ALL evaluators completed cleanly —
  // otherwise next cycle retries the whole window (createOrUpdateAlert dedup
  // on dedup_key handles duplicate alerts safely).
  const results = {};
  let anyError = false;

  const runEval = async (key, fn) => {
    try {
      results[key] = await fn(tenant, sinceTime, untilTime);
    } catch (err) {
      // Surface mysql2 / SQL diagnostic fields when present — message alone
      // ("Incorrect arguments to mysqld_stmt_execute") doesn't tell us which
      // query or what types failed.
      const diag = [];
      if (err?.code) diag.push(`code=${err.code}`);
      if (err?.errno) diag.push(`errno=${err.errno}`);
      if (err?.sqlState) diag.push(`sqlState=${err.sqlState}`);
      if (err?.sqlMessage) diag.push(`sqlMessage=${err.sqlMessage}`);
      if (err?.sql) diag.push(`sql=${String(err.sql).slice(0, 200)}`);
      const diagStr = diag.length ? ` [${diag.join(' ')}]` : '';
      console.error(`[UalEvaluators] ${key} evaluator failed for tenant ${tenant.id}: ${err.message}${diagStr}`);
      results[key] = { error: err.message };
      anyError = true;
    }
  };

  await runEval('mailboxPermission',     evaluateAddMailboxPermission);
  await runEval('anomalousGeoFile',      evaluateAnomalousGeoFileAccess);
  await runEval('oauthConsent',          evaluateOauthConsent);
  await runEval('spCredentials',         evaluateSpCredentials);
  await runEval('privilegedRole',        evaluatePrivilegedRoleAssignment);
  await runEval('breakGlassSignin',      evaluateBreakGlassSignin);
  await runEval('transportRule',         evaluateTransportRule);
  await runEval('mailboxForwarding',     evaluateMailboxForwarding);
  await runEval('inboxRuleUal',          evaluateInboxRuleUal);
  // Bundle C (May 6, 2026)
  await runEval('anonymousLink',         evaluateAnonymousLink);
  await runEval('massFileDeletion',      evaluateMassFileDeletion);
  await runEval('discoverySearch',       evaluateDiscoverySearch);
  await runEval('mailFlowDisabled',      evaluateMailFlowDisabled);
  await runEval('appUriModified',        evaluateAppUriModified);
  await runEval('sendAsGrant',           evaluateSendAsGrant);
  // Bundle D (May 6, 2026 late)
  await runEval('defenderAlert',         evaluateDefenderAlert);
  await runEval('siteCollectionAdmin',   evaluateSiteCollectionAdminAdded);
  await runEval('outboundConnector',     evaluateOutboundConnector);
  await runEval('mailboxDestruction',    evaluateMailboxDestruction);
  await runEval('orgConfigTamper',       evaluateOrgConfigTamper);
  // Bundle E (May 6, 2026 latest)
  await runEval('mfaMethodTamper',       evaluateMfaMethodTamper);
  await runEval('exchangeRoleGroup',     evaluateExchangeRoleGroupChanged);
  await runEval('perMailboxAuditTamper', evaluatePerMailboxAuditTamper);
  await runEval('adminPasswordReset',    evaluateAdminPasswordReset);
  await runEval('legacyProtocolReenabled', evaluateLegacyProtocolReEnabled);
  // Adopt-in-Place (2026-06-15) — near-real-time native CA policy creation.
  await runEval('adoptNativeConfig',     evaluateAdoptNativeConfig);
  // Bundle F (May 6, 2026 evening) — Defender Incidents (Graph Security API,
  // not UAL). Now run BEFORE the UAL-cutover gate at the top of this function
  // since it has its own watermark and shouldn't be blocked by stalled UAL
  // ingestion. The bundleFResult captured at the top is merged into the final
  // return below.

  if (!anyError) {
    try {
      await ualEvents.setTenantLastEvaluatedAt(tenant.id, untilTime);
    } catch (err) {
      console.warn(`[UalEvaluators] setTenantLastEvaluatedAt failed for tenant ${tenant.id}: ${err.message}`);
    }
  }

  return {
    tenantId: tenant.id,
    sinceTime,
    untilTime,
    ...bundleFResult,
    ...results,
  };
}

module.exports = {
  runEvaluators,
  ensureUalAlertPolicies,
  // Exposed for tests / probes
  _evaluateAddMailboxPermission: evaluateAddMailboxPermission,
  _evaluateAnomalousGeoFileAccess: evaluateAnomalousGeoFileAccess,
  _evaluateOauthConsent: evaluateOauthConsent,
  _evaluateSpCredentials: evaluateSpCredentials,
  _evaluateAdoptNativeConfig: evaluateAdoptNativeConfig,
  _evaluatePrivilegedRoleAssignment: evaluatePrivilegedRoleAssignment,
  _evaluateBreakGlassSignin: evaluateBreakGlassSignin,
  _evaluateBreakGlassCoverage: evaluateBreakGlassCoverage,
  POLICY_BREAKGLASS_SIGNIN,
  POLICY_BREAKGLASS_COVERAGE,
  _parseMailboxPermissionRecord: parseMailboxPermissionRecord,
  _classifyMailboxPermission: classifyMailboxPermission,
  _parseConsentRecord: parseConsentRecord,
  _classifyConsent: classifyConsent,
  _parseSpCredentialRecord: parseSpCredentialRecord,
  _parseRoleAssignmentRecord: parseRoleAssignmentRecord,
  _classifyRole: classifyRole,
  _modifiedPropertyMap: modifiedPropertyMap,
  _findTarget: findTarget,
  _isHighRiskScope: isHighRiskScope,
  POLICY_MAILBOX_PERMISSION,
  POLICY_ANOMALOUS_GEO_FILE,
  POLICY_OAUTH_CONSENT,
  POLICY_SP_CREDENTIALS,
  POLICY_PRIVILEGED_ROLE,
  POLICY_TRANSPORT_RULE,
  POLICY_MAILBOX_FORWARDING,
  POLICY_INBOX_RULE_UAL,
  ROLE_PRIORITY,
  HIGH_RISK_SCOPE_TOKENS,
  EVASION_FOLDERS,
  // Bundle B exposed for tests
  _evaluateTransportRule: evaluateTransportRule,
  _evaluateMailboxForwarding: evaluateMailboxForwarding,
  _evaluateInboxRuleUal: evaluateInboxRuleUal,
  _parseTransportRuleRecord: parseTransportRuleRecord,
  _classifyTransportRule: classifyTransportRule,
  _parseMailboxForwardingRecord: parseMailboxForwardingRecord,
  _parseInboxRuleRecord: parseInboxRuleRecord,
  _classifyInboxRule: classifyInboxRule,
  _isEvasionFolder: isEvasionFolder,
  _extractDomain: extractDomain,
  // Bundle C exposed for tests
  _evaluateAnonymousLink: evaluateAnonymousLink,
  _evaluateMassFileDeletion: evaluateMassFileDeletion,
  _evaluateDiscoverySearch: evaluateDiscoverySearch,
  _evaluateMailFlowDisabled: evaluateMailFlowDisabled,
  _evaluateAppUriModified: evaluateAppUriModified,
  _evaluateSendAsGrant: evaluateSendAsGrant,
  _parseAnonymousLinkRecord: parseAnonymousLinkRecord,
  _parseDiscoverySearchRecord: parseDiscoverySearchRecord,
  _parseMailFlowDisabledRecord: parseMailFlowDisabledRecord,
  _parseAppUriRecord: parseAppUriRecord,
  _parseAppModifiedProps: parseAppModifiedProps,
  _parseSendAsGrantRecord: parseSendAsGrantRecord,
  _classifySendAsGrant: classifySendAsGrant,
  _isPanopticaManagedRule: isPanopticaManagedRule,
  POLICY_ANONYMOUS_LINK,
  POLICY_MASS_DELETE,
  POLICY_DISCOVERY_SEARCH,
  POLICY_MAIL_FLOW_DISABLED,
  POLICY_APP_URI_MODIFIED,
  POLICY_SENDAS_GRANT,
  ANON_TARGET_TYPES,
  DISCOVERY_OPS,
  PANOPTICA_MANAGED_RULES,
  APP_URI_PROPS,
  // Bundle D exposed for tests
  _evaluateDefenderAlert: evaluateDefenderAlert,
  _evaluateSiteCollectionAdminAdded: evaluateSiteCollectionAdminAdded,
  _evaluateOutboundConnector: evaluateOutboundConnector,
  _evaluateMailboxDestruction: evaluateMailboxDestruction,
  _evaluateOrgConfigTamper: evaluateOrgConfigTamper,
  _parseDefenderAlertRecord: parseDefenderAlertRecord,
  _parseSiteCollectionAdminRecord: parseSiteCollectionAdminRecord,
  _parseOutboundConnectorRecord: parseOutboundConnectorRecord,
  _parseMailboxDestructionRecord: parseMailboxDestructionRecord,
  _parseOrgConfigTamperRecord: parseOrgConfigTamperRecord,
  _classifyOrgConfigTamper: classifyOrgConfigTamper,
  POLICY_DEFENDER_ALERT,
  POLICY_SITE_COLLECTION_ADMIN,
  POLICY_OUTBOUND_CONNECTOR,
  POLICY_MAILBOX_DESTRUCTION,
  POLICY_ORG_CONFIG_TAMPER,
  DEFENDER_SEVERITY_MAP,
  OUTBOUND_CONNECTOR_OPS,
  MAILBOX_DESTRUCTION_OPS,
  SECURITY_RELEVANT_ORG_PROPS,
  // Bundle E exposed for tests
  _evaluateMfaMethodTamper: evaluateMfaMethodTamper,
  _evaluateExchangeRoleGroupChanged: evaluateExchangeRoleGroupChanged,
  _evaluatePerMailboxAuditTamper: evaluatePerMailboxAuditTamper,
  _evaluateAdminPasswordReset: evaluateAdminPasswordReset,
  _evaluateLegacyProtocolReEnabled: evaluateLegacyProtocolReEnabled,
  _parseMfaMethodTamperRecord: parseMfaMethodTamperRecord,
  _classifyMfaMethodTamper: classifyMfaMethodTamper,
  _parseExchangeRoleGroupRecord: parseExchangeRoleGroupRecord,
  _classifyExchangeRoleGroup: classifyExchangeRoleGroup,
  _parsePerMailboxAuditTamperRecord: parsePerMailboxAuditTamperRecord,
  _parseAdminPasswordResetRecord: parseAdminPasswordResetRecord,
  _parseLegacyProtocolReEnableRecord: parseLegacyProtocolReEnableRecord,
  _classifyLegacyProtocolReEnable: classifyLegacyProtocolReEnable,
  POLICY_MFA_METHOD_TAMPER,
  POLICY_EXCHANGE_ROLE_GROUP,
  POLICY_PER_MAILBOX_AUDIT_TAMPER,
  POLICY_ADMIN_PASSWORD_RESET,
  POLICY_LEGACY_PROTOCOL_REENABLED,
  MFA_TAMPER_OPS,
  MFA_RELEVANT_PROPS,
  EXCHANGE_RBAC_OPS,
  SENSITIVE_EXCHANGE_ROLE_GROUPS,
  ADMIN_PWD_RESET_OPS,
  LEGACY_PROTOCOL_PROPS,
  // Bundle F exposed for tests
  _evaluateDefenderIncident: evaluateDefenderIncident,
  _classifyIncidentChange: classifyIncidentChange,
  POLICY_DEFENDER_INCIDENT,
  DEFENDER_INCIDENT_SEVERITY_MAP,
  DEFENDER_INCIDENT_SEVERITY_RANK,
};
