/**
 * Panoptica365 — Security Settings Registry (Phase A1)
 *
 * Source-of-truth list of all 25 security settings from the MSP Security
 * Settings Deployment Library. Seeded into the `security_settings` table on
 * boot by ensureSecuritySettingsSeeded() (src/lib/security-settings/seed.js).
 *
 * Design rules:
 *   1. setting_id is permanent. Renaming is a migration, not an edit. The
 *      msp_audit_events and security_setting_events tables reference these
 *      IDs for decades.
 *   2. poll_strategy classifies HOW the value can be read today:
 *        'graph'             — Graph API read works now (Phase A1).
 *        'powershell_exo'    — needs EXO PowerShell (Phase A2 after infra).
 *        'powershell_spo'    — needs SPO PowerShell (Phase A2).
 *        'powershell_teams'  — needs Teams PowerShell (Phase A2).
 *      The list view uses this to render awaiting-infra states correctly
 *      instead of surfacing 25 "poll_error" LEDs on day one.
 *   3. poll_key is opaque to everything except the fetcher dispatcher. It
 *      is NOT a cmdlet the UI should display to operators. We may refactor
 *      this shape later; no caller should parse it.
 *   4. Text fields (description, security_impact, user_impact, admin_notes)
 *      are the plain-language "explain it to me like I'm 5" content the user
 *      confirmed in D.5 of the design doc. No Graph cmdlets in these strings
 *      — technical detail lives in poll_key and in the config/future Apply
 *      handlers, not in the user-facing copy.
 *   5. This file is static data, not state. It is safe to import anywhere
 *      and does NOT touch the database directly. The seeder reads it; the
 *      API reads the DB.
 */

'use strict';

/**
 * Apr 27, 2026 — DLP snapshot normalizer.
 * Used by CMP-02's matches() and computeDiff() to produce a deterministic,
 * sort-stable representation of the current DLP surface for comparison
 * against a stored baseline. Pulling this out at module scope so both
 * functions share the exact same normalization (otherwise comparison can
 * silently diverge if one is updated without the other).
 *
 * Returns: { policies: [{ name, mode, enabled, workloads, rules: [{ name, sensitive_types, block_access, disabled }] }] }
 */
function _normalizeDlpSnapshot(current) {
  const details = (current && Array.isArray(current.policy_details))
    ? current.policy_details
    : [];
  return {
    policies: details.map(p => ({
      name: String(p?.name || ''),
      mode: String(p?.mode || ''),
      enabled: p?.enabled === true,
      workloads: Array.isArray(p?.workloads) ? [...p.workloads].sort() : [],
      rules: Array.isArray(p?.rules)
        ? p.rules.map(r => ({
            name: String(r?.name || ''),
            sensitive_types: Array.isArray(r?.sensitive_types) ? [...r.sensitive_types].sort() : [],
            block_access: r?.block_access === true,
            disabled: r?.disabled === true,
          })).sort((a, b) => a.name.localeCompare(b.name))
        : [],
    })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/**
 * Apr 27, 2026 (second iteration) — DLP diff helper.
 * Used by BOTH the writer's matches() and computeDiff() so they can never
 * disagree. Previous bug: matches() did JSON.stringify equality, which is
 * key-order-sensitive; the stored baseline's key order (from an older
 * captureBaseline) didn't match the current snapshot's key order (from the
 * unified normalizer), so JSON.stringify diverged even though the structural
 * content was identical. Funneling matches through structural-diff logic
 * eliminates that whole class of bug. Discovered via the
 * empty_diff_warning diagnostic (matches() returned false but computeDiff
 * saw zero differences).
 *
 * Returns a structured diff or null on schema mismatch.
 *   null                       → baseline missing or wrong schema → caller treats as drift
 *   { added, removed, modified } → all empty arrays → no drift; non-empty → drift
 */
function _computeDlpDiff(applied, current) {
  if (!applied || typeof applied !== 'object' || applied.schema !== 'dlp_audit_v1') {
    return null;
  }
  const baseline = applied.policies || [];
  const currentSnap = _normalizeDlpSnapshot(current).policies;
  const baseByName = new Map(baseline.map(p => [p.name, p]));
  const currByName = new Map(currentSnap.map(p => [p.name, p]));

  const added_policies = [];
  const removed_policies = [];
  const modified_policies = [];

  for (const [name, p] of currByName) {
    if (!baseByName.has(name)) {
      added_policies.push({
        name,
        mode: p.mode,
        workloads: p.workloads,
        rule_count: (p.rules || []).length,
      });
    }
  }
  for (const [name, p] of baseByName) {
    if (!currByName.has(name)) {
      removed_policies.push({
        name,
        mode: p.mode,
        workloads: p.workloads,
        rule_count: (p.rules || []).length,
      });
    }
  }
  for (const [name, b] of baseByName) {
    const c = currByName.get(name);
    if (!c) continue;
    const policyDiff = { name };
    if (b.mode !== c.mode) policyDiff.mode = { from: b.mode, to: c.mode };
    if (b.enabled !== c.enabled) policyDiff.enabled = { from: b.enabled, to: c.enabled };
    const bWl = new Set(b.workloads || []);
    const cWl = new Set(c.workloads || []);
    const wlAdded = [...cWl].filter(x => !bWl.has(x));
    const wlRemoved = [...bWl].filter(x => !cWl.has(x));
    if (wlAdded.length || wlRemoved.length) {
      policyDiff.workloads = { added: wlAdded, removed: wlRemoved };
    }
    const bRulesByName = new Map((b.rules || []).map(r => [r.name, r]));
    const cRulesByName = new Map((c.rules || []).map(r => [r.name, r]));
    const rulesAdded = [];
    const rulesRemoved = [];
    const rulesModified = [];
    for (const [rn, cr] of cRulesByName) {
      if (!bRulesByName.has(rn)) rulesAdded.push({ name: rn, sensitive_types: cr.sensitive_types });
    }
    for (const [rn, br] of bRulesByName) {
      if (!cRulesByName.has(rn)) rulesRemoved.push({ name: rn, sensitive_types: br.sensitive_types });
    }
    for (const [rn, br] of bRulesByName) {
      const cr = cRulesByName.get(rn);
      if (!cr) continue;
      const ruleDiff = { name: rn };
      const bTypes = new Set(br.sensitive_types || []);
      const cTypes = new Set(cr.sensitive_types || []);
      const tAdded = [...cTypes].filter(x => !bTypes.has(x));
      const tRemoved = [...bTypes].filter(x => !cTypes.has(x));
      if (tAdded.length || tRemoved.length) {
        ruleDiff.sensitive_types = { added: tAdded, removed: tRemoved };
      }
      if (br.block_access !== cr.block_access) {
        ruleDiff.block_access = { from: br.block_access, to: cr.block_access };
      }
      if (br.disabled !== cr.disabled) {
        ruleDiff.disabled = { from: br.disabled, to: cr.disabled };
      }
      if (Object.keys(ruleDiff).length > 1) rulesModified.push(ruleDiff);
    }
    if (rulesAdded.length) policyDiff.rules_added = rulesAdded;
    if (rulesRemoved.length) policyDiff.rules_removed = rulesRemoved;
    if (rulesModified.length) policyDiff.rules_modified = rulesModified;

    if (Object.keys(policyDiff).length > 1) modified_policies.push(policyDiff);
  }

  return { added_policies, removed_policies, modified_policies };
}

/**
 * @typedef {Object} SecuritySetting
 * @property {string} setting_id        — e.g. 'EXO-02' (internal key, never shown to MSP)
 * @property {string} name              — plain-language title shown in UI
 * @property {'exchange'|'identity'|'sharepoint'|'teams'|'defender'|'compliance'} category
 * @property {'critical'|'high'|'medium'|'low'} priority
 * @property {'graph'|'powershell_exo'|'powershell_spo'|'powershell_teams'} poll_strategy
 * @property {string} poll_key          — fetcher dispatcher directive (opaque)
 * @property {string} description
 * @property {string} security_impact   — threat story
 * @property {string} user_impact       — starts with "Users will..." per UX rule
 * @property {string} admin_notes       — pre-apply checks
 * @property {string|null} licence_required
 * @property {SecuritySettingWriter} [writer]  — Phase B: optional write surface metadata
 */

/**
 * @typedef {Object} SecuritySettingWriter
 * @property {'graph'|'powershell_exo'|'powershell_spo'|'powershell_teams'} strategy
 *           Which writer dispatcher handles this. Phase B v1 ships graph only.
 * @property {string} graph_path       — Graph PATCH path (graph strategy only)
 * @property {'PATCH'|'POST'|'PUT'} graph_method  — defaults to PATCH
 * @property {{version: 'v1.0'|'beta'}} [graph_options]
 * @property {'select_one'|'toggle'|'multi_toggle'} ui  — controls Configure-tab form rendering
 * @property {Array<{value: any, label: string, recommended?: boolean, danger?: boolean}>} [options]
 *           Required when ui === 'select_one'. Order = display order.
 * @property {string} [recommended_label]  — shown above the form ("Microsoft recommends ...")
 * @property {function(any): object} buildPayload
 *           Pure function: chosen UI value → exact JSON body sent to Graph.
 *           Lives in code (not JSON) because some payloads need GUID lookups
 *           or shape transformations the registry can't express declaratively.
 * @property {function(any, any): boolean} matches
 *           (chosenUiValue, currentValueFromReader) → does the chosen value
 *           equal the current state? Used by Match-vs-Apply CTA logic and by
 *           drift detection in poll.js. Pure, no side effects.
 */

// ──────────────────────────────────────────────────────────────────
// ENT-01 SSPR — per-method baseline helpers (Jun 10, 2026)
// ──────────────────────────────────────────────────────────────────
// SSPR has no single on/off toggle in Graph; it's driven entirely by which
// authentication methods are enabled with includeTarget=all_users. The
// original v2 model bundled the trio (Authenticator + SMS + Email) into a
// single "standard" preset, so a partial trio — e.g. "Authenticator + Email,
// SMS dropped", which is the Microsoft-recommended hardening — could NOT be
// represented, captured (Accept dead-ended), or re-applied.
//
// Fix: the baseline is the EXPLICIT SET of methods that should be enabled.
// Every managed method NOT in the set must be disabled. Any combination is
// now a first-class baseline by construction. See the ENT-01 writer below.
//
// FederatedIdentityCredential is intentionally EXCLUDED: Graph beta returns it
// on the parent policy GET but exposes no per-method management endpoint, so
// we can neither Apply it nor reliably own its state.
const SSPR_MANAGED_METHODS = [
  'MicrosoftAuthenticator', 'Sms', 'Email',
  'Fido2', 'TemporaryAccessPass', 'Voice', 'SoftwareOath',
  'HardwareOath', 'X509Certificate', 'QRCodePin', 'VerifiableCredentials',
];
const SSPR_TRIO = ['MicrosoftAuthenticator', 'Sms', 'Email'];

// Method ids that are currently enabled for ALL users, in canonical order.
// Single source of truth for captureCurrentBaseline() and the UI's
// extractCurrentAdditionals() pre-population so they can never diverge.
function _ssprCurrentEnabled(currentValue) {
  const all = (currentValue && currentValue.all_methods) || {};
  return SSPR_MANAGED_METHODS.filter(id => {
    const m = all[id];
    return m && m.state === 'enabled' && m.all_users === true;
  });
}

// Normalize ANY stored applied_value shape into the set of method ids that
// should be enabled (+all_users). Backward-compatible across three shapes:
//   { methods: [...] }       — canonical per-method baseline (Jun 10, 2026+)
//   { option, additional }   — legacy v2 rich baseline: 'standard' enables the
//                              trio, 'additional' enables advanced methods
//   'standard' | 'disabled'  — legacy v1 primitive (trio only)
// CRITICAL: legacy shapes keep their ORIGINAL meaning, so baselines already
// stored on live tenants (e.g. Trilogiam's {option:'standard',additional:[…]})
// are NOT silently reinterpreted — they keep matching exactly as before, and
// only convert to the {methods} shape on the next Apply/Accept/Match.
// Returns { set:Set<string>, strict:boolean } or null if unrecognised.
//   strict=true  → matches() checks EVERY managed method (in-set ⇒ must be
//                  enabled, rest ⇒ must be disabled).
//   strict=false → legacy primitive: check ONLY the trio, ignore advanced
//                  methods (preserves pre-v2 behaviour so old primitives that
//                  never tracked advanced methods don't suddenly read as drift).
function _ssprEnabledSet(applied) {
  if (applied && typeof applied === 'object' && Array.isArray(applied.methods)) {
    return { set: new Set(applied.methods), strict: true };
  }
  if (applied && typeof applied === 'object' && 'option' in applied) {
    const set = new Set(Array.isArray(applied.additional) ? applied.additional : []);
    if (applied.option === 'standard') for (const id of SSPR_TRIO) set.add(id);
    return { set, strict: true };
  }
  if (applied === 'standard') return { set: new Set(SSPR_TRIO), strict: false };
  if (applied === 'disabled') return { set: new Set(), strict: false };
  return null;
}

/** @type {SecuritySetting[]} */
const SETTINGS = [
  // ══════════ EXCHANGE ONLINE ══════════
  {
    setting_id: 'EXO-01',
    name: 'Enable MailTips (All Tips + External Recipients)',
    category: 'exchange',
    priority: 'high',
    poll_strategy: 'powershell_exo',
    poll_key: 'Get-OrganizationConfig | Select MailTipsAllTipsEnabled, MailTipsExternalRecipientsTipsEnabled, MailTipsGroupMetricsEnabled, MailTipsLargeAudienceThreshold',
    description: 'Turns on MailTips in Outlook and Outlook on the Web, including the warning banner that appears when a user is addressing an email to an external recipient or to a large internal audience.',
    security_impact: 'Most accidental data leaks in small businesses happen when someone sends an email to the wrong recipient — a client with the same first name, an old distribution list, the wrong Bob. MailTips puts a visible warning above the Send button so the user sees the mistake before the mail leaves the tenant.',
    user_impact: 'Users will see a small banner above their email draft when they are sending to someone outside the organization, to a large group, or to a mailbox with unusual settings. No extra clicks, no blocking — just an advisory line.',
    admin_notes: 'Safe to enable in any tenant. The external-recipient tip is off by default in most tenants, which is the single most valuable flag to flip. The large-audience threshold is set to 25 by Apply, matching the CIS recommendation; tune manually via PowerShell for tenants with very large distribution lists.',
    licence_required: null,
    writer: {
      strategy: 'powershell_exo',
      ui: 'toggle',
      recommended_label: 'The "Enabled" preset turns on all three MailTips features (general tips, external-recipient warnings, large-audience warnings) and sets the large-audience threshold to 25 — matching CIS guidance.',
      options: [
        { value: 'enabled', label: 'All MailTips enabled, threshold 25 (recommended)', recommended: true },
        { value: 'disabled', label: 'External-recipient warnings off (Microsoft default)' },
      ],
      // Single Set-OrganizationConfig with four params. Idempotent.
      buildPwshCmdlet: (chosen) => {
        if (chosen === 'enabled') {
          return `Set-OrganizationConfig -MailTipsAllTipsEnabled $true -MailTipsExternalRecipientsTipsEnabled $true -MailTipsGroupMetricsEnabled $true -MailTipsLargeAudienceThreshold 25`;
        }
        // "disabled" preset = Microsoft default for the controllable bits.
        // Leaves general MailTips on but turns OFF external-recipient warnings
        // (which is the SMB-default broken state we'd be reverting to).
        return `Set-OrganizationConfig -MailTipsAllTipsEnabled $true -MailTipsExternalRecipientsTipsEnabled $false -MailTipsGroupMetricsEnabled $false -MailTipsLargeAudienceThreshold 25`;
      },
      matches: (chosen, current) => {
        if (!current || typeof current !== 'object') return false;
        const ext = !!current.external_recipients;
        const grp = !!current.group_metrics;
        const all = !!current.all_tips;
        const th  = current.large_audience_threshold;
        if (chosen === 'enabled') {
          return all && ext && grp && th === 25;
        }
        // "disabled" = the SMB-default state we'd revert to
        return all && !ext && !grp;
      },
      // Apr 30, 2026 — i18n Phase 6. Returns {template_key, params}; UI
      // renders via window.t() in the operator's locale. Threshold flows
      // through as a {threshold} placeholder in the template.
      interpret: (current) => {
        if (!current || typeof current !== 'object') return null;
        const ext = !!current.external_recipients;
        const all = !!current.all_tips;
        const grp = !!current.group_metrics;
        const threshold = current.large_audience_threshold ?? '?';
        if (ext && all && grp) {
          return { template_key: 'security_settings.EXO-01.interpreted.fully_enabled', params: { threshold } };
        }
        if (ext) return { template_key: 'security_settings.EXO-01.interpreted.external_on_others_partial', params: {} };
        if (all) return { template_key: 'security_settings.EXO-01.interpreted.external_disabled', params: {} };
        return { template_key: 'security_settings.EXO-01.interpreted.fully_off', params: {} };
      },
    },
  },
  {
    setting_id: 'EXO-02',
    name: 'Disable Automatic Forwarding to External Domains',
    category: 'exchange',
    priority: 'critical',
    poll_strategy: 'powershell_exo',
    poll_key: 'Get-RemoteDomain Default | Select Name, AutoForwardEnabled',
    description: 'Blocks mailbox rules and SMTP forwarding from automatically sending copies of incoming email to any address outside the tenant via the Default remote domain.',
    security_impact: 'When an attacker compromises an account, the first thing they usually do is create a silent inbox rule that forwards every new message to an address they control. Disabling auto-forward at the transport layer blocks this exfiltration path even if the inbox rule still exists.',
    user_impact: 'Users will no longer be able to set up automatic forwarding to a personal email (e.g. Gmail, Hotmail). Forwarding to other internal colleagues still works. If any user legitimately forwards to a partner company, that exception needs to be documented and handled via a dedicated remote domain, not the Default one.',
    admin_notes: 'Before applying, enumerate existing inbox rules with `Get-InboxRule -ResultSize Unlimited | Where {$_.ForwardTo}` to identify users who currently rely on external forwarding. This setting only modifies the Default remote domain; non-Default remote domains (e.g. a partner federation stub) are left alone because they almost always represent a deliberate exception.',
    licence_required: null,
    writer: {
      strategy: 'powershell_exo',
      ui: 'toggle',
      recommended_label: 'Disabling auto-forward on the Default remote domain blocks the most common BEC exfiltration vector. Non-Default remote domains (deliberate partner federations) are unaffected.',
      options: [
        { value: false, label: 'Auto-forward DISABLED on Default domain (recommended)', recommended: true },
        { value: true,  label: 'Auto-forward enabled on Default domain (BEC exfiltration vector)', danger: true },
      ],
      // Single Set-RemoteDomain Default with one boolean. Idempotent.
      buildPwshCmdlet: (chosenAllow) =>
        `Set-RemoteDomain Default -AutoForwardEnabled $${!!chosenAllow}`,
      matches: (chosenAllow, current) =>
        current && typeof current === 'object' &&
        !!current.default_auto_forward_enabled === !!chosenAllow,
      // Apr 30, 2026 — i18n Phase 6. Plural via count + with/without "others"
      // variant baked into the template_key (avoids recursive interpolation).
      interpret: (current) => {
        if (!current || typeof current !== 'object') return null;
        const af = !!current.default_auto_forward_enabled;
        const n = current.non_default_count || 0;
        if (!af) {
          return n > 0
            ? { template_key: 'security_settings.EXO-02.interpreted.disabled_with_others', params: { count: n } }
            : { template_key: 'security_settings.EXO-02.interpreted.disabled', params: {} };
        }
        return n > 0
          ? { template_key: 'security_settings.EXO-02.interpreted.enabled_with_others', params: { count: n } }
          : { template_key: 'security_settings.EXO-02.interpreted.enabled', params: {} };
      },
    },
  },
  {
    setting_id: 'EXO-03',
    name: 'Enable Mailbox Auditing for All Users',
    category: 'exchange',
    priority: 'critical',
    poll_strategy: 'powershell_exo',
    poll_key: 'Get-Mailbox -ResultSize Unlimited | Select DisplayName, AuditEnabled',
    description: 'Ensures that mailbox actions (reads, sends, forwards, deletes, permission changes) are audited for every mailbox in the tenant, including actions performed by the mailbox owner themselves.',
    security_impact: 'If an account is compromised, there is no way to investigate what the attacker did without mailbox audit logs. Owner-action logging is what captures an attacker who is already logged in as the user. This setting is the prerequisite for every email-based forensic investigation.',
    user_impact: 'Users will not notice any change. Auditing runs silently in the background and has no impact on mailbox performance or behaviour.',
    admin_notes: 'Microsoft enabled mailbox auditing by default in 2019, but owner-action logging is still narrower than the recommended set. Apply pre-filters Get-Mailbox to only the mailboxes that need updating (those currently with AuditEnabled = $false), so on a typical SMB tenant where most mailboxes are already enabled, Apply runs quickly. On tenants with many disabled mailboxes (post-migration scenarios are common), Apply may take several minutes — the busy panel\'s elapsed counter will tick past the usual 5-15 second window. Writer timeout bumped to 5 min to accommodate this. No user-visible impact (audit runs silently in the background).',
    licence_required: null,
    writer: {
      strategy: 'powershell_exo',
      ui: 'toggle',
      timeoutMs: 300000,  // 5 min — per-mailbox iteration can take long on bigger tenants
      recommended_label: 'Mailbox auditing is the prerequisite for every email-based forensic investigation. Microsoft enables it by default on new mailboxes since 2019 and enforces audit tenant-wide on modern tenants — choosing "Disabled" here only takes effect on pre-2019 tenants where the per-mailbox flag was explicitly set to False. Apply syncs every user mailbox to AuditEnabled = $true.',
      options: [
        { value: 'enabled',  label: 'Enabled — every user mailbox audited (recommended)', recommended: true },
        { value: 'disabled', label: 'Disabled — per-mailbox flag off (no effect on modern tenants)', danger: true },
      ],
      // The -Filter on Get-Mailbox narrows to UserMailbox only; the
      // AuditEnabled state filter is applied via Where-Object (PowerShell-side)
      // because Exchange Online's OPath dialect rejects boolean comparisons
      // like "AuditEnabled -eq $false" inside -Filter — fails parameter
      // binding with a misleading "Cannot convert value to type System.String"
      // error. Reproduced May 5 2026 on a tenant where all mailboxes were
      // already audited (the buggy filter never matched anything but tripped
      // the parser anyway). Where-Object pattern is the same one EXO-03's
      // reader has used successfully since Apr 2026.
      buildPwshCmdlet: (chosen) => {
        // May 6, 2026 v2 — explicit foreach with [PANOPTICA-PROGRESS] markers
        // for the async-Apply worker's progress UI. Previous single-line
        // pipeline (Get | Where | Set) was concise but didn't surface
        // per-mailbox progress to the dashboard.
        if (chosen === 'enabled') {
          return `
$targets = @(Get-Mailbox -ResultSize Unlimited -Filter 'RecipientTypeDetails -eq "UserMailbox"' | Where-Object { -not $_.AuditEnabled })
$total = ($targets | Measure-Object).Count
$idx = 0
$fixed = 0
$errors = @()
if ($total -gt 0) { [Console]::Out.WriteLine("[PANOPTICA-PROGRESS] current=0 total=$total message=Enabling mailbox auditing") }
foreach ($mbx in $targets) {
  try {
    Set-Mailbox -Identity $mbx.UserPrincipalName -AuditEnabled $true -ErrorAction Stop
    $fixed++
  } catch {
    $errors += "$($mbx.UserPrincipalName): $($_.Exception.Message)"
  }
  $idx++
  [Console]::Out.WriteLine("[PANOPTICA-PROGRESS] current=$idx total=$total message=Enabling mailbox auditing")
}
if ($errors.Count -gt 0) { throw "EXO-03 Apply: fixed=$fixed of $total; $($errors.Count) error(s): $($errors -join ' | ')" }
"enabled=$fixed of $total"
`.trim();
        }
        // 'disabled' — flip everything off (rare; operator-chosen, may not
        // actually take effect on modern tenants per the writer label note).
        return `
$targets = @(Get-Mailbox -ResultSize Unlimited -Filter 'RecipientTypeDetails -eq "UserMailbox"' | Where-Object { $_.AuditEnabled })
$total = ($targets | Measure-Object).Count
$idx = 0
$fixed = 0
$errors = @()
if ($total -gt 0) { [Console]::Out.WriteLine("[PANOPTICA-PROGRESS] current=0 total=$total message=Disabling mailbox auditing") }
foreach ($mbx in $targets) {
  try {
    Set-Mailbox -Identity $mbx.UserPrincipalName -AuditEnabled $false -ErrorAction Stop
    $fixed++
  } catch {
    $errors += "$($mbx.UserPrincipalName): $($_.Exception.Message)"
  }
  $idx++
  [Console]::Out.WriteLine("[PANOPTICA-PROGRESS] current=$idx total=$total message=Disabling mailbox auditing")
}
if ($errors.Count -gt 0) { throw "EXO-03 Apply: fixed=$fixed of $total; $($errors.Count) error(s): $($errors -join ' | ')" }
"disabled=$fixed of $total"
`.trim();
      },
      matches: (chosen, current) => {
        if (!current || typeof current !== 'object') return false;
        const total = current.total_user_mailboxes || 0;
        const enabled = current.audit_enabled_count || 0;
        const disabled = current.audit_disabled_count || 0;
        // No mailboxes — vacuously can't satisfy either state. Treat as no-match
        // so operator sees drift / not_applied rather than a misleading green.
        if (total === 0) return false;
        if (chosen === 'enabled')  return disabled === 0;
        if (chosen === 'disabled') return enabled === 0;
        return false;
      },
      // Apr 30, 2026 — i18n Phase 6. Plural form via params.count drives
      // "mailbox" vs "mailboxes" through the {one, other} key shape.
      interpret: (current) => {
        if (!current || typeof current !== 'object') return null;
        const total = current.total_user_mailboxes || 0;
        const disabled = current.audit_disabled_count || 0;
        if (total === 0) return { template_key: 'security_settings.EXO-03.interpreted.no_mailboxes', params: {} };
        if (disabled === 0) return { template_key: 'security_settings.EXO-03.interpreted.all_enabled', params: { count: total, total } };
        return { template_key: 'security_settings.EXO-03.interpreted.partial_gap', params: { disabled, total } };
      },
    },
  },
  {
    setting_id: 'EXO-05',
    name: 'Configure Anti-Spam Outbound Policy (Restrict Compromised Accounts)',
    category: 'exchange',
    priority: 'high',
    poll_strategy: 'powershell_exo',
    poll_key: 'Get-HostedOutboundSpamFilterPolicy | Select Name, ActionWhenThresholdReached, NotifyOutboundSpam, NotifyOutboundSpamRecipients',
    description: 'Sets the outbound spam policy so that when a user account starts sending spam (suggesting it has been compromised), Microsoft automatically blocks their outbound mail and notifies a configured admin address.',
    security_impact: 'Compromised accounts are used to spray phishing and spam to partners and clients. Left unchecked, this gets the entire tenant domain flagged on reputation blacklists — recovery is painful. Automatic restriction contains the blast radius in minutes and signals the MSP before any real damage lands.',
    user_impact: 'Users will not notice any change unless their account starts sending spam — in which case the account is blocked from sending any outbound email until the MSP investigates and releases it.',
    admin_notes: 'Set the notification recipient to an MSP-monitored address that someone actually reads (the MSP security inbox or ticketing queue). If the notification goes into a black hole, the value of this setting is halved. Apply uses BlockUserForToday (24h auto-release) — operators can manually escalate to permanent BlockUser via the portal if a real compromise is confirmed.',
    licence_required: null,
    writer: {
      strategy: 'powershell_exo',
      ui: 'select_one',
      recommended_label: 'The "Block + alert MSP" preset stops compromised accounts from sending more outbound mail (24h auto-release) AND alerts the MSP recipient list so operators can investigate. Microsoft default is alert-only, which does NOT block the spam.',
      options: [
        {
          value: 'block_with_alert',
          label: 'Block compromised accounts (24h) + alert MSP recipients (recommended)',
          recommended: true,
          input: {
            multiline: true,
            line_kind: 'email',
            placeholder: 'msp-security@yourmsp.com\nticketing@yourmsp.com',
            help: 'One email per line. These addresses receive an alert when an account is restricted for outbound spam.',
            empty_ok: false,
          },
        },
        {
          value: 'default',
          label: 'Microsoft default (Alert-only — does NOT block compromised accounts)',
          danger: true,
        },
      ],
      // Operator-typed recipient list pre-populates from the tenant's current value.
      extractInputFromCurrent: (current) => {
        const recips = Array.isArray(current?.notify_recipients) ? current.notify_recipients : [];
        return recips.join('\n');
      },
      buildPwshCmdlet: (chosen) => {
        const isRich = chosen && typeof chosen === 'object' && 'option' in chosen;
        const option = isRich ? chosen.option : chosen;
        if (option === 'block_with_alert') {
          // Parse input into list of trimmed, non-empty, lowercased emails
          const inputText = isRich ? String(chosen.input || '') : '';
          const recipients = inputText.split(/\r?\n/).map(s => s.trim().toLowerCase()).filter(s => s.length > 0);
          if (recipients.length === 0) {
            return `throw 'Block-with-alert mode requires at least one notification recipient email — none provided.'`;
          }
          // Build PowerShell array literal: @('a','b','c')
          const pwshList = `@(${recipients.map(r => `'${r.replace(/'/g, `''`)}'`).join(',')})`;
          return `Set-HostedOutboundSpamFilterPolicy -Identity Default -ActionWhenThresholdReached BlockUserForToday -NotifyOutboundSpam $true -NotifyOutboundSpamRecipients ${pwshList} -Confirm:$false`;
        }
        // 'default' — restore Microsoft baseline (Alert-only, no recipients)
        return `Set-HostedOutboundSpamFilterPolicy -Identity Default -ActionWhenThresholdReached Alert -NotifyOutboundSpam $false -NotifyOutboundSpamRecipients @() -Confirm:$false`;
      },
      // matches() handles both rich {option,input} (drift detection from baseline)
      // and primitive 'option' (current_matches_option lookup with no input baseline).
      matches: (applied, current) => {
        if (!current || typeof current !== 'object') return false;
        const isRich = applied && typeof applied === 'object' && 'option' in applied;
        const option = isRich ? applied.option : applied;
        const action = String(current.action_when_threshold || '');
        const notify = !!current.notify_outbound_spam;
        const recipients = Array.isArray(current.notify_recipients) ? current.notify_recipients : [];

        if (option === 'block_with_alert') {
          const restrictive = action === 'BlockUser' || action === 'BlockUserForToday';
          if (!restrictive || !notify || recipients.length === 0) return false;
          // For rich applied (with snapshot), also require the recipient list to match
          if (isRich) {
            const want = String(applied.input || '')
              .split(/\r?\n/).map(s => s.trim().toLowerCase()).filter(s => s.length > 0).sort();
            if (want.length !== recipients.length) return false;
            for (let i = 0; i < want.length; i++) {
              if (want[i] !== recipients[i]) return false;
            }
          }
          return true;
        }
        // 'default' — Microsoft baseline
        return action === 'Alert' && !notify && recipients.length === 0;
      },
      // Apr 30, 2026 — i18n Phase 6. Action enum + conditional blockNote.
      interpret: (current) => {
        if (!current || typeof current !== 'object') return null;
        const action = String(current.action_when_threshold || '');
        const notify = !!current.notify_outbound_spam;
        const recipientCount = Array.isArray(current.notify_recipients) ? current.notify_recipients.length : (current.notify_recipient_count || 0);
        const restrictive = action === 'BlockUser' || action === 'BlockUserForToday';
        const blockNote = action === 'BlockUserForToday' ? 'auto_released' : 'none';
        if (restrictive && notify && recipientCount > 0) {
          return { template_key: `security_settings.EXO-05.interpreted.restricts_with_alert.${blockNote}`, params: {} };
        }
        if (restrictive && !notify) {
          return { template_key: 'security_settings.EXO-05.interpreted.no_alert', params: { action } };
        }
        if (action === 'Alert' || action === 'AlertOnly') {
          return { template_key: 'security_settings.EXO-05.interpreted.alert_only', params: {} };
        }
        return { template_key: 'security_settings.EXO-05.interpreted.custom_action', params: { action } };
      },
    },
  },
  {
    setting_id: 'EXO-06',
    name: 'Enable Preset Security Policy (Standard or Strict) — MDO',
    category: 'exchange',
    priority: 'critical',
    poll_strategy: 'powershell_exo',
    poll_key: 'Get-EOPProtectionPolicyRule | Select Name, State, Priority',
    description: 'Turns on Microsoft\'s Standard or Strict preset security policy, which applies hardened anti-spam, anti-phishing, Safe Links, and Safe Attachments configuration to the scoped users automatically and keeps it up to date as Microsoft tunes it.',
    security_impact: 'Default Exchange settings leak a lot of phishing. Microsoft\'s Strict preset adds zero-hour auto-purge, aggressive phishing verdicts, and impersonation protection the default policy doesn\'t have. Using the preset means the MSP gets Microsoft\'s expert tuning for free, updated automatically — no need to hand-maintain a custom policy per tenant.',
    user_impact: 'Users will see more suspected-phishing messages quarantined and more file attachments blocked or delayed for sandbox analysis. False-positive rate is higher on Strict than Standard; a handful of legitimate emails may land in quarantine the first week and need release.',
    admin_notes: 'Standard is the recommended baseline for every tenant — Microsoft\'s own default recommendation. Strict adds aggressive impersonation protection and stricter quarantine on top of Standard, scoped to high-risk users (executives, finance, anyone notorious for clicking on anything). PREREQUISITE: the preset RULES must exist on the tenant before Apply can flip them. Microsoft auto-creates them the first time someone visits the Defender portal Preset Security Policies page (security.microsoft.com → Email & collaboration → Policies & rules → Threat policies → Preset Security Policies) and walks through the wizard. Apply throws a clear error if the rules are missing. (Auto-creation deferred to a future version — Microsoft\'s New-EOPProtectionPolicyRule cmdlet requires three separate policy lookups per tier, plus the actual policy names contain timestamp suffixes that vary per tenant, so we want to test that path on a fresh tenant before shipping.) Apply preserves rule scope across runs — only State flips. Drift detection covers rule state AND impersonation lists (TargetedUsersToProtect, TargetedDomainsToProtect, ExcludedDomains) on the underlying anti-phish policy.',
    licence_required: 'Defender for Office 365 P1',
    writer: {
      strategy: 'powershell_exo',
      ui: 'select_one',
      recommended_label: 'Standard alone is the floor every tenant should have — turning it on tenant-wide is the single highest-value EXO hardening step. Standard + Strict adds defense in depth for tenants with high-value targets (executives, finance, legal). Disabled is "default Microsoft policies" which Microsoft acknowledges is loose.',
      options: [
        { value: 'standard_strict', label: 'Standard + Strict (defense in depth — Strict for high-risk users on top of Standard baseline)' },
        { value: 'standard',        label: 'Standard for all users (recommended baseline)', recommended: true },
        // Jun 11, 2026 — Strict-without-Standard. Microsoft's recommended floor
        // is Standard, so this is an explicit, non-default choice; it exists so
        // a tenant that ends up Strict-only is a documented option Accept can
        // adopt (previously it matched no option and dead-ended Accept Drift).
        { value: 'strict_only',     label: 'Strict for all users (Strict preset only — no Standard baseline)' },
        { value: 'disabled',        label: 'No presets — tenant runs on default policies (Microsoft acknowledges these are loose)', danger: true },
      ],
      // Single-line composite. Rule names contain epoch timestamp suffixes
      // ("Standard Preset Security Policy1647725751267") that vary per tenant
      // — we use `-like 'Name*'` wildcard to catch both bare and timestamped.
      // Apply NEVER touches scope on existing rules.
      //
      // POLICIES have a RecommendedPolicyType field; RULES do not. Asymmetry
      // is Microsoft's, not ours.
      //
      // Order of options matters for Match: deriveChosenFromCurrent iterates
      // options in array order. "standard_strict" listed first so a tenant
      // with both presets on Matches as "standard_strict" rather than
      // "standard". Strict matching requires exact state equality.
      //
      // v4 (Apr 26, 2026): auto-create preset rules on first Apply. If a rule
      // doesn't exist yet (fresh tenant that's never seen the Defender portal
      // wizard), look up the three underlying preset POLICIES by RecommendedPolicyType
      // (HostedContentFilter, MalwareFilter, AntiPhish for EOP; SafeAttachment,
      // SafeLinks for ATP), then call New-*ProtectionPolicyRule with the
      // resolved (timestamped) policy names + RecipientDomainIs = tenant default
      // verified domain. New-* defaults to Enabled, so creation = enabled in
      // one cmdlet. Throws operator-actionable error if any underlying preset
      // policy is missing (would only happen on tenants without Defender for
      // O365 P1+, which the registry's licence_required gate should catch
      // before Apply gets here, but defensive).
      //
      // The created rule uses the canonical name "Standard Preset Security
      // Policy" / "Strict Preset Security Policy" (no timestamp suffix). If
      // Microsoft's wizard later runs on the same tenant, it should detect
      // the existing rule and skip creation rather than duplicate.
      buildPwshCmdlet: (chosen) => {
        // DIAGNOSTIC May 3, 2026 v5 — log the FULL pwsh script being sent.
        // If the error persists, this lets us see whether the script we're
        // building is what we think it is. Look for "[EXO-06 SCRIPT]" in
        // pm2 logs after each Apply attempt.
        console.log(`[EXO-06 buildPwshCmdlet] v5 — choice=${chosen}`);
        const STD_PATTERN    = `'Standard Preset Security Policy*'`;
        const STRICT_PATTERN = `'Strict Preset Security Policy*'`;
        const STD_NAME       = `'Standard Preset Security Policy'`;
        const STRICT_NAME    = `'Strict Preset Security Policy'`;

        // Jun 3, 2026 — MDO licence DETECTION (not a gate). On tenants without
        // Defender for Office 365 (e.g. Business Standard), the ATP/Safe
        // Attachment cmdlets below don't exist. The EOP half of the preset STILL
        // applies and should be turned on there — Microsoft just omits the
        // Defender-for-O365 pieces. So we set $mdoAvailable up front and wrap
        // every ATP/SafeAttachment cmdlet call in `if ($mdoAvailable)`, letting
        // the EOP enable/disable run on any tenant.
        //
        // Detection is via try/catch on the actual cmdlet, NOT Get-Command:
        // calling an absent cmdlet fails instantly with CommandNotFound (caught
        // by try/catch), whereas Get-Command for an absent EXO V3 cmdlet triggers
        // a slow command-discovery round-trip that hung Apply to the 60s timeout.
        // Prepended to every chosen-path script.
        const mdoDetect =
          `$mdoAvailable = $true; try { $null = Get-ATPProtectionPolicyRule -ErrorAction SilentlyContinue } catch { $mdoAvailable = $false }`;

        // Preamble: detect MDO, then resolve tenant default verified domain
        // (used as default scope for any rules we create).
        const preamble = [
          mdoDetect,
          `$tenantDomain = (Get-AcceptedDomain | Where-Object { $_.Default -eq $true } | Select-Object -First 1).DomainName`,
          `if (-not $tenantDomain) { throw 'Could not resolve tenant default verified domain via Get-AcceptedDomain — cannot create preset rules without a scope.' }`,
        ];

        // Helper for the EOP rule.
        //
        // May 3, 2026 (v4) — REMOVED New-* path entirely. Previous attempts
        // to detect "preset is set up" via RecommendedPolicyType filtering
        // failed on tenants where the policies exist but don't carry that
        // metadata field — typically legacy tenants where the preset was
        // provisioned by an older Microsoft schema. The Get-* filter
        // returned null, our code went to the create-fallback branch, and
        // Microsoft's New-* validator hit the dedup error against the
        // existing-but-undetected rule.
        //
        // New strategy: best-effort enable only. Find any rule matching the
        // tier's name pattern and Enable it. If no match, no-op with a
        // diagnostic message. We TRUST Microsoft's preset infrastructure to
        // exist if the operator selected the option — Panoptica's reader
        // already verifies the preset is enabled before drift detection
        // begins, and the operator can run Microsoft's Defender portal
        // wizard to provision the preset on a tenant where it's never been
        // set up. New-EOPProtectionPolicyRule is the wrong tool for this
        // job in any case — the dedup mechanism makes it unreliable.
        // May 3, 2026 (v6) — root cause finally pinned. Pwsh diagnostic showed
        // the error originates from EXO module's internal Write-ErrorMessage
        // (tmpEXO_*.psm1:1212), wrapping a Microsoft REST API error. Calling
        // Enable-EOPProtectionPolicyRule on an ALREADY-ENABLED rule triggers
        // Microsoft's tier-dedup error with the same message New-* would
        // produce. Microsoft's V3 EXO REST treats Enable-* on existing-and-
        // enabled as a duplicate-creation attempt.
        //
        // Fix: only call Enable-* when current State is 'Disabled'. If
        // already 'Enabled', no-op — that IS the desired end state.
        const ensureEopRule = (varSuffix, namePattern, ruleName, tierType, tierLabel) =>
          `$eop${varSuffix} = Get-EOPProtectionPolicyRule -ErrorAction SilentlyContinue | Where-Object { $_.Name -like ${namePattern} } | Select-Object -First 1; ` +
          `if ($eop${varSuffix} -and $eop${varSuffix}.State -ne 'Enabled') { Enable-EOPProtectionPolicyRule -Identity $eop${varSuffix}.Name -Confirm:$false | Out-Null } ` +
          `elseif (-not $eop${varSuffix}) { Write-Host ('${tierLabel} EOP preset rule not found via name pattern. Microsoft may manage it via the Defender portal wizard. If this is a fresh tenant, run the Preset Security Policy wizard once.') }`;

        // Helper for the ATP rule. Same already-enabled guard. Wrapped in
        // `if ($mdoAvailable)` — on EOP-only tenants (Business Standard) the ATP
        // cmdlets don't exist, so we skip them entirely and just configure EOP.
        const ensureAtpRule = (varSuffix, namePattern, ruleName, tierType, tierLabel) =>
          `if ($mdoAvailable) { ` +
          `$atp${varSuffix} = Get-ATPProtectionPolicyRule -ErrorAction SilentlyContinue | Where-Object { $_.Name -like ${namePattern} } | Select-Object -First 1; ` +
          `if ($atp${varSuffix} -and $atp${varSuffix}.State -ne 'Enabled') { Enable-ATPProtectionPolicyRule -Identity $atp${varSuffix}.Name -Confirm:$false | Out-Null } ` +
          `elseif (-not $atp${varSuffix}) { Write-Host ('${tierLabel} ATP preset rule not found via name pattern.') } }`;

        const ensureEnabledTier = (varSuffix, namePattern, ruleName, tierType, tierLabel) => [
          ensureEopRule(varSuffix, namePattern, ruleName, tierType, tierLabel),
          ensureAtpRule(varSuffix, namePattern, ruleName, tierType, tierLabel),
        ];

        // Helper: disable a tier's rules if currently enabled.
        // May 3, 2026 — same name-OR-policy-association lookup as ensureEopRule.
        // Without the policy-association branch, a Strict rule renamed by an
        // admin (or named in a non-English Microsoft tenant variant) would be
        // missed → silent no-op → drift on next refresh because the rule we
        // wanted disabled is still enabled.
        // ATP/SafeAttachment lookups are wrapped in `if ($mdoAvailable)` so that
        // on EOP-only tenants (Business Standard) the disable path still turns
        // off the EOP rule and simply skips the (non-existent) ATP cmdlets.
        const ensureDisabled = (varSuffix, namePattern, tierType) => [
          `$hcf${varSuffix}Off = Get-HostedContentFilterPolicy -ErrorAction SilentlyContinue | Where-Object { $_.RecommendedPolicyType -eq '${tierType}' } | Select-Object -First 1`,
          `if ($mdoAvailable) { $sa${varSuffix}Off = Get-SafeAttachmentPolicy -ErrorAction SilentlyContinue | Where-Object { $_.RecommendedPolicyType -eq '${tierType}' } | Select-Object -First 1 }`,
          `$eop${varSuffix}Off = Get-EOPProtectionPolicyRule -ErrorAction SilentlyContinue | Where-Object { ($_.Name -like ${namePattern} -or ($hcf${varSuffix}Off -and ($_.HostedContentFilterPolicy -eq $hcf${varSuffix}Off.Name -or $_.HostedContentFilterPolicy -eq $hcf${varSuffix}Off.Identity))) -and $_.State -eq 'Enabled' } | Select-Object -First 1`,
          `if ($mdoAvailable) { $atp${varSuffix}Off = Get-ATPProtectionPolicyRule -ErrorAction SilentlyContinue | Where-Object { ($_.Name -like ${namePattern} -or ($sa${varSuffix}Off -and ($_.SafeAttachmentPolicy -eq $sa${varSuffix}Off.Name -or $_.SafeAttachmentPolicy -eq $sa${varSuffix}Off.Identity))) -and $_.State -eq 'Enabled' } | Select-Object -First 1 }`,
          `if ($eop${varSuffix}Off) { Disable-EOPProtectionPolicyRule -Identity $eop${varSuffix}Off.Name -Confirm:$false | Out-Null }`,
          `if ($mdoAvailable -and $atp${varSuffix}Off) { Disable-ATPProtectionPolicyRule -Identity $atp${varSuffix}Off.Name -Confirm:$false | Out-Null }`,
        ];

        if (chosen === 'standard') {
          return [
            ...preamble,
            ...ensureEnabledTier('Std', STD_PATTERN, STD_NAME, 'Standard', 'Standard'),
            ...ensureDisabled('Strict', STRICT_PATTERN, 'Strict'),
          ].join('; ');
        }
        if (chosen === 'standard_strict') {
          return [
            ...preamble,
            ...ensureEnabledTier('Std', STD_PATTERN, STD_NAME, 'Standard', 'Standard'),
            ...ensureEnabledTier('Strict', STRICT_PATTERN, STRICT_NAME, 'Strict', 'Strict'),
          ].join('; ');
        }
        if (chosen === 'strict_only') {
          // Mirror of the 'standard' branch with the tiers swapped: enable
          // Strict, disable Standard. Same already-enabled / name-OR-policy
          // guards, so it's safe to re-run (idempotent) and EOP-only tenants
          // skip the ATP cmdlets inside the helpers.
          return [
            ...preamble,
            ...ensureEnabledTier('Strict', STRICT_PATTERN, STRICT_NAME, 'Strict', 'Strict'),
            ...ensureDisabled('Std', STD_PATTERN, 'Standard'),
          ].join('; ');
        }
        // chosen === 'disabled' — turn off both presets if either is on
        return [mdoDetect, ...ensureDisabled('Std', STD_PATTERN, 'Standard'), ...ensureDisabled('Strict', STRICT_PATTERN, 'Strict')].join('; ');
      },
      // captureBaseline (Apr 26, 2026 v2): when Apply/Match/Accept fires,
      // record both the chosen tier AND a snapshot of the impersonation lists
      // at that moment. Drift detection then catches list changes too, not
      // just rule-state changes. Returns a rich object that gets stored as
      // applied_value (replacing the simple primitive that earlier writers
      // store). The matches() function below detects rich vs primitive at
      // runtime so both forms keep working.
      //
      // For the 'disabled' tier, no snapshot is captured (rules are off, no
      // lists to track).
      captureBaseline: (chosenValue, currentValue) => {
        const base = { tier: chosenValue };
        if (chosenValue === 'standard' || chosenValue === 'standard_strict') {
          base.standard_lists = {
            targeted_users:    [...(currentValue?.standard_targeted_users || [])].sort(),
            targeted_domains:  [...(currentValue?.standard_targeted_domains || [])].sort(),
            excluded_domains:  [...(currentValue?.standard_excluded_domains || [])].sort(),
          };
        }
        if (chosenValue === 'standard_strict' || chosenValue === 'strict_only') {
          base.strict_lists = {
            targeted_users:    [...(currentValue?.strict_targeted_users || [])].sort(),
            targeted_domains:  [...(currentValue?.strict_targeted_domains || [])].sort(),
            excluded_domains:  [...(currentValue?.strict_excluded_domains || [])].sort(),
          };
        }
        return base;
      },
      // extractChosen: when Remediate Restore re-applies the baseline, the
      // applied_value from DB is a rich object (or primitive for legacy rows
      // applied before Apr 26 v2). Pull out the tier primitive for the cmdlet.
      // Defensive against both shapes for backwards compatibility.
      extractChosen: (applied) => {
        if (applied && typeof applied === 'object' && !Array.isArray(applied) && 'tier' in applied) {
          return applied.tier;
        }
        return applied;
      },
      // matches() handles BOTH rich applied (with snapshot) and primitive
      // applied (legacy or current_matches_option calls with opt.value).
      // Runtime detection via 'tier' key presence:
      //   primitive 'standard' → state-only check (used by current_matches_option)
      //   rich {tier:'standard', standard_lists:{...}} → state + lists check (drift)
      //
      // Strict matching: chosen state must EXACTLY equal current state. A
      // tenant with both presets on doesn't match "standard" — it only matches
      // "standard_strict". Strict-without-Standard matches "strict_only" (added
      // Jun 11, 2026) so Accept Drift can adopt it; before that it matched no
      // option and dead-ended Accept ("does not correspond to any documented
      // option"), forcing the operator to Apply an explicit value.
      matches: (applied, current) => {
        if (!current || typeof current !== 'object') return false;
        const isRich = applied && typeof applied === 'object' && !Array.isArray(applied) && 'tier' in applied;
        const tier = isRich ? applied.tier : applied;

        // State check (always)
        const eopStd    = !!current.eop_standard_enabled;
        const atpStd    = !!current.atp_standard_enabled;
        const eopStrict = !!current.eop_strict_enabled;
        const atpStrict = !!current.atp_strict_enabled;
        // Jun 3, 2026 — on EOP-only tenants (no Defender for Office 365, e.g.
        // Business Standard) the ATP rules structurally don't exist, so the
        // atp_* flags are always false even when the preset is fully applied.
        // Only require the ATP half when MDO is actually present, otherwise the
        // preset reads as perpetual drift on these tenants (eopStd && atpStd
        // could never both be true). mdo_available defaults true for back-compat.
        const mdoAvailable = current.mdo_available !== false;
        let stateOk;
        if (tier === 'standard_strict')   stateOk = eopStd && eopStrict && (mdoAvailable ? (atpStd && atpStrict) : true);
        else if (tier === 'standard')      stateOk = eopStd && !eopStrict && (mdoAvailable ? (atpStd && !atpStrict) : true);
        else if (tier === 'strict_only')   stateOk = !eopStd && eopStrict && (mdoAvailable ? (!atpStd && atpStrict) : true);
        else if (tier === 'disabled')      stateOk = !eopStd && !eopStrict && (mdoAvailable ? (!atpStd && !atpStrict) : true);
        else return false;
        if (!stateOk) return false;

        // Snapshot check — only for rich applied with a captured baseline
        if (!isRich) return true;
        // Normalise out empty/blank entries before comparing. On EOP-only
        // tenants the anti-phish policy's impersonation properties are $null,
        // which the reader can serialise as [""] (a single empty string) rather
        // than []. Filtering blanks makes [""] and [] compare equal, so a clean
        // reader emitting [] never drifts against a legacy [""] baseline.
        const arrEq = (a, b) => {
          const norm = v => (Array.isArray(v) ? v : []).filter(x => x != null && String(x).trim() !== '');
          const arrA = norm(a);
          const arrB = norm(b);
          if (arrA.length !== arrB.length) return false;
          for (let i = 0; i < arrA.length; i++) if (arrA[i] !== arrB[i]) return false;
          return true;
        };
        if (applied.standard_lists) {
          const sl = applied.standard_lists;
          if (!arrEq(sl.targeted_users,   current.standard_targeted_users))   return false;
          if (!arrEq(sl.targeted_domains, current.standard_targeted_domains)) return false;
          if (!arrEq(sl.excluded_domains, current.standard_excluded_domains)) return false;
        }
        if (applied.strict_lists) {
          const sl = applied.strict_lists;
          if (!arrEq(sl.targeted_users,   current.strict_targeted_users))     return false;
          if (!arrEq(sl.targeted_domains, current.strict_targeted_domains))   return false;
          if (!arrEq(sl.excluded_domains, current.strict_excluded_domains))   return false;
        }
        return true;
      },
      // Apr 30, 2026 — i18n Phase 6. Five fixed labels by boolean combo.
      interpret: (current) => {
        if (!current || typeof current !== 'object') return null;
        const strictEnabled   = !!(current.eop_strict_enabled   || current.atp_strict_enabled);
        const standardEnabled = !!(current.eop_standard_enabled || current.atp_standard_enabled);
        if (strictEnabled && standardEnabled) return { template_key: 'security_settings.EXO-06.interpreted.both_enabled', params: {} };
        if (strictEnabled)   return { template_key: 'security_settings.EXO-06.interpreted.strict_only', params: {} };
        if (standardEnabled) return { template_key: 'security_settings.EXO-06.interpreted.standard_only', params: {} };
        if ((current.eop_rule_count || 0) + (current.atp_rule_count || 0) > 0) {
          return { template_key: 'security_settings.EXO-06.interpreted.rules_disabled', params: {} };
        }
        return { template_key: 'security_settings.EXO-06.interpreted.no_preset', params: {} };
      },
    },
  },
  // EXO-07 (Enable Safe Attachments and Safe Links — Global Settings) removed
  // Apr 26, 2026. See /dev/Panoptica/Security_Settings_Backlog.md for the full
  // analysis. Short version: Microsoft's Set-* surface for this setting is
  // broken on Business Premium tenants — Set-AtpPolicyForO365 has no usable
  // Safe Links parameters, and Set-SafeLinksPolicy changes don't propagate to
  // Get-AtpPolicyForO365's aggregate. The Standard Preset Security Policy
  // (EXO-06) covers the practical need for SMB tenants. Re-evaluate ~Q4 2026
  // to see if Microsoft has fixed the aggregate or exposed a working API.
  {
    setting_id: 'EXO-08',
    name: 'Disable Basic Auth for SMTP AUTH Submission',
    category: 'exchange',
    priority: 'high',
    poll_strategy: 'powershell_exo',
    poll_key: 'Get-TransportConfig | Select SmtpClientAuthenticationDisabled',
    description: 'Turns off SMTP AUTH (authenticated SMTP submission on port 587) at the tenant level, with the expectation that specific service accounts or legacy line-of-business mailboxes that actually need it get it re-enabled individually.',
    security_impact: 'SMTP AUTH uses basic username/password authentication, which bypasses MFA entirely. Attackers running credential-stuffing campaigns target SMTP AUTH because a single correct password gets them into the mailbox with no MFA prompt. Disabling it globally closes a major bypass.',
    user_impact: 'Users will not notice any change on modern Outlook or Outlook on the Web — those use modern auth. Impact is only on legacy scanners, printers, and line-of-business apps that send email directly via SMTP AUTH. Those need to be identified, migrated to Graph-based sending, or exempted explicitly.',
    admin_notes: 'Before applying, audit the tenant\'s scanners, multi-function printers, and any in-house app that sends email. For each still on SMTP AUTH, plan a migration to Graph sendMail or to an SMTP relay that uses app passwords with a dedicated service account.',
    licence_required: null,
    writer: {
      strategy: 'powershell_exo',
      ui: 'toggle',
      recommended_label: 'Setting this to "Disabled" turns off basic-auth SMTP submission tenant-wide. Per-mailbox overrides are still possible for specific service accounts that genuinely need SMTP AUTH.',
      options: [
        { value: true,  label: 'SMTP AUTH disabled tenant-wide (recommended)', recommended: true },
        { value: false, label: 'SMTP AUTH enabled tenant-wide (basic-auth credential-stuffing exposure)', danger: true },
      ],
      // Single Set-TransportConfig with one boolean. Idempotent.
      buildPwshCmdlet: (chosenDisabled) =>
        `Set-TransportConfig -SmtpClientAuthenticationDisabled $${!!chosenDisabled}`,
      // The reader returns smtp_client_auth_disabled which can be true|false|null.
      // Treat null (Microsoft default) as a non-match for either explicit option —
      // operator can Apply to set explicit state.
      matches: (chosenDisabled, current) => {
        if (!current || typeof current !== 'object') return false;
        const flag = current.smtp_client_auth_disabled;
        if (flag === null || flag === undefined) return false;
        return !!flag === !!chosenDisabled;
      },
      // Apr 30, 2026 — i18n Phase 6 architecture. Returns a structured
      // {template_key, params} pair that the UI translates at render time
      // via window.t(). Supersedes the per-reader inline English string and
      // the legacy extractInterpretedFromCurrent() switch in api-security.js.
      // Locale keys live under security_settings.<id>.interpreted.<state>.
      interpret: (current) => {
        if (!current || typeof current !== 'object') return null;
        const flag = current.smtp_client_auth_disabled;
        if (flag === true)  return { template_key: 'security_settings.EXO-08.interpreted.disabled', params: {} };
        if (flag === false) return { template_key: 'security_settings.EXO-08.interpreted.enabled',  params: {} };
        return { template_key: 'security_settings.EXO-08.interpreted.default', params: {} };
      },
    },
  },

  {
    // ──────────────────────────────────────────────────────────────────
    // EXO-09 — Strict Mailbox Audit Posture (Bypass + Action List)
    //
    // Companion to EXO-03. EXO-03 turns AuditEnabled on; EXO-09 catches the
    // two ways audit can still produce zero events even with AuditEnabled=True:
    //   1. AuditBypassAssociation=True silently disables logging for that
    //      mailbox. Common on shared / resource mailboxes set up via
    //      PowerShell pre-2019.
    //   2. AuditOwner action list missing critical actions (especially
    //      MailItemsAccessed) — without those, the entire MailItemsAccessed
    //      UAL detection produces no events for owner-driven reads.
    //
    // Required prerequisite for the MailItemsAccessed and HardDelete spike
    // UAL detections (UAL Phase 4 follow-up). Apply EXO-03 first → EXO-09
    // second.
    //
    // Shipped May 5, 2026 as part of UAL Phase 3.
    // ──────────────────────────────────────────────────────────────────
    setting_id: 'EXO-09',
    name: 'Strict Mailbox Audit Posture (Bypass + Action List)',
    category: 'exchange',
    priority: 'critical',
    poll_strategy: 'powershell_exo',
    poll_key: 'Get-Mailbox + Get-MailboxAuditBypassAssociation per audit-enabled mailbox; check AuditBypassEnabled flag and AuditOwner action list',
    description: 'For every audit-enabled user mailbox, ensures AuditBypassAssociation is False (no silent bypass) AND that the AuditOwner action list includes the standard forensic actions Microsoft supports on Business Premium: Create, SoftDelete, HardDelete, Update, Move, MoveToDeletedItems, UpdateFolderPermissions. (MailItemsAccessed for AuditOwner is license-gated above Business Premium — Defender for Office 365 P2 / E3+ required — and is intentionally NOT enforced here.)',
    security_impact: 'The "Enable Mailbox Auditing for All Users" setting turns mailbox auditing on, but mailbox audit can still silently produce zero events two ways: (a) AuditBypassAssociation=True suppresses ALL logging despite AuditEnabled=True — common legacy artifact on shared and resource mailboxes set up via PowerShell pre-2019; (b) the AuditOwner action list can be manually shrunk to exclude critical forensic actions like SoftDelete and HardDelete (evidence destruction) or UpdateFolderPermissions (covert delegation grants). Without this setting in place, "Enable Mailbox Auditing for All Users" can show "all green" while several mailboxes are entirely uninvestigatable. License caveat: MailItemsAccessed for AuditOwner is only available on Defender for Office 365 P2 / E3+ tenants and is NOT enforced by this setting; tenants on those tiers can extend the action list manually via Set-Mailbox.',
    user_impact: 'Users will not notice any change. Apply runs silently in the background and only adjusts internal audit configuration; no impact on mailbox performance, behaviour, or visible Outlook UI.',
    admin_notes: 'Apply "Enable Mailbox Auditing for All Users" first (turn on AuditEnabled), then this setting (lock down bypass + action list). Apply on this setting iterates over the gapped mailboxes, runs Set-MailboxAuditBypassAssociation -AuditBypassEnabled $false on those with bypass set, and Set-Mailbox -AuditOwner with the merged action list on those missing critical actions. On a tenant with many mailboxes that have been configured via PowerShell over the years, Apply may take several minutes — timeout bumped to 5 min. Operators wanting to expand the action list beyond the standard set (e.g. to add MailItemsAccessed on Defender for Office 365 P2 / E3+ tenants) can do so manually via Set-Mailbox; Apply only enforces the Business-Premium-supported baseline and does NOT remove operator additions.',
    licence_required: null,
    writer: {
      strategy: 'powershell_exo',
      ui: 'toggle',
      timeoutMs: 300000,  // 5 min — per-mailbox iteration on bigger tenants
      recommended_label: 'This setting locks down the two silent-disable paths that "Enable Mailbox Auditing for All Users" cannot detect: per-mailbox AuditBypassAssociation flags AND missing critical actions in AuditOwner. Apply ensures every audit-enabled mailbox has AuditBypassEnabled=False and AuditOwner contains the standard set Microsoft supports on Business Premium: Create, SoftDelete, HardDelete, Update, Move, MoveToDeletedItems, UpdateFolderPermissions. (MailItemsAccessed for AuditOwner is license-gated above Business Premium and is intentionally NOT enforced here — extend manually via Set-Mailbox on Defender for Office 365 P2 / E3+ tenants if desired.)',
      options: [
        { value: 'enabled',  label: 'Strict — no bypass, all critical actions audited (recommended)', recommended: true },
        { value: 'disabled', label: 'Permissive — accept bypass flags + partial action lists (forensics gap)', danger: true },
      ],
      // The "enabled" Apply iterates Get-MailboxAuditBypassAssociation per
      // mailbox AND merges the critical action list into AuditOwner. Two
      // distinct cmdlets, both filtered to only mailboxes that need the change
      // so a healthy tenant runs in seconds.
      buildPwshCmdlet: (chosen) => {
        if (chosen === 'enabled') {
          // May 5, 2026 v2 — DIAGNOSTIC mode: per-mailbox errors are now
          // collected and surfaced rather than silently swallowed by an
          // empty catch{} block. Previous version silently no-op'd when
          // Microsoft rejected the Set-Mailbox call, returning a success
          // JSON to the runner so Apply reported APPLIED while doing
          // nothing. Drift would re-detect on the next poll, confusing
          // the operator. New shape: throw at end with the error list so
          // pwsh-runner surfaces it as PWSH_CMDLET back to api-security.js.
          //
          // Also switched the AuditOwner update from @{Add=$missing} to
          // direct assignment of the union of (existing + required, deduped).
          // Direct assignment is cmdlet-syntax-stable across module versions
          // and avoids any ambiguity in how PowerShell unwraps the hashtable
          // value when $missing is an array variable.
          // May 5, 2026 v3 — BULK bypass fetch.
          // Per-mailbox Get-MailboxAuditBypassAssociation took ~2-3s per call.
          // On a 29-mailbox tenant this added ~60-90s to Apply, blowing past
          // the gateway timeout (HTTP 504). Replaced with one bulk fetch +
          // an in-PowerShell hashtable lookup.
          //
          // Identity matching: Get-MailboxAuditBypassAssociation returns a
          // Name property that matches Get-Mailbox's Name (the SAM-style
          // alias). If a mailbox isn't in the bypass map, treat as
          // bypass=false (Microsoft's default for any mailbox without an
          // explicit association record).
          // May 5, 2026 v4 — BULK pipeline Set-Mailbox.
          // v3 reduced bypass-check time but the per-mailbox Set-Mailbox
          // for AuditOwner remained sequential. On a 51-mailbox tenant,
          // 51 sequential ~2s Set calls = ~100-150s, still 504-ing the
          // HTTP gateway. v4 pipes all needing-update mailboxes to ONE
          // Set-Mailbox -AuditOwner @{Add=$required} call. Microsoft's
          // @{Add=...} hashtable is idempotent at the cmdlet level —
          // actions already present on a mailbox are no-ops. EXO V3
          // batches the underlying REST operations so wall-clock time
          // is dominated by the SLOWEST mailbox, not the SUM.
          //
          // Trade-off: per-mailbox error attribution is gone (the
          // pipeline either succeeds or fails as a whole). If errors
          // surface, the reader's next poll will detect remaining gaps
          // and the operator can investigate via Get-Mailbox manually.
          return `
$required = @('Create','SoftDelete','HardDelete','Update','Move','MoveToDeletedItems','UpdateFolderPermissions')

$mboxes = Get-Mailbox -ResultSize Unlimited -Filter 'RecipientTypeDetails -eq "UserMailbox"' | Where-Object { $_.AuditEnabled }
$bypassFixed = 0; $actionsFixed = 0
$errors = @()

# v8 (May 6 2026): fast-path bulk pre-check. On a clean tenant (the common
# case once remediated), a single bulk call tells us tenant-wide whether
# ANY mailbox has bypass=true. If zero, we skip the per-mailbox discovery
# loop entirely — the dominant scaling cost on tenants with hundreds of
# mailboxes. If non-zero, fall through to per-mailbox UPN-based discovery
# (the v7 path) which is needed for accurate identification under Name
# collisions. Bulk failure: -1 forces the slow path defensively.
#
# v7 (May 6 2026 evening): per-mailbox Get-MailboxAuditBypassAssociation
# using UPN (not $mbx.Identity, which is Name and not unique). Mirrors the
# reader. Async-Apply absorbs the latency (~1s per mailbox in a warm EXO V3
# session = ~51s on 51 mailboxes). Replaced v6's broken bulk-fetch + Guid
# hashtable that silently mis-matched orphans.
$mboxesNeedingBypassFix = @()
$anyBypassCount = -1
try {
  $anyBypassCount = @(Get-MailboxAuditBypassAssociation -ResultSize Unlimited -ErrorAction Stop |
    Where-Object { $_.AuditBypassEnabled }).Count
} catch {
  $anyBypassCount = -1
}

if ($anyBypassCount -ne 0) {
  foreach ($mbx in $mboxes) {
    try {
      $b = Get-MailboxAuditBypassAssociation -Identity $mbx.UserPrincipalName -ErrorAction Stop
      if ($b -and $b.AuditBypassEnabled) {
        $mboxesNeedingBypassFix += $mbx
      }
    } catch {
      $errors += "bypass-check[$($mbx.UserPrincipalName)]: $($_.Exception.Message)"
    }
  }
}
$bypassTotal = $mboxesNeedingBypassFix.Count
$bypassIdx = 0
if ($bypassTotal -gt 0) { [Console]::Out.WriteLine("[PANOPTICA-PROGRESS] current=0 total=$bypassTotal message=Clearing audit bypass") }
foreach ($mbx in $mboxesNeedingBypassFix) {
  try {
    Set-MailboxAuditBypassAssociation -Identity $mbx.UserPrincipalName -AuditBypassEnabled $false -ErrorAction Stop
    $bypassFixed++
  } catch {
    $errors += "bypass[$($mbx.UserPrincipalName)]: $($_.Exception.Message)"
  }
  $bypassIdx++
  [Console]::Out.WriteLine("[PANOPTICA-PROGRESS] current=$bypassIdx total=$bypassTotal message=Clearing audit bypass")
}

# AuditOwner fixes — per-mailbox sequential, but using UserPrincipalName
# (globally unique) as the Identity rather than relying on pipeline auto-binding
# from the Name property. v4 attempted to pipe the whole mailbox object, but
# PowerShell's binding picked Name which is NOT unique — tenants with two
# mailboxes named e.g. 'reception' (one UserMailbox + one alias-collision)
# fail with "object 'X' matches multiple entries". UPN is always unique within
# a tenant.
#
# Performance trade-off: sequential calls inside a persistent EXO V3 session
# are ~1s each (much faster than cold ~2-3s). 51 mailboxes ≈ 51s + 10s
# connect overhead = ~60s total. Borderline on default nginx timeouts; bump
# proxy_read_timeout if 504s recur on bigger tenants. Async Apply is the
# proper architectural fix when MSP customers exceed ~100 mailboxes.
$mboxesNeedingActionFix = @($mboxes | Where-Object {
  $owner = if ($_.AuditOwner) { @($_.AuditOwner) } else { @() }
  ($required | Where-Object { $_ -notin $owner }).Count -gt 0
})
$actionsTotal = ($mboxesNeedingActionFix | Measure-Object).Count
$actionsIdx = 0
if ($actionsTotal -gt 0) { [Console]::Out.WriteLine("[PANOPTICA-PROGRESS] current=0 total=$actionsTotal message=Updating AuditOwner action lists") }
# v7 (May 6 2026): pass ONLY the missing actions per mailbox via @{Add=$missing}
# instead of the full $required array. Probe on Trilogiam (May 6 evening) showed
# 5 prior Apply runs landed status=completed with errors=0 but Create + Move
# never persisted on claire.daoud / richard.nault — yet a manual interactive
# Set-Mailbox -AuditOwner @{Add='Create','Move'} immediately worked. Strongly
# suggests app-only auth + @{Add=$required-with-duplicates} hits a silent
# Microsoft-side filter that drops the whole add. Per-mailbox $missing dodges
# the duplicates entirely, mirroring the shape that worked interactively.
foreach ($mbx in $mboxesNeedingActionFix) {
  $owner = if ($mbx.AuditOwner) { @($mbx.AuditOwner) } else { @() }
  $missing = @($required | Where-Object { $_ -notin $owner })
  if ($missing.Count -gt 0) {
    try {
      Set-Mailbox -Identity $mbx.UserPrincipalName -AuditOwner @{Add=$missing} -ErrorAction Stop
      $actionsFixed++
    } catch {
      $errors += "actions[$($mbx.UserPrincipalName)]: $($_.Exception.Message)"
    }
  }
  $actionsIdx++
  [Console]::Out.WriteLine("[PANOPTICA-PROGRESS] current=$actionsIdx total=$actionsTotal message=Updating AuditOwner action lists")
}

if ($errors.Count -gt 0) {
  throw "EXO-09 Apply: bypass_fixed=$bypassFixed actions_fixed=$actionsFixed; $($errors.Count) error(s): $($errors -join ' | ')"
}
"bypass_fixed=$bypassFixed actions_fixed=$actionsFixed errors=0"
`.trim();
        }
        // 'disabled' — operator explicitly opting out of strict posture. We
        // don't actively re-introduce bypass flags or shrink action lists
        // (would be operator self-harm); we just no-op so the policy state
        // stays declarative without making customer worse off.
        return `"EXO-09 set to permissive — no changes applied (this is a posture-marker, not a remediation)"`;
      },
      matches: (chosen, current) => {
        if (!current || typeof current !== 'object') return false;
        const total = current.total_user_mailboxes || 0;
        const bypass = current.bypass_enabled_count || 0;
        const missing = current.missing_owner_actions_count || 0;
        // No mailboxes — vacuous; treat as no-match so operator sees "no data"
        // rather than misleading green.
        if (total === 0) return false;
        if (chosen === 'enabled')  return bypass === 0 && missing === 0;
        if (chosen === 'disabled') return bypass > 0 || missing > 0;
        return false;
      },
      // i18n via security_settings.EXO-09.interpreted.* keys.
      interpret: (current) => {
        if (!current || typeof current !== 'object') return null;
        const total = current.total_user_mailboxes || 0;
        const bypass = current.bypass_enabled_count || 0;
        const missing = current.missing_owner_actions_count || 0;
        if (total === 0) return { template_key: 'security_settings.EXO-09.interpreted.no_mailboxes', params: {} };
        if (bypass === 0 && missing === 0) {
          // `compliant` is a plural template (one/other in locales) — must
          // pass `count` so the i18n resolver picks the right variant.
          // Without `count`, the lookup falls back to the raw template key.
          return { template_key: 'security_settings.EXO-09.interpreted.compliant', params: { count: total, total } };
        }
        if (bypass > 0 && missing > 0) {
          return { template_key: 'security_settings.EXO-09.interpreted.both_gaps', params: { count: total, bypass, missing, total } };
        }
        if (bypass > 0) {
          return { template_key: 'security_settings.EXO-09.interpreted.partial_bypass', params: { count: total, bypass, total } };
        }
        return { template_key: 'security_settings.EXO-09.interpreted.partial_actions', params: { count: total, missing, total } };
      },
    },
  },

  // ══════════ ENTRA ID / IDENTITY ══════════
  {
    setting_id: 'ENT-01',
    name: 'Enable Self-Service Password Reset (SSPR) for All Users',
    category: 'identity',
    priority: 'high',
    poll_strategy: 'graph',
    poll_key: 'GET /policies/authenticationMethodsPolicy',
    description: 'Allows every user in the tenant to reset their own password using their registered authentication methods (phone, email, authenticator app), without filing a helpdesk ticket.',
    security_impact: 'SSPR drives users to register multiple authentication methods, which directly improves MFA coverage and account recovery. It also eliminates helpdesk password-reset workflows, which are a favourite social-engineering target — an attacker who can call the helpdesk and impersonate a user often walks away with a reset password.',
    user_impact: 'Users will be prompted to register authentication methods the next time they sign in. After that, they can reset their own password at aka.ms/sspr without involving the helpdesk.',
    admin_notes: 'Requires Entra ID P1, which is included in Business Premium. Scope should normally be all users. Microsoft has migrated SSPR enablement into the Authentication Methods Policy — there is no longer a single "SSPR on/off" toggle exposed via Graph. Instead: if the right authentication methods are enabled with the right user targets, SSPR works. Apply enables Microsoft Authenticator + SMS + Email auth methods with includeTarget=all_users — the Microsoft-recommended SSPR baseline. Operators wanting more methods (FIDO2, Voice, OATH tokens) configure those manually via the Entra portal; Apply preserves them since each method is a separate sub-resource.',
    licence_required: 'Entra ID P1',
    writer: {
      strategy: 'graph',
      ui: 'select_one',
      recommended_label: 'The "Standard SSPR config" enables Microsoft Authenticator (preferred), SMS (fallback), and Email (recovery) for all users — Microsoft\'s recommended SSPR baseline. Optional advanced methods (FIDO2, TAP, OATH tokens, etc.) can be enabled via the "Additional Authentication Methods" expandable section below.',
      options: [
        { value: 'standard', label: 'Standard SSPR config — Authenticator + SMS + Email enabled for all users (recommended)', recommended: true },
        { value: 'disabled', label: 'Disabled — Authenticator/SMS/Email turned off (no SSPR)', danger: true },
      ],
      // Jun 10, 2026 — per-method model. The secondary section now lists EVERY
      // managed auth method (the core SSPR trio FIRST, then advanced methods)
      // as an independent toggle. The radio above acts as a preset shortcut:
      // "Standard" checks the recommended trio, "Disabled" clears everything.
      // Apply syncs the COMPLETE set — methods checked → enabled+all_users,
      // methods unchecked → disabled — so drift detection catches ANY external
      // change to ANY method, and a partial trio (e.g. dropping SMS) is a
      // first-class, capturable, re-appliable baseline.
      //
      // always_open: render as a flat, always-visible list (no master-toggle
      //   gating — every method matters, so there's nothing to "expand").
      // per_method: tells the frontend to package Apply as {methods:[…]} and
      //   to treat the radio as a preset that mutates the checklist.
      secondary_section: {
        always_open: true,
        per_method: true,
        toggle_label: 'Authentication methods (synced to all users)',
        help: 'Panoptica365 syncs the COMPLETE set: every method you check is enabled for all users; every method you leave unchecked is DISABLED on Apply. The presets above are shortcuts — "Standard" checks the Microsoft-recommended trio, "Disabled" clears everything. SMS is the weakest method; Microsoft recommends moving off it, so you can leave it unchecked and keep SSPR working on Authenticator + Email.',
        // Core SSPR trio first, then advanced. FederatedIdentityCredential is
        // intentionally absent — see SSPR_MANAGED_METHODS comment above.
        options: [
          { id: 'MicrosoftAuthenticator', label: 'Microsoft Authenticator (recommended — push + passwordless)' },
          { id: 'Sms',                   label: 'SMS text message (weakest method — Microsoft recommends moving off it)' },
          { id: 'Email',                 label: 'Email one-time passcode (account recovery)' },
          { id: 'Fido2',                 label: 'FIDO2 Security Keys (passwordless sign-in)' },
          { id: 'TemporaryAccessPass',   label: 'Temporary Access Pass (first-time setup, account recovery)' },
          { id: 'Voice',                 label: 'Voice Call (legacy fallback for accounts without phones)' },
          { id: 'SoftwareOath',          label: 'Software OATH Tokens (third-party authenticator apps)' },
          { id: 'HardwareOath',          label: 'Hardware OATH Tokens (physical OTP devices)' },
          { id: 'X509Certificate',       label: 'X.509 Certificate (smart-card / certificate-based auth)' },
          { id: 'QRCodePin',             label: 'QR Code + PIN (frontline worker scenarios, preview)' },
          { id: 'VerifiableCredentials', label: 'Verifiable Credentials (decentralized identity, preview)' },
        ],
        // Pre-populate the checkboxes from the tenant's current state: every
        // managed method that's currently enabled for all users.
        extractCurrentAdditionals: (currentValue) => _ssprCurrentEnabled(currentValue),
      },
      // Multi-PATCH: one Graph call per auth method configuration. Apply
      // SYNCS the full set — every method we know about gets an explicit
      // PATCH to either enabled+all_users OR disabled. That's required for
      // matches() to reliably detect drift: if Panoptica's baseline says
      // "FIDO2 disabled" but someone enables it via portal, drift fires.
      //
      // CRITICAL CASING: Microsoft Graph beta returns authentication method
      // ids in PascalCase ('MicrosoftAuthenticator', 'Sms', 'Email', etc.),
      // and reader lookup keys are case-sensitive against that response.
      // URL paths are case-insensitive but we use PascalCase for consistency.
      // The @odata.type values use camelCase after the namespace dot
      // (e.g. 'microsoftAuthenticatorAuthenticationMethodConfiguration') —
      // different convention from the id field. Microsoft, not us.
      prepareGraphCalls: (chosen) => {
        // Normalize whatever shape arrives ({methods}, legacy {option,additional},
        // or primitive) into the explicit set of methods that must end up
        // enabled. Everything not in the set is synced to disabled.
        const norm = _ssprEnabledSet(chosen) || { set: new Set() };
        const enabledSet = norm.set;

        // Every method we manage. SSPR baseline first, then advanced.
        // PascalCase ids match the reader's keys + Microsoft's response.
        // The @odata.type values use camelCase suffix per Microsoft convention.
        const methods = [
          { id: 'MicrosoftAuthenticator', odataType: '#microsoft.graph.microsoftAuthenticatorAuthenticationMethodConfiguration', baseline: true  },
          { id: 'Sms',                    odataType: '#microsoft.graph.smsAuthenticationMethodConfiguration',                    baseline: true  },
          { id: 'Email',                  odataType: '#microsoft.graph.emailAuthenticationMethodConfiguration',                  baseline: true  },
          { id: 'Fido2',                  odataType: '#microsoft.graph.fido2AuthenticationMethodConfiguration',                  baseline: false },
          { id: 'TemporaryAccessPass',    odataType: '#microsoft.graph.temporaryAccessPassAuthenticationMethodConfiguration',    baseline: false },
          { id: 'Voice',                  odataType: '#microsoft.graph.voiceAuthenticationMethodConfiguration',                  baseline: false },
          { id: 'SoftwareOath',           odataType: '#microsoft.graph.softwareOathAuthenticationMethodConfiguration',           baseline: false },
          { id: 'HardwareOath',           odataType: '#microsoft.graph.hardwareOathAuthenticationMethodConfiguration',           baseline: false },
          { id: 'X509Certificate',        odataType: '#microsoft.graph.x509CertificateAuthenticationMethodConfiguration',        baseline: false },
          { id: 'QRCodePin',              odataType: '#microsoft.graph.qrCodePinAuthenticationMethodConfiguration',              baseline: false },
          { id: 'VerifiableCredentials',  odataType: '#microsoft.graph.verifiableCredentialsAuthenticationMethodConfiguration',  baseline: false },
          // FederatedIdentityCredential removed — see secondary_section comment
        ];

        const includeTargetsAllUsers = [{ id: 'all_users', targetType: 'group', isRegistrable: true }];
        const includeTargetsEmpty = [];

        return methods.map(m => {
          // Per-method: enabled iff the method is in the chosen baseline set.
          const methodEnabled = enabledSet.has(m.id);
          return {
            method: 'PATCH',
            path: `/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/${m.id}`,
            body: {
              '@odata.type': m.odataType,
              state: methodEnabled ? 'enabled' : 'disabled',
              includeTargets: methodEnabled ? includeTargetsAllUsers : includeTargetsEmpty,
            },
            graph_options: { version: 'beta' },
          };
        });
      },
      // Jun 10, 2026 — per-method comparison. The applied baseline (any of the
      // three shapes) is normalized to an "enabled set"; each managed method
      // must be enabled+all_users iff it's in the set, disabled otherwise.
      // Legacy primitives ('standard'/'disabled') stay trio-only for backward
      // compatibility (strict=false) so pre-v2 baselines don't read as drift.
      matches: (applied, current) => {
        if (!current || typeof current !== 'object') return false;
        const norm = _ssprEnabledSet(applied);
        if (!norm) return false;
        const all = current.all_methods || current.sspr_methods || {};
        const idsToCheck = norm.strict ? SSPR_MANAGED_METHODS : SSPR_TRIO;
        for (const id of idsToCheck) {
          const m = all[id];
          const shouldBeEnabled = norm.set.has(id);
          if (shouldBeEnabled) {
            if (!m || m.state !== 'enabled' || m.all_users !== true) return false;
          } else {
            if (m && m.state === 'enabled') return false;
          }
        }
        return true;
      },
      // Jun 10, 2026 — Accept/Match capture the LIVE method set as the new
      // baseline, regardless of whether it maps to a named preset. This is what
      // lets an operator adopt a legitimate hardening (e.g. SMS removed) without
      // the "does not correspond to any documented option" dead-end. Returns the
      // canonical {methods:[…]} shape. api-security.js prefers this over
      // deriveChosenFromCurrent() whenever a writer defines it.
      captureCurrentBaseline: (currentValue) => ({ methods: _ssprCurrentEnabled(currentValue) }),
      // Apr 30, 2026 — i18n Phase 6. Plural form via params.count.
      interpret: (current) => {
        if (!current || typeof current !== 'object') return null;
        const all = current.all_methods || current.sspr_methods || {};
        const enabledCount = Object.values(all).filter(m => m && m.state === 'enabled').length;
        if (enabledCount === 0) {
          return { template_key: 'security_settings.ENT-01.interpreted.none_enabled', params: {} };
        }
        return { template_key: 'security_settings.ENT-01.interpreted.methods_enabled', params: { count: enabledCount } };
      },
    },
  },
  {
    setting_id: 'ENT-05',
    name: 'Enable Number Matching and Additional Context for MFA Push',
    category: 'identity',
    priority: 'critical',
    poll_strategy: 'graph',
    poll_key: 'GET /policies/authenticationMethodsPolicy/authenticationMethodConfigurations/MicrosoftAuthenticator',
    description: 'Configures Microsoft Authenticator push notifications to require the user to type a number shown on the sign-in screen, and to show the application name and approximate geographic location of the sign-in.',
    security_impact: 'MFA fatigue attacks (also called prompt bombing) work by spamming the user with push notifications until they tap Approve by accident. Number matching breaks this: the user has to see the sign-in screen to know the number, so they cannot approve on reflex. This is one of the highest-ROI MFA hardening steps available.',
    user_impact: 'Users will see a two-digit number on the sign-in screen and be asked to type it into the Authenticator app instead of just tapping Approve. The app will also show which application they are signing into and the approximate city the sign-in is coming from.',
    admin_notes: 'Microsoft enabled number matching for all tenants by default in May 2023 and removed the opt-out — so the only operator-controllable bits are the app-name and location displays. Apply explicitly enables both, which both improves UX clarity AND establishes a baseline so future drift (e.g. an admin experimentally disabling them) is caught.',
    licence_required: null,
    writer: {
      strategy: 'graph',
      graph_path: '/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/microsoftAuthenticator',
      graph_method: 'PATCH',
      graph_options: { version: 'beta' },
      ui: 'select_one',
      recommended_label: 'The recommended configuration enables both app-name and location-context displays alongside Microsoft\'s tenant-default number matching. The two extras make prompt-bombing attacks meaningfully harder by forcing the user to look at the sign-in screen.',
      options: [
        { value: 'enabled_full', label: 'Number matching + app and location context (recommended)', recommended: true },
        { value: 'disabled_context', label: 'Number matching only — no extra context displayed' },
      ],
      // PATCH payload sets all three feature toggles. Number matching is
      // enforced by Microsoft tenant-wide since May 2023 (state=enabled is
      // a no-op on most tenants); we set it explicitly so that if a tenant
      // has the legacy opt-out configured, this restores the enforced state.
      buildPayload: (chosen) => {
        const enabled = (chosen === 'enabled_full');
        const target = (state) => ({
          state,
          includeTarget: { targetType: 'group', id: 'all_users' },
        });
        return {
          state: 'enabled',  // ensure the Authenticator method itself is enabled
          featureSettings: {
            numberMatchingRequiredState: target('enabled'),
            displayAppInformationRequiredState: target(enabled ? 'enabled' : 'disabled'),
            displayLocationInformationRequiredState: target(enabled ? 'enabled' : 'disabled'),
          },
        };
      },
      // matches() only checks the two operator-controllable bits — number
      // matching itself isn't surfaced in the reader's current_value because
      // Microsoft enforces it and there's nothing to verify.
      //
      // May 3, 2026 — Microsoft API quirk fix. The displayApp/Location states
      // are a tri-state enum: 'enabled' | 'disabled' | 'default'. After the
      // May 2023 tenant-wide rollout, 'default' MEANS 'enabled' (Microsoft's
      // managed default for post-rollout tenants is to show app + location).
      // Microsoft's API accepts our PATCH of 'enabled' but normalizes the
      // response to 'default' as the canonical post-rollout representation —
      // creating an eternal drift loop with strict equality.
      //
      // Asymmetric tolerance: when operator wants ENABLED, accept either
      // 'enabled' OR 'default' as a match (both mean "shown to user" post-
      // rollout). When operator wants DISABLED, only accept 'disabled' —
      // 'default' could mean Microsoft is enabling it via the rollout, which
      // is NOT what the operator chose.
      matches: (chosen, current) => {
        if (!current || typeof current !== 'object') return false;
        if (current.authenticator_state !== 'enabled') return false;
        if (chosen === 'enabled_full') {
          const isOn = (v) => v === 'enabled' || v === 'default';
          return isOn(current.display_app_info) && isOn(current.display_location_info);
        }
        // disabled_context: strict — must be explicitly 'disabled'
        return current.display_app_info === 'disabled' && current.display_location_info === 'disabled';
      },
      // Apr 30, 2026 — i18n Phase 6. State enum embedded.
      // May 3, 2026 — same Microsoft tristate quirk as matches(): 'default'
      // means "Microsoft managed, post-rollout default = enabled." Treat
      // 'enabled' OR 'default' as on so the displayed interpretation aligns
      // with the LED state. (Previously: 'default' fell through to the
      // tenant_default template even when LED was green post-fix.)
      interpret: (current) => {
        if (!current || typeof current !== 'object') return null;
        const state = String(current.authenticator_state || 'unknown');
        if (state !== 'enabled') return { template_key: 'security_settings.ENT-05.interpreted.disabled', params: { state } };
        const isOn = (v) => v === 'enabled' || v === 'default';
        const a = current.display_app_info;
        const l = current.display_location_info;
        if (isOn(a) && isOn(l)) return { template_key: 'security_settings.ENT-05.interpreted.full_context', params: {} };
        if (isOn(a) || isOn(l))  return { template_key: 'security_settings.ENT-05.interpreted.partial', params: {} };
        return { template_key: 'security_settings.ENT-05.interpreted.tenant_default', params: {} };
      },
    },
  },
  {
    setting_id: 'ENT-06',
    name: 'Configure Entra ID Password Protection (Banned Password List)',
    category: 'identity',
    priority: 'high',
    poll_strategy: 'graph',
    poll_key: 'GET /directory/onPremisesSynchronization + /policies/passwordProtection',
    description: 'Turns on the global banned-password list and an optional custom list of organisation-specific terms (company name, product names) that users cannot use as passwords, even if the password otherwise meets complexity rules.',
    security_impact: 'Default complexity rules are easy to satisfy with passwords like "Company2024!" — which attackers include in their password-spray dictionaries. Banned-password enforcement rejects these predictable patterns at set-time, which is far more effective than forcing frequent rotation.',
    user_impact: 'Users will see a rejection when they try to set a password that contains a banned term. The error message is clear; they simply pick a different password.',
    admin_notes: 'The global Microsoft-maintained list is free. The custom list (tenant-specific banned terms) requires Entra ID P1. Keep the custom list short and memorable — 8-12 terms covering company name, brand names, and local geographic references. Anything longer has diminishing returns. Apply auto-creates the Password Rule Settings template on first use (POST /groupSettings) and updates it on subsequent edits (PATCH). Default lockout-threshold of 10 and lockout-duration of 60 seconds match Microsoft\'s recommendation; tune via portal if needed.',
    licence_required: 'Entra ID P1 (custom list)',
    writer: {
      strategy: 'graph',
      ui: 'select_one',
      recommended_label: 'Custom banned words catch the company-specific patterns Microsoft\'s global list won\'t — your company name, product names, local geography, founder/exec names. 8-12 terms is the sweet spot. Anything longer has diminishing returns.',
      options: [
        {
          value: 'global_plus_custom',
          label: 'Global Microsoft list + tenant-specific custom banned words (recommended)',
          recommended: true,
          input: {
            multiline: true,
            line_kind: 'word',
            placeholder: 'trilogiam\npanoptica\nmontreal\nquebec',
            help: 'One banned word or phrase per line, 4-16 characters each. These will be rejected when users try to use them in passwords. Microsoft\'s global list of common-passwords is always applied on top of this.',
            empty_ok: false,
            // Microsoft Entra Password Protection enforces these bounds on
            // every entry. Surfacing them client-side prevents the operator
            // from hitting a Graph 400 ("min length of 4, max length of 16")
            // discovered May 3 2026 when 'cae' (3 chars) was attempted.
            min_length: 4,
            max_length: 16,
          },
        },
        {
          value: 'global_only',
          label: 'Global Microsoft list only (no tenant-specific words)',
        },
      ],
      // Pre-populate text area with current custom words if any
      extractInputFromCurrent: (current) => {
        const words = Array.isArray(current?.custom_words) ? current.custom_words : [];
        return words.join('\n');
      },
      // Use prepareGraphCall override — POST creates the Password Rule Settings
      // template if absent, PATCH updates it if present, no-op if "global_only"
      // chosen on a tenant that already has no template.
      prepareGraphCall: (chosen, current) => {
        const isRich = chosen && typeof chosen === 'object' && 'option' in chosen;
        const option = isRich ? chosen.option : chosen;
        const PWD_TEMPLATE_ID = '5cf42378-d67d-4f36-ba46-e8b86229381d';
        const templatePresent = !!current?.template_present;
        const settingsId = current?.settings_id;

        // Build the values array. Microsoft stores BannedPasswordList as a
        // tab-separated string. Lockout defaults match CIS/Microsoft guidance.
        const buildValues = (enableCustom, words) => {
          const tabList = (words || []).join('\t');
          return [
            { name: 'EnableBannedPasswordCheck',     value: String(enableCustom) },
            { name: 'BannedPasswordList',            value: tabList },
            { name: 'LockoutThreshold',              value: '10' },
            { name: 'LockoutDurationInSeconds',      value: '60' },
            { name: 'BannedPasswordCheckOnPremisesMode', value: 'Audit' },
            { name: 'EnableBannedPasswordCheckOnPremises', value: 'true' },
          ];
        };

        if (option === 'global_plus_custom') {
          const inputText = isRich ? String(chosen.input || '') : '';
          const words = inputText
            .split(/\r?\n/)
            .map(s => s.trim().toLowerCase())
            .filter(s => s.length > 0);
          if (words.length === 0) {
            // No words → not a valid "global_plus_custom" state; throw
            // operator-actionable error rather than write empty list which
            // would round-trip to "custom enabled but list empty" state.
            throw new Error('Custom banned-words mode requires at least one word — none provided.');
          }

          if (templatePresent && settingsId) {
            return {
              method: 'PATCH',
              path: `/groupSettings/${settingsId}`,
              body: { values: buildValues(true, words) },
            };
          }
          return {
            method: 'POST',
            path: '/groupSettings',
            body: {
              templateId: PWD_TEMPLATE_ID,
              values: buildValues(true, words),
            },
          };
        }

        // option === 'global_only'
        if (!templatePresent) {
          // Tenant has no template → "global only" is the default state → no-op
          return null;
        }
        // Template exists → PATCH to disable custom check + clear list
        return {
          method: 'PATCH',
          path: `/groupSettings/${settingsId}`,
          body: { values: buildValues(false, []) },
        };
      },
      matches: (applied, current) => {
        if (!current || typeof current !== 'object') return false;
        const isRich = applied && typeof applied === 'object' && 'option' in applied;
        const option = isRich ? applied.option : applied;
        const templatePresent = !!current.template_present;
        const customEnabled = !!current.custom_list_enabled;
        const customWords = Array.isArray(current.custom_words) ? current.custom_words : [];

        if (option === 'global_plus_custom') {
          if (!(templatePresent && customEnabled)) return false;
          if (isRich) {
            const want = String(applied.input || '')
              .split(/\r?\n/)
              .map(s => s.trim().toLowerCase())
              .filter(s => s.length > 0)
              .sort();
            if (want.length !== customWords.length) return false;
            for (let i = 0; i < want.length; i++) {
              if (want[i] !== customWords[i]) return false;
            }
          } else {
            // primitive — just check that custom is enabled with non-empty list
            if (customWords.length === 0) return false;
          }
          return true;
        }
        // 'global_only' — either no template at all, or template exists with custom disabled
        return !templatePresent || (templatePresent && !customEnabled);
      },
      // Apr 30, 2026 — i18n Phase 6. Plural for term count; lockout threshold
      // is a number that flows through unchanged.
      interpret: (current) => {
        if (!current || typeof current !== 'object') return null;
        const templatePresent = !!current.template_present;
        const customEnabled = !!current.custom_list_enabled;
        const customEntries = current.custom_entries || 0;
        const lockout = current.lockout_threshold ?? '?';
        if (!templatePresent) {
          return { template_key: 'security_settings.ENT-06.interpreted.default', params: {} };
        }
        if (customEnabled && customEntries > 0) {
          return {
            template_key: 'security_settings.ENT-06.interpreted.global_plus_custom',
            params: { count: customEntries, lockout },
          };
        }
        if (customEnabled) {
          return { template_key: 'security_settings.ENT-06.interpreted.custom_empty', params: { lockout } };
        }
        return { template_key: 'security_settings.ENT-06.interpreted.global_only', params: { lockout } };
      },
    },
  },
  {
    setting_id: 'ENT-07',
    name: 'Restrict User Consent for Third-Party Applications',
    category: 'identity',
    priority: 'high',
    poll_strategy: 'graph',
    poll_key: 'GET /policies/authorizationPolicy',
    description: 'Changes the tenant\'s application consent policy so end users can no longer grant arbitrary third-party apps access to their mailbox, files, or directory data. All app permission grants route through admin review.',
    security_impact: 'OAuth consent phishing sends a user an innocent-looking link that ends up on a Microsoft consent screen asking for mail-read or file-read permission. Users routinely approve without reading. Restricting user consent forces every new app grant through an admin review queue — stopping this attack vector cold.',
    user_impact: 'Users will no longer be able to approve third-party app permission requests on their own. If they encounter a legitimate app that needs consent, they will see a message asking them to request admin approval. The MSP receives these requests and approves them case-by-case.',
    admin_notes: 'If choosing "Do not allow user consent", set up the admin consent request workflow first — otherwise legitimate app requests get stuck with nowhere to go. Configure the request review recipient to an MSP address that is actually monitored. The doc page at aka.ms/adminconsentrequests walks through the setup. The "Microsoft-managed" option is the safest baseline for tenants without an admin-consent workflow yet.',
    licence_required: null,
    writer: {
      strategy: 'graph',
      graph_path: '/policies/authorizationPolicy',
      graph_method: 'PATCH',
      ui: 'select_one',
      recommended_label: 'Microsoft now recommends "Let Microsoft manage your consent settings" — they auto-update the underlying policy as their guidance evolves. Choose "Do not allow user consent" only if you have an admin-consent request workflow set up and monitored.',
      // Values are the strings stored in defaultUserRolePermissions.permissionGrantPoliciesAssigned.
      // Microsoft Graph accepts the full prefixed form (ManagePermissionGrantsForSelf.{policyId}).
      // The reader recognises both bare and prefixed forms via .includes() substring match.
      options: [
        { value: ['ManagePermissionGrantsForSelf.microsoft-user-default-recommended'], label: 'Let Microsoft manage your consent settings (recommended)', recommended: true },
        { value: [], label: 'Do not allow user consent (admin-consent workflow required)' },
        { value: ['ManagePermissionGrantsForSelf.microsoft-user-default-low'], label: 'Allow user consent for verified publishers, low-impact permissions only' },
      ],
      buildPayload: (chosenArray) => ({
        defaultUserRolePermissions: { permissionGrantPoliciesAssigned: chosenArray },
      }),
      // Match is loose — current array may carry extra entries (e.g. the
      // "popular Mail clients" exception sub-checkbox). We treat it as a
      // match if the chosen mode's policy ID is present in the current array
      // (or if BOTH are empty for the "no user consent" case).
      matches: (chosenArray, currentValue) => {
        if (!currentValue || typeof currentValue !== 'object') return false;
        const currentArr = Array.isArray(currentValue.permissionGrantPoliciesAssigned)
          ? currentValue.permissionGrantPoliciesAssigned : [];
        if (chosenArray.length === 0) return currentArr.length === 0;
        // For each chosen policy ID, check that current array contains a string with the same suffix.
        return chosenArray.every(chosen => {
          const suffix = String(chosen).split('.').pop();
          return currentArr.some(c => typeof c === 'string' && c.includes(suffix));
        });
      },
      // Apr 30, 2026 — i18n Phase 6. Five branches; custom case carries count.
      interpret: (current) => {
        if (!current || typeof current !== 'object') return null;
        const a = Array.isArray(current.permissionGrantPoliciesAssigned) ? current.permissionGrantPoliciesAssigned : [];
        if (a.length === 0) return { template_key: 'security_settings.ENT-07.interpreted.restricted', params: {} };
        if (a.some(p => typeof p === 'string' && p.includes('microsoft-user-default-legacy')))     return { template_key: 'security_settings.ENT-07.interpreted.open_legacy', params: {} };
        if (a.some(p => typeof p === 'string' && p.includes('microsoft-user-default-recommended'))) return { template_key: 'security_settings.ENT-07.interpreted.microsoft_managed', params: {} };
        if (a.some(p => typeof p === 'string' && p.includes('microsoft-user-default-low')))         return { template_key: 'security_settings.ENT-07.interpreted.low_risk_only', params: {} };
        return { template_key: 'security_settings.ENT-07.interpreted.custom_count', params: { count: a.length } };
      },
    },
  },
  // ENT-08 (Continuous Access Evaluation) removed Apr 26, 2026.
  // Managed by the existing CA Policies module — see Phase B v1 architectural
  // decision: settings fully covered by other Panoptica modules are excluded
  // from the Security Settings Engine to avoid duplicate management surface.
  {
    setting_id: 'ENT-09',
    name: 'Disable Guest User Default Permissions',
    category: 'identity',
    priority: 'medium',
    poll_strategy: 'graph',
    poll_key: 'GET /policies/authorizationPolicy (guestUserRoleId)',
    description: 'Tightens the default permissions assigned to guest users when they are invited into the tenant, so they cannot enumerate the directory (users, groups, devices) beyond what they specifically need.',
    security_impact: 'Default guest permissions let an invited outsider browse a surprising amount of the directory — full group list, full user list, device names. If a guest account gets compromised, that becomes a reconnaissance toolkit. The Restricted role removes this.',
    user_impact: 'Guest users will not see the organisation\'s global address list or group directory. They continue to see the specific teams, channels, and files they have been explicitly added to.',
    admin_notes: 'Test with a sample guest account in each tenant before widespread rollout — a small percentage of tenants rely on guests being able to browse membership, and the change will need to be explained. Low rate of legitimate impact; high reconnaissance-prevention value.',
    licence_required: null,
    writer: {
      strategy: 'graph',
      graph_path: '/policies/authorizationPolicy',
      graph_method: 'PATCH',
      ui: 'select_one',
      recommended_label: 'Microsoft recommends Restricted Guest User for tenants that do not need guests browsing the directory.',
      options: [
        { value: '2af84b1e-32c8-42b7-82bc-daa82404023b', label: 'Restricted Guest User (recommended)', recommended: true },
        { value: '10dae51f-b6af-4016-8d66-8c2a99b929b3', label: 'Guest User (default — limited)' },
        { value: 'a0b1b346-4d3e-4e8b-98f8-753987be4970', label: 'Same as member user (NOT recommended)', danger: true },
      ],
      buildPayload: (chosenGuid) => ({ guestUserRoleId: chosenGuid }),
      matches: (chosenGuid, currentValue) =>
        currentValue && typeof currentValue === 'object' &&
        currentValue.guestUserRoleId === chosenGuid,
      // Apr 30, 2026 — i18n Phase 6. Maps the three known role-template GUIDs;
      // unknown GUID falls through with the raw id as a param.
      interpret: (current) => {
        if (!current || typeof current !== 'object') return null;
        const id = String(current.guestUserRoleId || '');
        const map = {
          '10dae51f-b6af-4016-8d66-8c2a99b929b3': 'guest_limited',
          '2af84b1e-32c8-42b7-82bc-daa82404023b': 'restricted',
          'a0b1b346-4d3e-4e8b-98f8-753987be4970': 'member_equivalent',
        };
        const slug = map[id];
        if (slug) return { template_key: `security_settings.ENT-09.interpreted.${slug}`, params: {} };
        return { template_key: 'security_settings.ENT-09.interpreted.unknown', params: { roleId: id } };
      },
    },
  },
  // ENT-10 … ENT-13 — Entra authorization-policy toggles (Purple Knight, Jun 11 2026).
  // All four read GET /policies/authorizationPolicy (Policy.Read.All) and PATCH it
  // (Policy.ReadWrite.Authorization) — the SAME endpoint + consent ENT-07/ENT-09
  // already use, so no new admin consent on any tenant. Monitored-state-with-context,
  // NOT must-be-hardened alarms (allowedToCreateApps=false / restrictive invites break
  // legitimate workflows on some tenants — mirror ENT-09's measured tone).
  {
    setting_id: 'ENT-10',
    name: 'Restrict App Registrations to Admins',
    category: 'identity',
    priority: 'medium',
    poll_strategy: 'graph',
    poll_key: 'GET /policies/authorizationPolicy (defaultUserRolePermissions.allowedToCreateApps)',
    description: 'Stops standard (non-admin) users from registering new Entra application registrations. New app registrations route through an admin instead.',
    security_impact: 'A compromised user account can register an application and use it for persistence, lateral movement, reconnaissance, or data exfiltration via delegated/app permissions. Restricting registration to admins removes a quiet attacker foothold.',
    user_impact: 'Users will no longer be able to self-register apps in Entra. Developers or power users who genuinely need this will ask an admin. Most SMB users never use this.',
    admin_notes: 'Safe to restrict in the large majority of SMB tenants. Before applying, confirm no line-of-business workflow relies on self-service app registration (rare). Reversible with a single PATCH.',
    licence_required: null,
    writer: {
      strategy: 'graph',
      graph_path: '/policies/authorizationPolicy',
      graph_method: 'PATCH',
      ui: 'toggle',
      recommended_label: 'Microsoft recommends restricting app registration to administrators for tenants without a developer self-service need.',
      options: [
        { value: false, label: 'Admins only (recommended)', recommended: true },
        { value: true,  label: 'All users can register apps (Microsoft default)', danger: true },
      ],
      buildPayload: (chosenAllow) => ({ defaultUserRolePermissions: { allowedToCreateApps: !!chosenAllow } }),
      matches: (chosenAllow, current) =>
        current && typeof current === 'object' &&
        !!current.allowedToCreateApps === !!chosenAllow,
      interpret: (current) => {
        if (!current || typeof current !== 'object') return null;
        return current.allowedToCreateApps
          ? { template_key: 'security_settings.ENT-10.interpreted.all_users', params: {} }
          : { template_key: 'security_settings.ENT-10.interpreted.admins_only', params: {} };
      },
    },
  },
  {
    setting_id: 'ENT-11',
    name: 'Restrict Security Group Creation to Admins',
    category: 'identity',
    priority: 'medium',
    poll_strategy: 'graph',
    poll_key: 'GET /policies/authorizationPolicy (defaultUserRolePermissions.allowedToCreateSecurityGroups)',
    description: 'Stops standard (non-admin) users from creating new Entra security groups. New security-group creation routes through an admin instead.',
    security_impact: 'Self-service security-group creation lets any user spin up groups that can later be granted access to apps, resources, or roles. A compromised account can use this to engineer access paths or muddy the access-review picture. Restricting creation to admins keeps the group inventory clean and intentional.',
    user_impact: 'Users will no longer be able to create their own security groups; those who need one ask an admin. This covers security groups only — Microsoft 365 Group creation (Teams, Planner, etc.) is a separate control and is unaffected.',
    admin_notes: 'Safe to restrict in most SMB tenants. This setting covers security groups ONLY; Microsoft 365 Group creation is governed by a separate directory group setting and is out of scope here. Reversible with a single PATCH.',
    licence_required: null,
    writer: {
      strategy: 'graph',
      graph_path: '/policies/authorizationPolicy',
      graph_method: 'PATCH',
      ui: 'toggle',
      recommended_label: 'Microsoft recommends restricting security-group creation to administrators for tenants that do not need end-user self-service groups.',
      options: [
        { value: false, label: 'Admins only (recommended)', recommended: true },
        { value: true,  label: 'All users can create security groups (Microsoft default)', danger: true },
      ],
      buildPayload: (chosenAllow) => ({ defaultUserRolePermissions: { allowedToCreateSecurityGroups: !!chosenAllow } }),
      matches: (chosenAllow, current) =>
        current && typeof current === 'object' &&
        !!current.allowedToCreateSecurityGroups === !!chosenAllow,
      interpret: (current) => {
        if (!current || typeof current !== 'object') return null;
        return current.allowedToCreateSecurityGroups
          ? { template_key: 'security_settings.ENT-11.interpreted.all_users', params: {} }
          : { template_key: 'security_settings.ENT-11.interpreted.admins_only', params: {} };
      },
    },
  },
  {
    setting_id: 'ENT-12',
    name: 'Restrict Tenant Creation to Admins',
    category: 'identity',
    priority: 'low',
    poll_strategy: 'graph',
    poll_key: 'GET /policies/authorizationPolicy (defaultUserRolePermissions.allowedToCreateTenants)',
    description: 'Stops standard (non-admin) users from creating brand-new Entra tenants from this directory. New-tenant creation routes through an admin instead.',
    security_impact: 'When any user can create a tenant, they become Global Administrator of a brand-new directory the MSP does not manage or monitor — a shadow-IT / unmanaged-tenant risk that can hold corporate data outside every guardrail. Restricting creation to admins removes that escape hatch. Low real-world frequency, but high blast radius when it happens.',
    user_impact: 'Users will no longer be able to create new Entra tenants. This is an action almost no standard user ever needs to take.',
    admin_notes: 'Safe to restrict in essentially every SMB tenant — legitimate need for end-user tenant creation is vanishingly rare. Reversible with a single PATCH.',
    licence_required: null,
    writer: {
      strategy: 'graph',
      graph_path: '/policies/authorizationPolicy',
      graph_method: 'PATCH',
      ui: 'toggle',
      recommended_label: 'Microsoft recommends restricting tenant creation to administrators; standard users almost never have a legitimate need to create a new tenant.',
      options: [
        { value: false, label: 'Admins only (recommended)', recommended: true },
        { value: true,  label: 'All users can create tenants (Microsoft default)', danger: true },
      ],
      buildPayload: (chosenAllow) => ({ defaultUserRolePermissions: { allowedToCreateTenants: !!chosenAllow } }),
      matches: (chosenAllow, current) =>
        current && typeof current === 'object' &&
        !!current.allowedToCreateTenants === !!chosenAllow,
      interpret: (current) => {
        if (!current || typeof current !== 'object') return null;
        return current.allowedToCreateTenants
          ? { template_key: 'security_settings.ENT-12.interpreted.all_users', params: {} }
          : { template_key: 'security_settings.ENT-12.interpreted.admins_only', params: {} };
      },
    },
  },
  {
    setting_id: 'ENT-13',
    name: 'Restrict Who Can Invite Guests',
    category: 'identity',
    priority: 'medium',
    poll_strategy: 'graph',
    poll_key: 'GET /policies/authorizationPolicy (allowInvitesFrom)',
    description: 'Controls who in the tenant is allowed to invite external guest users. Prevents existing guests from inviting further guests.',
    security_impact: 'When guests can invite other guests, a single compromised guest account can pull more outsiders into the tenant to create persistence and move laterally. Limiting invitations to members (or admins) removes that self-propagation path.',
    user_impact: 'Guests will no longer be able to send guest invitations. Internal members (and admins) continue to invite partners normally.',
    admin_notes: 'The Microsoft default (members + admins can invite, guests cannot) resolves the finding and is non-disruptive for almost every tenant. Choose "Admins and designated inviters only" for tighter control where business users should not be inviting outsiders at all.',
    licence_required: null,
    writer: {
      strategy: 'graph',
      graph_path: '/policies/authorizationPolicy',
      graph_method: 'PATCH',
      ui: 'select_one',
      recommended_label: 'Microsoft default ("Member users and admins") stops guests inviting guests while keeping normal partner collaboration. Tighten to admins-only where business users should never invite externals.',
      options: [
        { value: 'adminsGuestInvitersAndAllMembers', label: 'Members and admins can invite (recommended — Microsoft default)', recommended: true },
        { value: 'adminsAndGuestInviters',           label: 'Admins and designated inviters only (hardened)' },
        { value: 'none',                             label: 'No one can invite guests (most restrictive)' },
        { value: 'everyone',                         label: 'Anyone including guests can invite (NOT recommended)', danger: true },
      ],
      buildPayload: (chosenEnum) => ({ allowInvitesFrom: chosenEnum }),
      matches: (chosenEnum, current) =>
        current && typeof current === 'object' &&
        current.allowInvitesFrom === chosenEnum,
      interpret: (current) => {
        if (!current || typeof current !== 'object') return null;
        const v = String(current.allowInvitesFrom || '');
        const known = ['none', 'adminsAndGuestInviters', 'adminsGuestInvitersAndAllMembers', 'everyone'];
        return known.includes(v)
          ? { template_key: `security_settings.ENT-13.interpreted.${v}`, params: {} }
          : { template_key: 'security_settings.ENT-13.interpreted.unknown', params: { value: v } };
      },
    },
  },

  // ══════════ SHAREPOINT ONLINE ══════════
  {
    setting_id: 'SPO-01',
    name: 'Restrict External Sharing (Limit to Existing Guests or Disable)',
    category: 'sharepoint',
    priority: 'high',
    poll_strategy: 'graph',
    poll_key: 'GET /admin/sharepoint/settings (sharingCapability + sharingDomainRestrictionMode)',
    description: 'Changes the tenant\'s default SharePoint and OneDrive external sharing level to "Existing guests only" or "Only people in your organization", and restricts anonymous "Anyone" links.',
    security_impact: '"Anyone" links give unauthenticated access to whoever has the URL — the link can be forwarded, leaked, or indexed, with no audit trail of who actually read the file. Restricting to authenticated sharing (or disabling external entirely) means every access is tied to a named identity and is loggable.',
    user_impact: 'Users will see fewer sharing options in the Share dialog. "Anyone with the link" will be removed or limited to specific scoped cases. Sharing with existing guests and internal colleagues continues to work normally.',
    admin_notes: 'Most SMB tenants can safely drop to "Existing guests only" without business impact. Before applying, run an audit of active anonymous links — existing links are not retroactively invalidated, but newly-created ones will follow the new policy. The full rollback path is trivial: a single PowerShell call to restore the prior setting.',
    licence_required: null,
    writer: {
      strategy: 'graph',
      graph_path: '/admin/sharepoint/settings',
      graph_method: 'PATCH',
      ui: 'select_one',
      recommended_label: 'Microsoft recommends "Existing guests only" for SMB tenants that share with named partners but never with anonymous users.',
      options: [
        { value: 'existingExternalUserSharingOnly', label: 'Existing guests only (recommended)', recommended: true },
        { value: 'disabled', label: 'Only people in your organization' },
        { value: 'externalUserSharingOnly', label: 'New and existing guests' },
        { value: 'externalUserAndGuestSharing', label: 'Anyone (anonymous links — high risk)', danger: true },
      ],
      buildPayload: (chosenEnum) => ({ sharingCapability: chosenEnum }),
      matches: (chosenEnum, currentValue) =>
        currentValue && typeof currentValue === 'object' &&
        currentValue.sharing_capability === chosenEnum,
      // Apr 30, 2026 — i18n Phase 6. PROSE: composes capability label with
      // optional restriction-mode and reshare suffixes. Each combination
      // gets its own template key (4 capabilities × 3 restriction × 2
      // reshare = 24 in theory, but reshare is rarely combined with
      // restriction, so we enumerate the realistic ones and compose the
      // rest by chaining template_keys via params).
      //
      // Strategy: use a base template_key and pass `restrictionNote` and
      // `reshareNote` as PRE-RENDERED strings. Server-side i18n.t() can
      // resolve these recursively because params are interpolated before
      // returning. Client-side window.t() in security.js does the same.
      // To make this work, we resolve the note keys to their LITERAL
      // template strings here in interpret() — but that loses translation.
      //
      // Better approach (Apr 30 v2): the renderer already only does ONE
      // window.t() call. So we enumerate the 8 realistic combinations as
      // separate keys (cap × reshare/no-reshare with optional restriction
      // baked into the count param). Locale files have those 8 keys.
      interpret: (current) => {
        if (!current || typeof current !== 'object') return null;
        const cap = String(current.sharing_capability || '');
        const mode = String(current.domain_restriction_mode || '');
        const allowed = current.allowed_domains_count || 0;
        const blocked = current.blocked_domains_count || 0;
        const reshare = !!current.external_reshare_enabled;
        // Pick the base capability key.
        const capMap = {
          'disabled': 'disabled',
          'existingExternalUserSharingOnly': 'existing_guests',
          'externalUserSharingOnly': 'auth_guests',
          'externalUserAndGuestSharing': 'anyone',
        };
        const capSlug = capMap[cap] || 'unknown';
        // Restriction suffix as a separate sub-state. We inject the count
        // and partner/blocked terms into the locale template via params.
        let restrictionSlug = 'none';
        let restrictionParams = {};
        if (mode === 'allowList' && allowed > 0) {
          restrictionSlug = 'allowed';
          restrictionParams = { count: allowed };
        } else if (mode === 'blockList' && blocked > 0) {
          restrictionSlug = 'blocked';
          restrictionParams = { count: blocked };
        }
        const reshareSlug = reshare ? 'yes' : 'no';
        if (capSlug === 'unknown') {
          return { template_key: 'security_settings.SPO-01.interpreted.unknown', params: { cap } };
        }
        // Composite template_key: cap__restriction__reshare
        return {
          template_key: `security_settings.SPO-01.interpreted.${capSlug}__${restrictionSlug}__${reshareSlug}`,
          params: restrictionParams,
        };
      },
    },
  },
  // SPO-02 — Restrict OneDrive Sync App on Unmanaged Devices — REMOVED May 4, 2026.
  //
  // Sets `isUnmanagedSyncAppForTenantRestricted=true` via Graph PATCH on
  // /admin/sharepoint/settings. Despite the modern Graph surface, Microsoft's
  // implementation under the hood uses the LEGACY domain-GUID check —
  // `Set-SPOTenantSyncClientRestriction` semantics. Pure cloud-only Entra-
  // joined devices (which are 100% of Jacques' SMB customer profile) get
  // blocked because they have no AD domain GUID, even when Intune-compliant.
  //
  // Real customer impact: May 3, 2026 — a Calogy Solutions user travelling
  // to the US on his Entra-joined + Intune-compliant work device got the
  // "ordinateur joint à un domaine approuvé" error from OneDrive sync.
  // Setting was reverted to false on all tenants and removed from registry.
  //
  // Replacement path: a CA policy template targeting SharePoint Online +
  // OneDrive cloud apps with grant control "Require device to be marked as
  // compliant OR Hybrid Azure AD joined device". Recognizes pure Entra-join
  // properly via Microsoft's modern compliance signal. Ship as a
  // CA Templates entry, not as a Security Setting.
  //
  // Same removal pattern as ENT-08 / CMP-03 / DEF-01..07 (Apr 26 v2/v3):
  // settings managed by other Panoptica modules don't belong in the
  // Security Settings registry.

  // ══════════ TEAMS ══════════
  {
    setting_id: 'TEA-01',
    name: 'Anonymous Meeting Join and Lobby Policy',
    category: 'teams',
    priority: 'high',
    poll_strategy: 'powershell_teams',
    poll_key: 'Get-CsTeamsMeetingPolicy -Identity Global | Select AllowAnonymousUsersToJoinMeeting, AutoAdmittedUsers',
    description: 'Controls whether anonymous users (people without a Microsoft account or with a non-Microsoft email like Google or Yahoo) can join your Teams meetings, and how the meeting lobby holds external participants until an organiser admits them.',
    security_impact: 'Anonymous join means anyone with the meeting link can enter with no authentication — no name, no audit trail. Combined with auto-admit-everyone, this is the configuration that enabled "Zoom-bombing" disruptions and corporate-meeting eavesdropping. The right answer depends on the tenant\'s business model: tenants whose external meeting attendees are always business contacts via federation should block anonymous; tenants running training, coaching, or sales meetings with non-business external customers need anonymous-allowed but lobby-held so the organiser controls admission.',
    user_impact: 'Hardened mode: external participants must sign in with a Microsoft account (any tenant, including personal). Permissive-with-lobby mode: external participants click the link and wait in the lobby until the organiser admits them — works for Google, Yahoo, or any email provider. Open mode: external participants walk straight in without any control.',
    admin_notes: 'CHOOSING THE RIGHT OPTION: Hardened (the original recommended) fits tenants whose external meeting attendees are always other M365 tenant users via federation. If your customer runs training sessions, coaching, sales calls, or any meetings with external NON-Microsoft users (e.g. a customer on Google Workspace), Hardened will block them — verified Apr 28, 2026 when Trilogiam\'s training attendee on Google Workspace was rejected at the verification screen. Permissive-with-lobby is the right answer for those tenants: anonymous can join (they go to lobby), organiser admits them, no Zoom-bombing because nobody auto-admits without organiser action. Open mode is dangerous and should never be the deliberate choice — flagged danger for that reason. Apply modifies the GLOBAL meeting policy; org-specific exception policies are untouched.',
    licence_required: null,
    writer: {
      // Apr 28, 2026 — switched from powershell_teams (cert-based SP) to
      // delegated_teams (operator interactive auth). Microsoft Teams admin
      // Set-Cs* cmdlets refuse cert-based app-only auth on customer tenants
      // via GDAP — verified May 2 2026 on CAE du Val St-François. Operator
      // sign-in via /auth/teams-delegated/login is required before Apply.
      // Reads still use the cert-based SP path (poll_strategy unchanged).
      strategy: 'delegated_teams',
      ui: 'select_one',  // Apr 28 — was toggle (binary); now 3 options
      recommended_label: 'There is NO universal recommendation — choose based on the tenant\'s external-meeting profile. Tenants that only meet with M365 federated partners → Hardened. Tenants running training, coaching, sales, or other meetings with non-business external attendees → Permissive with lobby. Open mode is genuinely dangerous and should never be deliberately chosen.',
      options: [
        { value: 'hardened',              label: 'Hardened — anonymous join blocked + lobby holds external (federated-only meeting tenants)' },
        { value: 'permissive_with_lobby', label: 'Permissive with lobby — anonymous join allowed + lobby holds external (training, coaching, sales meetings)', recommended: true },
        { value: 'open',                  label: 'Open — anonymous join allowed + everyone auto-admits (Zoom-bombing risk)', danger: true },
      ],
      // Single Set-CsTeamsMeetingPolicy on the Global identity. Idempotent.
      // Two axes: AllowAnonymousUsersToJoinMeeting ($true/$false) and
      // AutoAdmittedUsers ('Everyone' / 'EveryoneInCompanyExcludingGuests').
      // The three valid combinations correspond to the three options.
      buildPwshCmdlet: (chosen) => {
        if (chosen === 'hardened') {
          return `Set-CsTeamsMeetingPolicy -Identity Global -AllowAnonymousUsersToJoinMeeting $false -AutoAdmittedUsers 'EveryoneInCompanyExcludingGuests'`;
        }
        if (chosen === 'permissive_with_lobby') {
          return `Set-CsTeamsMeetingPolicy -Identity Global -AllowAnonymousUsersToJoinMeeting $true -AutoAdmittedUsers 'EveryoneInCompanyExcludingGuests'`;
        }
        // open — anonymous + auto-admit-everyone (Zoom-bombing risk).
        // May 3, 2026 — Microsoft enforces a parameter coupling: when
        // AutoAdmittedUsers='Everyone', AllowPSTNUsersToBypassLobby MUST be
        // $true (Microsoft considers "auto-admit everyone but lobby-hold
        // PSTN dial-in" an inconsistent config; rejects with errorCode 40013
        // ErrorInvalidAllowPSTNUsersToBypassLobbyValue). Inverse coupling
        // applies to AutoAdmittedUsers='OrganizerOnly' (PSTN must be $false).
        // Other AutoAdmittedUsers values (EveryoneInCompanyExcludingGuests
        // etc.) accept either PSTN value, so hardened/permissive_with_lobby
        // don't need the explicit param.
        return `Set-CsTeamsMeetingPolicy -Identity Global -AllowAnonymousUsersToJoinMeeting $true -AutoAdmittedUsers 'Everyone' -AllowPSTNUsersToBypassLobby $true`;
      },
      // Apr 28, 2026 (revised May 2) — match is "intent-based" not strict.
      // Microsoft has FOUR valid AutoAdmittedUsers values, three of which
      // qualify as "lobby holds anonymous" (everyone except 'Everyone').
      // Discovered May 2: CAE customer tenant was at AutoAdmittedUsers =
      // 'EveryoneInCompany' (auto-admit org + B2B guests; anonymous in
      // lobby) — a legitimate "permissive with lobby" state. Original
      // matches() only accepted 'EveryoneInCompanyExcludingGuests' which
      // forced a 409 on Match. Now: any non-'Everyone' value qualifies as
      // lobby-held; intent flag (allowAnon) distinguishes hardened vs
      // permissive_with_lobby. Future Apply still uses
      // 'EveryoneInCompanyExcludingGuests' as the canonical write value.
      matches: (chosen, current) => {
        if (!current || typeof current !== 'object') return false;
        const allowAnon = !!current.allow_anonymous;
        const auto = String(current.auto_admitted_users || '').trim();
        const lobbyHolds = auto && auto !== 'Everyone';  // any non-Everyone = lobby holds anon
        if (chosen === 'hardened') {
          return !allowAnon && lobbyHolds;
        }
        if (chosen === 'permissive_with_lobby') {
          return allowAnon && lobbyHolds;
        }
        // open — anonymous + auto-admit-everyone (Zoom-bombing risk)
        return allowAnon && auto === 'Everyone';
      },
      // Apr 30, 2026 — i18n Phase 6. Four states; autoAdmit value embedded.
      interpret: (current) => {
        if (!current || typeof current !== 'object') return null;
        const anon = !!current.allow_anonymous;
        const auto = String(current.auto_admitted_users || '');
        const lobby = current.lobby_holds_external;
        if (!anon && lobby) return { template_key: 'security_settings.TEA-01.interpreted.hardened', params: { autoAdmit: auto } };
        if (!anon)          return { template_key: 'security_settings.TEA-01.interpreted.inconsistent', params: { autoAdmit: auto } };
        if (lobby)          return { template_key: 'security_settings.TEA-01.interpreted.permissive', params: { autoAdmit: auto } };
        return { template_key: 'security_settings.TEA-01.interpreted.open', params: { autoAdmit: auto } };
      },
    },
  },
  {
    setting_id: 'TEA-02',
    name: 'Restrict External Access and Guest Access in Teams',
    category: 'teams',
    priority: 'medium',
    poll_strategy: 'powershell_teams',
    poll_key: 'Get-CsTenantFederationConfiguration + Get-CsTeamsClientConfiguration',
    description: 'Configures Teams federation (the ability for users in other Microsoft 365 tenants to chat and call yours) to an allowlist of approved partner domains, rather than open to every tenant on Earth.',
    security_impact: 'Unrestricted Teams federation means any attacker with any Microsoft 365 tenant can send chat messages to your users with no prior relationship. This has been used for social-engineering attacks and to deliver malicious links bypassing email protection entirely.',
    user_impact: 'Users will no longer receive chats from unknown external tenants. Existing partner communications work unchanged if those domains are on the allowlist. If a new partner needs to be added, the MSP adds the domain to the allowlist — a quick operation.',
    admin_notes: 'Field reality (Jacques, Apr 26): most SMBs leave federation open to other M365 tenants for practicality, but should block personal Microsoft accounts (consumer chat is a phishing vector). Allowlist mode is for tenants with specific named partners and a clear "no other federation" requirement (legal, finance, healthcare). Apply REPLACES the allowlist — operators see the current list pre-populated in the text area before editing, and the Confirm banner shows added/removed domains as a diff before the write fires.',
    licence_required: null,
    writer: {
      // Apr 28, 2026 — switched from powershell_teams (cert-based SP) to
      // delegated_teams (operator interactive auth). Same root cause as
      // TEA-01: Set-CsTenantFederationConfiguration refuses cert-based
      // app-only auth on customer tenants via GDAP. Operator must sign in
      // via /auth/teams-delegated/login before Apply works.
      strategy: 'delegated_teams',
      ui: 'select_one',
      recommended_label: 'Most SMBs want "Open + consumer blocked" — federation works with any M365 tenant for business comms, but personal Microsoft accounts cannot chat your users. Allowlist mode is the most secure but requires per-partner curation. Federation OFF is the most restrictive and may be disruptive.',
      options: [
        {
          value: 'open_no_consumer',
          label: 'Open to other businesses, personal accounts blocked (recommended for most SMBs)',
          recommended: true,
        },
        {
          value: 'allowlist',
          label: 'Federation restricted to specific partner domains (most secure when business needs allow)',
          input: {
            multiline: true,
            line_kind: 'domain',
            placeholder: 'partner1.com\npartner2.com',
            help: 'One partner domain per line. Federation will be allowed only with these specific domains. Personal Microsoft accounts blocked.',
            empty_ok: false,
          },
        },
        {
          value: 'disabled',
          label: 'Federation disabled — no external Teams chat (most restrictive)',
        },
        {
          value: 'open_with_consumer',
          label: 'Open + personal Microsoft accounts allowed (Microsoft default — risky)',
          danger: true,
        },
      ],
      // Pre-populate the text area from the current tenant's allowlist
      extractInputFromCurrent: (current) => {
        const list = Array.isArray(current?.allowlist_domains) ? current.allowlist_domains : [];
        return list.join('\n');
      },
      // CRITICAL: -AllowPublicUsers is NOT a Set-CsTenantFederationConfiguration
      // parameter. The Get-side surfaces it as a property (legacy Skype
      // consumer state) but Microsoft removed the corresponding Set-side
      // parameter — the toggle is now read-only for backward compatibility.
      // Don't pass it. matches() also doesn't require !allowPublic since we
      // can't control it; treat it as ambient tenant state.
      buildPwshCmdlet: (chosen) => {
        const isRich = chosen && typeof chosen === 'object' && 'option' in chosen;
        const option = isRich ? chosen.option : chosen;

        if (option === 'disabled') {
          return `Set-CsTenantFederationConfiguration -AllowFederatedUsers $false -AllowTeamsConsumer $false`;
        }
        if (option === 'open_no_consumer' || option === 'open_with_consumer') {
          // Reset AllowedDomains to "open to all known domains"
          const allowConsumer = option === 'open_with_consumer' ? '$true' : '$false';
          return [
            `$allowAll = New-CsEdgeAllowAllKnownDomains`,
            `Set-CsTenantFederationConfiguration -AllowFederatedUsers $true -AllowTeamsConsumer ${allowConsumer} -AllowedDomains $allowAll`,
          ].join('; ');
        }
        // option === 'allowlist'
        const inputText = isRich ? String(chosen.input || '') : '';
        const domains = inputText.split(/\r?\n/).map(s => s.trim().toLowerCase()).filter(s => s.length > 0);
        if (domains.length === 0) {
          return `throw 'Allowlist mode requires at least one partner domain — none provided.'`;
        }
        // Build PowerShell domain pattern array, then wrap in CsEdgeAllowList
        const patterns = domains.map(d => `(New-CsEdgeDomainPattern -Domain '${d.replace(/'/g, `''`)}')`).join(', ');
        return [
          `$allow = New-CsEdgeAllowList`,
          `$allow.AllowedDomain = @(${patterns})`,
          `Set-CsTenantFederationConfiguration -AllowFederatedUsers $true -AllowTeamsConsumer $false -AllowedDomains $allow`,
        ].join('; ');
      },
      matches: (applied, current) => {
        if (!current || typeof current !== 'object') return false;
        const isRich = applied && typeof applied === 'object' && 'option' in applied;
        const option = isRich ? applied.option : applied;
        const allowFed = !!current.allow_federated_users;
        const allowConsumer = !!current.allow_teams_consumer;
        // allow_public_users is ambient state we cannot set; ignored in matches.
        const allowlist = Array.isArray(current.allowlist_domains) ? current.allowlist_domains : [];

        if (option === 'disabled') {
          return !allowFed && !allowConsumer;
        }
        if (option === 'open_no_consumer') {
          return allowFed && !allowConsumer && allowlist.length === 0;
        }
        if (option === 'open_with_consumer') {
          return allowFed && allowConsumer && allowlist.length === 0;
        }
        if (option === 'allowlist') {
          if (!(allowFed && !allowConsumer && allowlist.length > 0)) return false;
          if (isRich) {
            const want = String(applied.input || '')
              .split(/\r?\n/).map(s => s.trim().toLowerCase()).filter(s => s.length > 0).sort();
            if (want.length !== allowlist.length) return false;
            for (let i = 0; i < want.length; i++) {
              if (want[i] !== allowlist[i]) return false;
            }
          }
          return true;
        }
        return false;
      },
      // Apr 30, 2026 — i18n Phase 6. Federation has 4 base states × consumer
      // warning × blocked-count notes. Variants enumerated as separate keys
      // (no recursive interpolation needed). Plural support on allowlist
      // count via {one, other} on the allowlist_* templates.
      interpret: (current) => {
        if (!current || typeof current !== 'object') return null;
        const fed = !!current.allow_federated_users;
        const consumer = !!current.allow_teams_consumer;
        const allowlistCount = current.allowlist_count || 0;
        const blockCount = current.blocked_domains_count || 0;
        if (!fed) {
          return {
            template_key: consumer
              ? 'security_settings.TEA-02.interpreted.disabled_consumer_allowed'
              : 'security_settings.TEA-02.interpreted.disabled',
            params: {},
          };
        }
        if (allowlistCount > 0) {
          return {
            template_key: consumer
              ? 'security_settings.TEA-02.interpreted.allowlist_consumer_allowed'
              : 'security_settings.TEA-02.interpreted.allowlist',
            params: { count: allowlistCount },
          };
        }
        if (consumer) {
          return {
            template_key: blockCount > 0
              ? 'security_settings.TEA-02.interpreted.open_consumer_allowed_with_blocked'
              : 'security_settings.TEA-02.interpreted.open_consumer_allowed',
            params: { blockCount },
          };
        }
        return {
          template_key: blockCount > 0
            ? 'security_settings.TEA-02.interpreted.open_consumer_blocked_with_blocked'
            : 'security_settings.TEA-02.interpreted.open_consumer_blocked',
          params: { blockCount },
        };
      },
    },
  },

  // ══════════ DEFENDER / INTUNE ══════════
  // All 5 Defender settings (Tamper Protection, Network Protection, Controlled
  // Folder Access, SmartScreen, LAPS) removed Apr 26, 2026. Managed by the
  // existing Intune Templates module — see Phase B v1 architectural decision:
  // settings fully covered by other Panoptica modules are excluded from the
  // Security Settings Engine to avoid duplicate management surface.

  // ══════════ COMPLIANCE ══════════
  {
    setting_id: 'CMP-01',
    name: 'Enable Unified Audit Log',
    category: 'compliance',
    priority: 'critical',
    poll_strategy: 'powershell_exo',
    poll_key: 'Get-AdminAuditLogConfig | Select UnifiedAuditLogIngestionEnabled',
    description: 'Ensures that the Microsoft 365 Unified Audit Log is enabled, capturing activity across Exchange, SharePoint, Teams, Entra ID, and Power Platform into a single, searchable log.',
    security_impact: 'Without the Unified Audit Log, most security incidents cannot be investigated at all — there is no record of what the attacker did. Enabling the audit log is a prerequisite for every subsequent incident-response workflow, and many compliance frameworks require it outright.',
    user_impact: 'Users will not notice any change. Auditing is silent and has no performance impact.',
    admin_notes: 'Should already be enabled on new tenants by default, but older tenants sometimes have it off. Verify the log is retained long enough for the client\'s needs — 90 days is standard, Business Premium and above can extend further. Note that even after enabling the flag, Microsoft can take up to an hour to begin ingesting events into the log.',
    licence_required: null,
    writer: {
      strategy: 'powershell_exo',
      ui: 'toggle',
      recommended_label: 'Enable the Unified Audit Log on every tenant — without it, no security incident can be investigated. Microsoft typically enables this by default on new tenants, but older tenants sometimes need an explicit Apply.',
      options: [
        { value: true,  label: 'Enabled (recommended)', recommended: true },
        { value: false, label: 'Disabled — no forensic capability', danger: true },
      ],
      // The cmdlet is idempotent — re-running with the current value is a
      // no-op. The flag flips immediately; ingestion catch-up may take up to
      // an hour but does not affect the verification poll (which checks the
      // flag, not the ingestion state).
      buildPwshCmdlet: (chosen) =>
        `Set-AdminAuditLogConfig -UnifiedAuditLogIngestionEnabled $${!!chosen}`,
      matches: (chosen, current) =>
        current && typeof current === 'object' &&
        !!current.unified_audit_log_enabled === !!chosen,
      // Apr 30, 2026 — i18n Phase 6.
      interpret: (current) => {
        if (!current || typeof current !== 'object') return null;
        return current.unified_audit_log_enabled
          ? { template_key: 'security_settings.CMP-01.interpreted.enabled', params: {} }
          : { template_key: 'security_settings.CMP-01.interpreted.disabled', params: {} };
      },
    },
  },
  {
    setting_id: 'CMP-02',
    name: 'Monitor DLP Policy Configuration',
    category: 'compliance',
    priority: 'high',
    poll_strategy: 'powershell_exo',
    poll_key: 'Get-DlpCompliancePolicy + Get-DlpComplianceRule (Security & Compliance)',
    description: 'Monitors the tenant\'s Microsoft Purview Data Loss Prevention configuration for unauthorized changes. Captures a baseline snapshot of all DLP policies (their rules, modes, and detected sensitive types) and alerts on any subsequent modification — policy added or removed, mode changed (Test/Enable/Disable), rule added or removed within a policy, or sensitive type added or removed within a rule.',
    security_impact: 'DLP weakening is a stealthy attack pattern: a compromised admin account or insider threat can disable a policy or remove a sensitive-type detector to exfiltrate data without tripping standard alerts. Drift detection on DLP catches these changes within minutes of the slow-tier poll.',
    user_impact: 'No user-facing impact — this setting is read-only in Panoptica. Users continue to see DLP block/notify messages exactly as the operator configured them via the Purview portal.',
    admin_notes: 'AUDIT-ONLY setting. Panoptica does NOT create or modify DLP policies. Microsoft\'s DLP write cmdlets (New-DlpCompliancePolicy etc.) require Microsoft 365 E5 Compliance licensing when invoked via service-principal IPPS, which is above the Business Premium SMB target tier — verified Apr 27 on Trilogiam where New-DlpCompliancePolicy returned InvalidLicenseException despite the tenant having working DLP policies in Purview UI. Manage DLP policies via the Microsoft Purview portal (compliance.microsoft.com → Data Loss Prevention). Use Match in Panoptica to capture your current DLP configuration as a baseline; Panoptica then alerts on any drift. If the tenant has zero DLP policies, the setting shows grey (not_applied) with a note — Match still captures the empty state, so creating the first policy later will fire drift and surface as "new policy added".',
    licence_required: 'Business Premium (read-side DLP cmdlets)',
    // Apr 27, 2026 — REWRITTEN as audit-only.
    // First Apply attempt on Trilogiam returned Microsoft's InvalidLicenseException
    // from New-DlpCompliancePolicy (write cmdlets gated above Business Premium tier
    // when called via service-principal IPPS). Architectural mismatch also discovered:
    // the original "manage Panoptica-named policy" design ignored the operator's
    // PRE-EXISTING DLP policies entirely (drift on changes to those policies never
    // fired). Pivoted to audit-only: snapshot ALL DLP policies + rules + sensitive
    // types; drift on any change. Match captures baseline; no Apply, no Remediate.
    // Reusable pattern — `audit_only: true` flag tells api-security.js / UI to
    // suppress Apply/Remediate paths.
    writer: {
      strategy: 'audit_only',  // sentinel — dispatcher rejects Apply/Remediate
      audit_only: true,
      ui: 'audit_only',
      // No options[], no buildPwshCmdlet, no buildPayload, no buildGraphCall.
      // Match flows directly through captureBaseline + matches() below.
      warning_banner: 'This setting is READ-ONLY in Panoptica. DLP policies must be created and modified via the Microsoft Purview portal (compliance.microsoft.com → Data Loss Prevention). Panoptica monitors your existing DLP configuration and alerts you to any change.',
      empty_state_note: 'No DLP policies are configured on this tenant. Click Match to capture this empty state as a baseline — Panoptica will alert you when any DLP policy is created. To create policies, use the Microsoft Purview portal.',
      // ──────────────────────────────────────────────────────────────────
      // Snapshot capture — Match stores this as applied_value.
      // Builds a normalized, sort-stable representation of the entire DLP
      // surface so subsequent matches() comparisons are deterministic.
      // Empty state ({policies: []}) is valid — captures "no DLP" as
      // baseline, future policy creation fires drift.
      // ──────────────────────────────────────────────────────────────────
      captureBaseline: (_chosenIgnored, current) => {
        // Apr 27, 2026 — shares _normalizeDlpSnapshot with matches() +
        // computeDiff() so all three derive the same shape from the reader's
        // policy_details. If the normalizer ever changes, all three update
        // together instead of silently diverging.
        const normalized = _normalizeDlpSnapshot(current);
        return {
          schema: 'dlp_audit_v1',
          captured_at: new Date().toISOString(),
          policies: normalized.policies,
        };
      },
      // ──────────────────────────────────────────────────────────────────
      // Drift detection — structural comparison via _computeDlpDiff.
      // Apr 27, 2026 (revised) — funnels through the SAME logic as
      // computeDiff() so the two functions can NEVER disagree. Previous
      // implementation used JSON.stringify equality, which is key-order-
      // sensitive: stored baseline (old key order) vs freshly normalized
      // current (new key order) → different strings → drift fired forever
      // on identical content. Caught by empty_diff_warning diagnostic.
      // Now: matches() returns true iff the diff has no added, removed,
      // or modified policies. Single source of truth for "is this drift?"
      // ──────────────────────────────────────────────────────────────────
      matches: (applied, current) => {
        const diff = _computeDlpDiff(applied, current);
        if (!diff) return false;  // schema mismatch → fire drift, force re-Match
        return diff.added_policies.length === 0
            && diff.removed_policies.length === 0
            && diff.modified_policies.length === 0;
      },
      // ──────────────────────────────────────────────────────────────────
      // Apr 27, 2026 — structured diff of baseline vs current.
      // Called from poll.js's fireDriftAlert when matches() returns false,
      // so the alert's raw_data shows EXACTLY what changed. Operator can
      // see at a glance: added policies, removed policies, mode flips,
      // rule add/remove per policy, sensitive-type adds/removes per rule,
      // workload changes per policy.
      // Returns null if applied is missing/legacy schema (operator just
      // needs to re-Match in that case).
      // ──────────────────────────────────────────────────────────────────
      computeDiff: (applied, current) => {
        if (!applied || typeof applied !== 'object' || applied.schema !== 'dlp_audit_v1') {
          return { schema_mismatch: true, baseline_schema: applied?.schema || null };
        }
        const diff = _computeDlpDiff(applied, current);
        const currentSnap = _normalizeDlpSnapshot(current).policies;
        return {
          baseline_policy_count: (applied.policies || []).length,
          current_policy_count: currentSnap.length,
          added_policies: diff.added_policies,
          removed_policies: diff.removed_policies,
          modified_policies: diff.modified_policies,
          // empty_diff_warning was the diagnostic that caught the JSON.stringify
          // key-order bug. Now that matches() and computeDiff share the same
          // diff logic, this can never fire — but kept as defensive instrumentation
          // in case a future refactor reintroduces a divergence.
          empty_diff_warning: null,
        };
      },
      // Apr 30, 2026 — i18n Phase 6. PROSE: composes DLP state with optional
      // workload list. Workloads come back as an array of strings (e.g.
      // ['Exchange', 'SharePoint', 'OneDrive']) which we serialize as a
      // comma-separated string param — joining is locale-independent so we
      // can do it server-side.
      interpret: (current) => {
        if (!current || typeof current !== 'object') return null;
        const policies = Array.isArray(current.policies) ? current.policies : [];
        const total = policies.length;
        const enforcing = policies.filter(p => p && (p.mode === 'Enable' || p.mode === 'enabled')).length;
        const auditing = policies.filter(p => p && (p.mode === 'TestWithNotifications' || p.mode === 'TestWithoutNotifications' || p.mode === 'Test')).length;
        const workloadSet = new Set();
        for (const p of policies) {
          if (Array.isArray(p?.workloads)) for (const w of p.workloads) if (w) workloadSet.add(w);
        }
        const workloads = [...workloadSet].join(', ');
        if (total === 0) {
          return { template_key: 'security_settings.CMP-02.interpreted.none', params: {} };
        }
        if (enforcing > 0 && auditing > 0) {
          return {
            template_key: 'security_settings.CMP-02.interpreted.enforcing_and_audit',
            params: { count: total, total, enforcing, auditing, workloads },
          };
        }
        if (enforcing > 0) {
          return {
            template_key: 'security_settings.CMP-02.interpreted.enforcing_only',
            params: { count: enforcing, enforcing, workloads },
          };
        }
        if (auditing > 0) {
          return {
            template_key: 'security_settings.CMP-02.interpreted.audit_only',
            params: { count: auditing, auditing },
          };
        }
        return {
          template_key: 'security_settings.CMP-02.interpreted.none_active',
          params: { count: total, total },
        };
      },
    },
  },
  // CMP-03 (Entra ID Sign-In Risk Policy) removed Apr 26, 2026.
  // Managed by the existing CA Policies module — same architectural decision
  // as ENT-08 above.
];

// Compile-time sanity check — runs once on require(), throws if the registry
// violates its own constraints (duplicate IDs, missing text, bad enums).
(function validate() {
  const ids = new Set();
  const validCategories = new Set(['exchange', 'identity', 'sharepoint', 'teams', 'defender', 'compliance']);
  const validPriorities = new Set(['critical', 'high', 'medium', 'low']);
  // Apr 26 v4 — powershell_ipps added for CMP-02 DLP writer (S&C cmdlets via
  // Connect-IPPSSession). Note: poll_strategy stays 'powershell_exo' for the
  // CMP-02 reader (pwsh-readers internally routes by setting_id to the right
  // runIppsCmdlet call), but writer.strategy = 'powershell_ipps' so the
  // pwsh-writers dispatcher picks runIppsSetCmdlet.
  // Apr 27 — `audit_only` strategy added for CMP-02 (DLP). Audit-only writers
  // have captureBaseline + matches but no buildPayload/buildPwshCmdlet/buildGraphCall.
  // Apply/Remediate are rejected at the api-security.js dispatcher; only Match
  // and Accept Drift are valid actions.
  // Apr 28 — `delegated_teams` strategy added for TEA-01/TEA-02. Microsoft
  // Teams admin Set-Cs* cmdlets don't honor cert-based app-only SP auth on
  // customer tenants via GDAP — verified May 2 2026. These writers run via
  // the operator's delegated session (browser sign-in flow) instead. Reads
  // (poll_strategy=powershell_teams) still use cert-based SP auth.
  const validStrategies = new Set(['graph', 'powershell_exo', 'powershell_ipps', 'powershell_spo', 'powershell_teams', 'audit_only', 'delegated_teams']);
  const validWriterUi = new Set(['select_one', 'toggle', 'multi_toggle', 'audit_only']);
  const validWriterMethods = new Set(['PATCH', 'POST', 'PUT']);
  for (const s of SETTINGS) {
    if (!/^[A-Z]{3}-\d{2}$/.test(s.setting_id)) {
      throw new Error(`security-settings/registry: bad setting_id format '${s.setting_id}'`);
    }
    if (ids.has(s.setting_id)) {
      throw new Error(`security-settings/registry: duplicate setting_id '${s.setting_id}'`);
    }
    ids.add(s.setting_id);
    if (!validCategories.has(s.category)) throw new Error(`bad category for ${s.setting_id}`);
    if (!validPriorities.has(s.priority)) throw new Error(`bad priority for ${s.setting_id}`);
    if (!validStrategies.has(s.poll_strategy)) throw new Error(`bad poll_strategy for ${s.setting_id}`);
    for (const f of ['name', 'poll_key', 'description', 'security_impact', 'user_impact', 'admin_notes']) {
      if (!s[f] || typeof s[f] !== 'string' || s[f].length < 10) {
        throw new Error(`security-settings/registry: ${s.setting_id} missing or short field '${f}'`);
      }
    }
    // Phase B writer block — optional; if present, validate strictly so that
    // a malformed entry is caught at boot, not at first Apply click.
    if (s.writer) {
      const w = s.writer;
      if (!validStrategies.has(w.strategy)) throw new Error(`bad writer.strategy for ${s.setting_id}`);
      // Strategy-specific required fields:
      //   graph         → graph_path + buildPayload (returns Graph PATCH body object)
      //   powershell_*  → buildPwshCmdlet (returns Set-* cmdlet expression string)
      if (w.strategy === 'graph') {
        // Three valid shapes (in order of generality):
        //   - prepareGraphCalls (plural) — multi-PATCH writers (ENT-01)
        //   - prepareGraphCall (singular) — POST/PATCH branching (ENT-06)
        //   - standard buildPayload + graph_path + graph_method — single PATCH
        const hasStandard = typeof w.buildPayload === 'function' && typeof w.graph_path === 'string';
        const hasOverride = typeof w.prepareGraphCall === 'function';
        const hasMulti    = typeof w.prepareGraphCalls === 'function';
        if (!hasStandard && !hasOverride && !hasMulti) {
          throw new Error(`graph writer ${s.setting_id} needs (buildPayload + graph_path) OR prepareGraphCall OR prepareGraphCalls`);
        }
        if (hasStandard) {
          if (!w.graph_path.startsWith('/')) {
            throw new Error(`bad writer.graph_path for ${s.setting_id}`);
          }
          if (w.graph_method && !validWriterMethods.has(w.graph_method)) {
            throw new Error(`bad writer.graph_method for ${s.setting_id}`);
          }
        }
      } else if (w.strategy.startsWith('powershell_')) {
        if (typeof w.buildPwshCmdlet !== 'function') {
          throw new Error(`writer.buildPwshCmdlet must be a function for pwsh writer ${s.setting_id}`);
        }
      } else if (w.strategy === 'delegated_teams') {
        // Same shape as powershell_* — needs buildPwshCmdlet. Difference is
        // runtime: dispatcher uses delegated tokens via operator session
        // instead of cert-based SP auth.
        if (typeof w.buildPwshCmdlet !== 'function') {
          throw new Error(`writer.buildPwshCmdlet must be a function for delegated_teams writer ${s.setting_id}`);
        }
      } else if (w.strategy === 'audit_only') {
        // Audit-only writers: monitor existing config, no Apply/Remediate path.
        // Required: audit_only=true flag, captureBaseline, matches, warning_banner.
        if (w.audit_only !== true) {
          throw new Error(`writer.strategy=audit_only requires writer.audit_only=true flag for ${s.setting_id}`);
        }
        if (typeof w.captureBaseline !== 'function') {
          throw new Error(`audit_only writer ${s.setting_id} requires captureBaseline()`);
        }
        if (!w.warning_banner || typeof w.warning_banner !== 'string' || w.warning_banner.length < 20) {
          throw new Error(`audit_only writer ${s.setting_id} requires warning_banner string (>=20 chars)`);
        }
      }
      if (!validWriterUi.has(w.ui)) throw new Error(`bad writer.ui for ${s.setting_id}`);
      if (w.ui === 'select_one' && (!Array.isArray(w.options) || w.options.length < 2)) {
        throw new Error(`writer.ui=select_one requires options[] for ${s.setting_id}`);
      }
      if (w.ui === 'toggle' && (!Array.isArray(w.options) || w.options.length !== 2)) {
        throw new Error(`writer.ui=toggle requires exactly 2 options for ${s.setting_id}`);
      }
      // audit_only UI carries no options[] — only captureBaseline + matches.
      if (typeof w.matches !== 'function') throw new Error(`writer.matches must be a function for ${s.setting_id}`);
      // Apr 26 v3 — options may carry an `input` block describing a text-area
      // that renders below the option list when that option is selected.
      // Used by settings whose chosen value carries operator-typed data
      // (TEA-02 partner-domain allowlist, EXO-05 notify recipient,
      // ENT-06 custom banned words). Validate the shape strictly.
      const validInputKinds = new Set(['email', 'domain', 'word']);
      if (Array.isArray(w.options)) {
        for (const opt of w.options) {
          if (!opt.input) continue;
          if (typeof opt.input !== 'object') {
            throw new Error(`option.input must be an object for ${s.setting_id}`);
          }
          if (typeof opt.input.multiline !== 'boolean') {
            throw new Error(`option.input.multiline must be boolean for ${s.setting_id}`);
          }
          if (opt.input.line_kind && !validInputKinds.has(opt.input.line_kind)) {
            throw new Error(`option.input.line_kind must be one of ${[...validInputKinds].join('/')} for ${s.setting_id}`);
          }
          // May 3, 2026 — optional per-input length bounds. Used to surface
          // Microsoft-side constraints (e.g. ENT-06 banned words must be
          // 4-16 chars) in the client-side validator BEFORE Apply hits the
          // Graph API. Both fields optional; either or both may be set.
          if (opt.input.min_length !== undefined &&
              (typeof opt.input.min_length !== 'number' || opt.input.min_length < 1)) {
            throw new Error(`option.input.min_length must be a positive number for ${s.setting_id}`);
          }
          if (opt.input.max_length !== undefined &&
              (typeof opt.input.max_length !== 'number' || opt.input.max_length < 1)) {
            throw new Error(`option.input.max_length must be a positive number for ${s.setting_id}`);
          }
          if (opt.input.min_length !== undefined && opt.input.max_length !== undefined &&
              opt.input.min_length > opt.input.max_length) {
            throw new Error(`option.input.min_length must be <= max_length for ${s.setting_id}`);
          }
        }
        // If any option has input, writer must provide extractInputFromCurrent
        if (w.options.some(o => o.input) && typeof w.extractInputFromCurrent !== 'function') {
          throw new Error(`writer must provide extractInputFromCurrent when any option has input — ${s.setting_id}`);
        }
      }
      // Apr 26 v4 — secondary_section: an expandable checklist below the
      // primary options. Used by settings whose choice spans both a coarse
      // option AND a fine-grained set of optional add-ons (ENT-01 SSPR
      // baseline + advanced auth methods). Validate the shape strictly.
      if (w.secondary_section) {
        const ss = w.secondary_section;
        if (typeof ss.toggle_label !== 'string' || ss.toggle_label.length < 3) {
          throw new Error(`secondary_section.toggle_label required for ${s.setting_id}`);
        }
        if (!Array.isArray(ss.options) || ss.options.length === 0) {
          throw new Error(`secondary_section.options[] required for ${s.setting_id}`);
        }
        for (const opt of ss.options) {
          if (typeof opt.id !== 'string' || typeof opt.label !== 'string') {
            throw new Error(`secondary_section.options[] entries need {id, label} for ${s.setting_id}`);
          }
        }
        if (typeof ss.extractCurrentAdditionals !== 'function') {
          throw new Error(`secondary_section.extractCurrentAdditionals function required for ${s.setting_id}`);
        }
      }
    }
  }
  // Apr 26, 2026: registry trimmed from 25 → 18 (7 settings excluded as
  // managed by other Panoptica modules — 2 by CA Policies module,
  // 5 by Intune Templates module). Then trimmed 18 → 17 same day:
  // EXO-07 (Safe Atts + Safe Links) removed because Microsoft's Set-*
  // surface for it is broken on Business Premium tenants. See
  // /dev/Panoptica/Security_Settings_Backlog.md for re-evaluation tracking.
  // May 4, 2026 — count dropped 17 → 16 with SPO-02 removal (legacy domain-
  // GUID enforcement blocked legitimate cloud-only Entra-joined devices on
  // SMB tenants). Replacement is a CA Templates entry, not a Security Setting.
  // May 5, 2026 — count back up to 17 with EXO-09 addition (Strict Mailbox
  // Audit Posture — Bypass + Action List). Companion to EXO-03; required
  // prerequisite for the MailItemsAccessed and HardDelete UAL detections.
  // Jun 11, 2026 — count 17 → 21 with ENT-10..13 (Entra authorization-policy
  // toggles from a Purple Knight assessment: app-registration / security-group
  // / tenant creation restrictions + guest-invite scope). All read+PATCH the
  // existing /policies/authorizationPolicy endpoint; no new consent.
  if (SETTINGS.length !== 21) {
    throw new Error(`security-settings/registry: expected 21 settings, got ${SETTINGS.length}`);
  }
})();

function byId(id) {
  return SETTINGS.find(s => s.setting_id === id) || null;
}

function byCategory(cat) {
  return SETTINGS.filter(s => s.category === cat);
}

function graphReadable() {
  return SETTINGS.filter(s => s.poll_strategy === 'graph');
}

/**
 * Phase B helpers — settings that have a writer block.
 * `writable()` returns the full registry rows; `hasWriter(id)` is a fast
 * lookup used by the API guard layer.
 */
function writable() {
  return SETTINGS.filter(s => s.writer);
}

function hasWriter(id) {
  const s = byId(id);
  return !!(s && s.writer);
}

module.exports = {
  SETTINGS,
  byId,
  byCategory,
  graphReadable,
  writable,
  hasWriter,
};
