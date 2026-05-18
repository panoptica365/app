/**
 * Panoptica365 — PowerShell Readers for Security Settings (Phase A2.2)
 *
 * Mirrors graph-readers.js for settings whose poll_strategy is one of
 * powershell_exo / powershell_spo / powershell_teams. Each reader returns:
 *   { ok: true,  current_value: <JSON-able>, interpreted: '<short string>' }
 *   { ok: false, error: '<message>' }
 *   { ok: false, unavailable: true, error: '<why>' }   — for misconfig / licence
 *
 * Phase A2.2 ships 6 ExchangeOnline readers (EXO-02 from A2.1, plus
 * EXO-01, EXO-03, EXO-05, EXO-08, CMP-01). The 3 IPPSSession-based
 * readers (EXO-06, EXO-07, CMP-02) await the runIppsCmdlet() extension
 * in Phase A2.3. SPO and Teams readers wait for A2.4 / A2.5.
 *
 * Interpretation-string convention (per field-reality lesson — Apr 25):
 *   Lead with the alarming verb when the actual value matches the risky
 *   default. SMB tenants in the wild are mostly at vendor defaults — the
 *   reader's job is to make findings ACTIONABLE, not falsely reassuring.
 *
 * Convention reminders (lessons from Phase A1 + A1b + A2.1):
 *   - tenantAzureId is the Azure GUID (tenants.tenant_id), not the INT id.
 *   - Connect-ExchangeOnline -Organization needs the verified domain
 *     (preferably *.onmicrosoft.com), NOT the GUID. pwsh-runner handles
 *     this via resolveTenantDomain().
 *   - All cmdlet expressions end in `| ConvertTo-Json -Compress` (or
 *     -Depth N for nested objects). The runner expects exactly one JSON
 *     line on stdout.
 */

'use strict';

const { runExoCmdlet, runIppsCmdlet, runTeamsCmdlet, PwshError, getConfigStatus } = require('./pwsh-runner');

// ──────────────────────────────────────────────────────────────
// Shared error mapper — translates PwshError codes into reader return
// shapes. Keeps the 6 readers below from each reimplementing the same
// six lines of try/catch dispatch.
// ──────────────────────────────────────────────────────────────
function handlePwshError(e, settingHint, opts = {}) {
  const role = opts.role || 'Exchange Administrator';
  if (e instanceof PwshError) {
    if (e.code === 'PWSH_NOT_CONFIGURED') {
      // Misconfig (no cert, no app reg) — system-level, surface as
      // "unavailable" not "poll_error" so the LED stays grey-lock.
      return { ok: false, unavailable: true, error: e.message };
    }
    if (e.code === 'PWSH_TENANT_PERMS' || e.code === 'PWSH_AUTH') {
      // Tenant-side auth failure — most common cause is "the required
      // directory role hasn't been granted to the Panoptica service
      // principal in this tenant yet" (step 4 of the PS infra runbook).
      // Surface the role hint inline so the operator doesn't have to
      // dig through logs to figure out the next action. EXO and IPPS
      // both want Exchange Administrator; Compliance Center features
      // may additionally want Compliance Administrator depending on
      // cmdlet.
      return {
        ok: false,
        error: `Auth/permission failed for ${settingHint} — has the ${role} role been granted to the Panoptica service principal in this tenant? (${e.message})`,
      };
    }
    if (e.code === 'PWSH_TIMEOUT') {
      return { ok: false, error: `${settingHint} timed out — bump PWSH_TIMEOUT_MS or investigate cmdlet performance (${e.message})` };
    }
    return { ok: false, error: `${settingHint} ${e.code}: ${e.message}` };
  }
  return { ok: false, error: `Unexpected reader error in ${settingHint}: ${e.message}` };
}


// ══════════════════════════════════════════════════════════════════
// EXO-01 — Enable MailTips (All Tips + External Recipients)
// ══════════════════════════════════════════════════════════════════
//
// Cmdlet: Get-OrganizationConfig | Select MailTips*
//
// Recommended state:
//   MailTipsAllTipsEnabled              = $true (default $true)
//   MailTipsExternalRecipientsTipsEnabled = $true (default $false — the key flag)
//   MailTipsGroupMetricsEnabled         = $true (default $true)
//   MailTipsLargeAudienceThreshold      = 25 (default 25 — usually fine)
//
// Field reality (Jacques, Apr 25): the external-recipients flag is
// almost universally LEFT OFF in SMB tenants. This reader leans into
// flagging that explicitly when external_recipients = false.
async function readMailTips(tenantAzureId) {
  try {
    const expression = `
Get-OrganizationConfig | Select-Object MailTipsAllTipsEnabled, MailTipsExternalRecipientsTipsEnabled, MailTipsGroupMetricsEnabled, MailTipsLargeAudienceThreshold | ConvertTo-Json -Compress
`;
    const result = await runExoCmdlet(tenantAzureId, expression);
    const allTips = result?.MailTipsAllTipsEnabled === true;
    const extRecip = result?.MailTipsExternalRecipientsTipsEnabled === true;
    const grpMetrics = result?.MailTipsGroupMetricsEnabled === true;
    const threshold = result?.MailTipsLargeAudienceThreshold ?? null;

    let interpreted;
    if (extRecip && allTips && grpMetrics) {
      interpreted = `Fully enabled (recommended, threshold=${threshold})`;
    } else if (extRecip) {
      interpreted = `External warnings ON, other tips partial`;
    } else if (allTips) {
      interpreted = `External recipient warnings DISABLED — risk (most common SMB default)`;
    } else {
      interpreted = `MailTips fully OFF — no sender-side warnings`;
    }

    return {
      ok: true,
      current_value: {
        all_tips: allTips,
        external_recipients: extRecip,
        group_metrics: grpMetrics,
        large_audience_threshold: threshold,
      },
      interpreted,
    };
  } catch (e) {
    return handlePwshError(e, 'EXO-01');
  }
}


// ══════════════════════════════════════════════════════════════════
// EXO-02 — Disable Automatic Forwarding to External Domains
// ══════════════════════════════════════════════════════════════════
//
// Field reality (Jacques, Apr 25): EXO-02 is wide-open by default in
// virtually every SMB tenant Jacques has examined over 5 years. The
// "ENABLED — risk" branch is the expected reading for newly-onboarded
// customer tenants; treat it as a strong commercial demo finding.
async function readAutoForwardingDefault(tenantAzureId) {
  try {
    const expression = `
$default = Get-RemoteDomain Default | Select-Object Name, AutoForwardEnabled
$allCount = (Get-RemoteDomain | Measure-Object).Count
@{
  default = $default
  total_remote_domains = $allCount
} | ConvertTo-Json -Depth 4 -Compress
`;
    const result = await runExoCmdlet(tenantAzureId, expression);
    const def = result?.default || {};
    const autoFwd = def?.AutoForwardEnabled === true;
    const totalDomains = result?.total_remote_domains || 1;
    const nonDefaultCount = Math.max(0, totalDomains - 1);

    let interpreted;
    if (!autoFwd) {
      interpreted = nonDefaultCount > 0
        ? `Disabled on Default (${nonDefaultCount} other remote domain${nonDefaultCount === 1 ? '' : 's'} — review manually)`
        : 'Disabled on Default (recommended)';
    } else {
      interpreted = nonDefaultCount > 0
        ? `ENABLED on Default — risk (${nonDefaultCount} other remote domain${nonDefaultCount === 1 ? '' : 's'})`
        : 'ENABLED on Default — risk (BEC exfiltration vector)';
    }

    return {
      ok: true,
      current_value: {
        default_auto_forward_enabled: autoFwd,
        total_remote_domains: totalDomains,
        non_default_count: nonDefaultCount,
      },
      interpreted,
    };
  } catch (e) {
    return handlePwshError(e, 'EXO-02');
  }
}


// ══════════════════════════════════════════════════════════════════
// EXO-03 — Enable Mailbox Auditing for All Users
// ══════════════════════════════════════════════════════════════════
//
// Cmdlet: Get-Mailbox -ResultSize Unlimited (filtered to UserMailbox)
//   group by AuditEnabled, count true vs false.
//
// Microsoft turned on default mailbox auditing in 2019, but per-mailbox
// AuditEnabled flags can be flipped off by admins or by certain
// migrations. We count what's enabled vs what isn't so the operator
// knows whether ALL users are covered.
//
// Performance: Get-Mailbox -ResultSize Unlimited can take 30+ seconds on
// tenants with thousands of mailboxes. Bumping the timeout to 60s for
// this reader specifically; SMB tenants normally finish in <10s.
async function readMailboxAuditing(tenantAzureId) {
  try {
    const expression = `
$mboxes = Get-Mailbox -ResultSize Unlimited -Filter 'RecipientTypeDetails -eq "UserMailbox"' | Select-Object AuditEnabled
$total = ($mboxes | Measure-Object).Count
$enabled = ($mboxes | Where-Object { $_.AuditEnabled } | Measure-Object).Count
@{
  total = $total
  enabled = $enabled
  disabled = ($total - $enabled)
} | ConvertTo-Json -Compress
`;
    const result = await runExoCmdlet(tenantAzureId, expression, { timeoutMs: 60000 });
    const total = result?.total ?? 0;
    const enabled = result?.enabled ?? 0;
    const disabled = result?.disabled ?? 0;

    let interpreted;
    if (total === 0) {
      interpreted = 'No user mailboxes found (unusual)';
    } else if (disabled === 0) {
      interpreted = `Auditing enabled on all ${total} user mailbox${total === 1 ? '' : 'es'} (recommended)`;
    } else {
      interpreted = `Auditing DISABLED on ${disabled} of ${total} mailboxes — gap`;
    }

    return {
      ok: true,
      current_value: {
        total_user_mailboxes: total,
        audit_enabled_count: enabled,
        audit_disabled_count: disabled,
      },
      interpreted,
    };
  } catch (e) {
    return handlePwshError(e, 'EXO-03');
  }
}


// ══════════════════════════════════════════════════════════════════
// EXO-05 — Configure Anti-Spam Outbound Policy
// ══════════════════════════════════════════════════════════════════
//
// Cmdlet: Get-HostedOutboundSpamFilterPolicy
//
// Recommended state (Default policy):
//   ActionWhenThresholdReached      = 'BlockUser'  (default 'Alert')
//   NotifyOutboundSpam              = $true        (default $false)
//   NotifyOutboundSpamRecipients    = MSP-monitored address (default empty)
//
// The "Alert" default does NOT block compromised accounts — they keep
// spamming until manual intervention. "BlockUser" stops the user from
// sending any further outbound mail until released.
async function readOutboundSpamPolicy(tenantAzureId) {
  try {
    const expression = `
Get-HostedOutboundSpamFilterPolicy | Where-Object { $_.Name -eq 'Default' } |
  Select-Object Name, ActionWhenThresholdReached, NotifyOutboundSpam,
                @{Name='NotifyRecipients'; Expression={ @($_.NotifyOutboundSpamRecipients | ForEach-Object { ($_ -as [string]).ToLowerInvariant() } | Sort-Object) }} |
  ConvertTo-Json -Depth 4 -Compress
`;
    const result = await runExoCmdlet(tenantAzureId, expression);
    const action = result?.ActionWhenThresholdReached || 'unknown';
    const notify = result?.NotifyOutboundSpam === true;
    // Defensive: ConvertTo-Json may unwrap single-element arrays
    const rawList = result?.NotifyRecipients;
    const recipients = Array.isArray(rawList) ? rawList : (rawList ? [String(rawList)] : []);
    const recipientCount = recipients.length;

    let interpreted;
    const restrictive = action === 'BlockUser' || action === 'BlockUserForToday';
    const blockNote = action === 'BlockUserForToday' ? ' (auto-released after 24h)' : '';
    if (restrictive && notify && recipientCount > 0) {
      interpreted = `Restricts compromised accounts + alerts${blockNote} (recommended)`;
    } else if (restrictive && !notify) {
      interpreted = `${action} set but NO alerting — operator won't know when triggered`;
    } else if (action === 'Alert' || action === 'AlertOnly') {
      interpreted = `Alert-only — does NOT block compromised accounts (default — risk)`;
    } else {
      interpreted = `Custom action="${action}" — review`;
    }

    return {
      ok: true,
      current_value: {
        action_when_threshold: action,
        notify_outbound_spam: notify,
        notify_recipient_count: recipientCount,
        notify_recipients: recipients,  // the actual email list, sorted + lowercased
      },
      interpreted,
    };
  } catch (e) {
    return handlePwshError(e, 'EXO-05');
  }
}


// ══════════════════════════════════════════════════════════════════
// EXO-08 — Disable Basic Auth for SMTP AUTH Submission
// ══════════════════════════════════════════════════════════════════
//
// Cmdlet: Get-TransportConfig | Select SmtpClientAuthenticationDisabled
//
// $true  → SMTP AUTH disabled tenant-wide (recommended)
// $false → SMTP AUTH enabled tenant-wide (risk — basic auth bypass for
//          credential stuffing)
// $null  → Microsoft default applies (currently disabled since Oct 2022,
//          but explicit is better than implicit)
async function readSmtpAuth(tenantAzureId) {
  try {
    const expression = `
Get-TransportConfig | Select-Object SmtpClientAuthenticationDisabled | ConvertTo-Json -Compress
`;
    const result = await runExoCmdlet(tenantAzureId, expression);
    const flag = result?.SmtpClientAuthenticationDisabled;

    let interpreted;
    let normalized;
    if (flag === true) {
      interpreted = 'SMTP AUTH disabled tenant-wide (recommended)';
      normalized = 'disabled';
    } else if (flag === false) {
      interpreted = 'SMTP AUTH ENABLED tenant-wide — risk (basic-auth credential-stuffing exposure)';
      normalized = 'enabled';
    } else {
      // Null/empty means Microsoft default behaviour — currently disabled
      // but the operator should verify the implicit state.
      interpreted = 'Using Microsoft default — verify in EAC (current default = disabled)';
      normalized = 'default';
    }

    return {
      ok: true,
      current_value: {
        smtp_client_auth_disabled: flag,
        normalized,
      },
      interpreted,
    };
  } catch (e) {
    return handlePwshError(e, 'EXO-08');
  }
}


// ══════════════════════════════════════════════════════════════════
// CMP-01 — Enable Unified Audit Log
// ══════════════════════════════════════════════════════════════════
//
// Cmdlet: Get-AdminAuditLogConfig | Select UnifiedAuditLogIngestionEnabled
//
// Should be $true on every tenant. Microsoft turned this on by default
// for new tenants in 2023, but older tenants and some specific
// configurations can have it off — and "off" means no forensic
// capability whatsoever, which is a Critical-priority gap.
async function readUnifiedAuditLog(tenantAzureId) {
  try {
    const expression = `
Get-AdminAuditLogConfig | Select-Object UnifiedAuditLogIngestionEnabled | ConvertTo-Json -Compress
`;
    const result = await runExoCmdlet(tenantAzureId, expression);
    const enabled = result?.UnifiedAuditLogIngestionEnabled === true;

    return {
      ok: true,
      current_value: {
        unified_audit_log_enabled: enabled,
      },
      interpreted: enabled
        ? 'Unified Audit Log enabled (recommended)'
        : 'Unified Audit Log DISABLED — no forensic capability (Critical gap)',
    };
  } catch (e) {
    return handlePwshError(e, 'CMP-01');
  }
}


// ══════════════════════════════════════════════════════════════════
// EXO-06 — Enable Preset Security Policy (Standard or Strict) — MDO
// ══════════════════════════════════════════════════════════════════
//
// Cmdlets: Get-EOPProtectionPolicyRule (anti-spam, anti-phish, anti-malware
// preset rules) AND Get-ATPProtectionPolicyRule (Defender for Office 365
// preset rules — Safe Links/Safe Attachments).
//
// IMPORTANT: despite the "EOP" and "ATP" names, these cmdlets live in the
// ExchangeOnline module (Connect-ExchangeOnline), NOT Security & Compliance
// (Connect-IPPSSession). Microsoft documents them under
// /powershell/module/exchangepowershell/. Calling them via IPPS yields
// "term not recognized" because the IPPS session doesn't import them.
// Lesson learned the hard way Apr 25.
//
// The preset policies have TWO tiers: "Standard Preset Security Policy"
// and "Strict Preset Security Policy". A tenant can enable either, both,
// or neither. We report which ones are present AND enabled.
//
// Field reality (Apr 25, Jacques): most SMB tenants have NEITHER preset
// configured — they run on default policies which Microsoft acknowledges
// are looser than recommended.
async function readPresetSecurityPolicy(tenantAzureId) {
  try {
    // Apr 26, 2026 v2: also pull the impersonation lists from the underlying
    // anti-phish policies. Get-AntiPhishPolicy returns the full policy object
    // for the named preset; we only need the targeted user/domain lists for
    // drift detection. The policies always exist on Defender for O365 P1+
    // tenants — Microsoft creates them as built-in. Operator may or may not
    // have populated the lists via the portal.
    //
    // List values are normalised: trimmed, lowercased (case-insensitive
    // comparison for emails/domains), sorted. This makes canonical comparison
    // straightforward in writer.matches().
    const expression = `
$eop = @(Get-EOPProtectionPolicyRule -ErrorAction SilentlyContinue) | Select-Object Name, State, Priority
$atp = @(Get-ATPProtectionPolicyRule -ErrorAction SilentlyContinue) | Select-Object Name, State, Priority
$apStd = Get-AntiPhishPolicy -ErrorAction SilentlyContinue | Where-Object { $_.RecommendedPolicyType -eq 'Standard' } | Select-Object -First 1
$apStrict = Get-AntiPhishPolicy -ErrorAction SilentlyContinue | Where-Object { $_.RecommendedPolicyType -eq 'Strict' } | Select-Object -First 1
@{
  eop_rules = @($eop)
  atp_rules = @($atp)
  ap_standard = if ($apStd) {
    @{
      targeted_users    = @($apStd.TargetedUsersToProtect    | ForEach-Object { ($_ -as [string]).ToLowerInvariant() } | Sort-Object)
      targeted_domains  = @($apStd.TargetedDomainsToProtect  | ForEach-Object { ($_ -as [string]).ToLowerInvariant() } | Sort-Object)
      excluded_domains  = @($apStd.ExcludedDomains           | ForEach-Object { ($_ -as [string]).ToLowerInvariant() } | Sort-Object)
    }
  } else { $null }
  ap_strict = if ($apStrict) {
    @{
      targeted_users    = @($apStrict.TargetedUsersToProtect    | ForEach-Object { ($_ -as [string]).ToLowerInvariant() } | Sort-Object)
      targeted_domains  = @($apStrict.TargetedDomainsToProtect  | ForEach-Object { ($_ -as [string]).ToLowerInvariant() } | Sort-Object)
      excluded_domains  = @($apStrict.ExcludedDomains           | ForEach-Object { ($_ -as [string]).ToLowerInvariant() } | Sort-Object)
    }
  } else { $null }
} | ConvertTo-Json -Depth 5 -Compress
`;
    const result = await runExoCmdlet(tenantAzureId, expression);
    const eopRules = Array.isArray(result?.eop_rules) ? result.eop_rules : [];
    const atpRules = Array.isArray(result?.atp_rules) ? result.atp_rules : [];

    // Microsoft creates the preset rules with timestamped names like
    // "Standard Preset Security Policy1647725751267" (epoch ms suffix). For
    // POLICIES (Get-AntiPhishPolicy) the stable identifier is RecommendedPolicyType.
    // For RULES (Get-EOPProtectionPolicyRule), that field doesn't appear in the
    // output — Microsoft tags presets at the policy tier, not at the rule tier.
    // So we fall back to substring match on the rule Name (works for both bare
    // and timestamp-suffixed forms). State values: 'Enabled' | 'Disabled'.
    const isStandard = r => /^standard preset security policy/i.test(String(r?.Name || ''));
    const isStrict   = r => /^strict preset security policy/i.test(String(r?.Name || ''));
    const isEnabled  = r => String(r?.State || '').toLowerCase() === 'enabled';

    const eopStandard = eopRules.find(isStandard);
    const eopStrict   = eopRules.find(isStrict);
    const atpStandard = atpRules.find(isStandard);
    const atpStrict   = atpRules.find(isStrict);

    const strictEnabled = (eopStrict && isEnabled(eopStrict)) || (atpStrict && isEnabled(atpStrict));
    const standardEnabled = (eopStandard && isEnabled(eopStandard)) || (atpStandard && isEnabled(atpStandard));

    // Defensive: ConvertTo-Json may unwrap single-element arrays into bare
    // values. Normalise to arrays. Also coerce nulls to empty arrays so
    // downstream matches() doesn't have to defend against undefined.
    const toArr = v => {
      if (v == null) return [];
      if (Array.isArray(v)) return v.map(x => String(x));
      return [String(v)];
    };
    const apStd    = result?.ap_standard || null;
    const apStrict = result?.ap_strict   || null;

    let interpreted;
    if (strictEnabled && standardEnabled) {
      interpreted = 'Both Standard + Strict presets enabled';
    } else if (strictEnabled) {
      interpreted = 'Strict preset enabled (recommended for high-risk tenants)';
    } else if (standardEnabled) {
      interpreted = 'Standard preset enabled (recommended baseline)';
    } else if (eopRules.length || atpRules.length) {
      interpreted = 'Preset rules defined but DISABLED — running on default policies';
    } else {
      interpreted = 'No preset configured — running on default policies (loose)';
    }

    return {
      ok: true,
      current_value: {
        eop_standard_enabled: !!(eopStandard && isEnabled(eopStandard)),
        eop_strict_enabled:   !!(eopStrict && isEnabled(eopStrict)),
        atp_standard_enabled: !!(atpStandard && isEnabled(atpStandard)),
        atp_strict_enabled:   !!(atpStrict && isEnabled(atpStrict)),
        eop_rule_count: eopRules.length,
        atp_rule_count: atpRules.length,
        // Apr 26 v2: impersonation lists per tier (sorted, lowercased)
        standard_targeted_users:    toArr(apStd?.targeted_users),
        standard_targeted_domains:  toArr(apStd?.targeted_domains),
        standard_excluded_domains:  toArr(apStd?.excluded_domains),
        strict_targeted_users:      toArr(apStrict?.targeted_users),
        strict_targeted_domains:    toArr(apStrict?.targeted_domains),
        strict_excluded_domains:    toArr(apStrict?.excluded_domains),
      },
      interpreted,
    };
  } catch (e) {
    return handlePwshError(e, 'EXO-06');
  }
}


// EXO-07 (Enable Safe Attachments and Safe Links) reader removed Apr 26, 2026.
// See /dev/Panoptica/Security_Settings_Backlog.md for the full analysis.


// ══════════════════════════════════════════════════════════════════
// CMP-02 — Configure DLP Policy (Block External Sharing of Sensitive Data)
// ══════════════════════════════════════════════════════════════════
//
// Cmdlet: Get-DlpCompliancePolicy — list of all DLP policies.
//
// Properties of interest:
//   Name      — policy name
//   Mode      — TestWithoutNotifications | TestWithNotifications | Enable | PendingDeletion
//   Enabled   — bool
//   Workload  — Exchange | SharePoint | OneDriveForBusiness | Teams | EndpointDevices ...
//
// Reports counts: total policies, how many are in each Mode, what
// workloads are covered. The "Enable" mode is the only one that actually
// blocks; the Test modes audit-only.
//
// Field reality: most SMB tenants have ZERO DLP policies (CMP-02 is a
// Critical-priority gap on first onboard).
async function readDlpPolicies(tenantAzureId) {
  try {
    // Apr 26 v4 — fetch BOTH policies and rules in one IPPS round-trip.
    // The writer manages a combined "Panoptica DLP" policy with one rule
    // per chosen country. Drift detection is per-rule (operator can edit a
    // single country's rule via portal without affecting others).
    //
    // Rule shape per Microsoft: each rule has a Policy property pointing
    // back to its parent. ContentContainsSensitiveInformation is an array
    // of {Name, MinCount, MaxCount, ConfidenceLevel} per sensitive type.
    // Apr 27, 2026 (revised — second iteration).
    // First attempt added Identity + Guid to policies hoping to give the JS
    // layer multiple keys to match rules against. Trilogiam started returning
    // poll_error after that change — strongest hypothesis is that Identity
    // and/or Guid serialize as complex System.Guid / nested PSObject types
    // that ConvertTo-Json -Depth 5 either truncates or trips over. Reverted
    // to a minimal set + force-cast everything to strings via [string] so
    // serialization is bulletproof.
    //
    // The actual fix for rule attachment is ParentPolicyName (canonical) on
    // rules, which IS preserved here. Falls back to Policy in JS if it's
    // not surfaced by Microsoft for some reason.
    const expression = `
$policies = @(Get-DlpCompliancePolicy -ErrorAction SilentlyContinue) |
  Select-Object @{Name='Name'; Expression={ [string]$_.Name }}, @{Name='Mode'; Expression={ [string]$_.Mode }}, @{Name='Enabled'; Expression={ [bool]$_.Enabled }}, @{Name='Workloads'; Expression={ ($_.Workload -join ',') }}
$rules = @(Get-DlpComplianceRule -ErrorAction SilentlyContinue) |
  Select-Object @{Name='Name'; Expression={ [string]$_.Name }}, @{Name='Policy'; Expression={ [string]$_.Policy }}, @{Name='ParentPolicyName'; Expression={ [string]$_.ParentPolicyName }}, @{Name='SensitiveTypes'; Expression={ @($_.ContentContainsSensitiveInformation | ForEach-Object { $_.Name } | Sort-Object) }}, @{Name='BlockAccess'; Expression={ [bool]$_.BlockAccess }}, @{Name='Disabled'; Expression={ [bool]$_.Disabled }}
@{ policies = @($policies); rules = @($rules) } | ConvertTo-Json -Depth 5 -Compress
`;
    const result = await runIppsCmdlet(tenantAzureId, expression);
    const policies = Array.isArray(result?.policies) ? result.policies : [];
    const rules = Array.isArray(result?.rules) ? result.rules : [];

    const total = policies.length;
    const enforcing = policies.filter(p => String(p?.Mode || '').toLowerCase() === 'enable' && p?.Enabled === true);
    const auditing  = policies.filter(p => /^test/i.test(String(p?.Mode || '')));
    const workloads = new Set();
    for (const p of policies) {
      String(p?.Workloads || '').split(',').map(w => w.trim()).filter(Boolean).forEach(w => workloads.add(w));
    }

    // Apr 27 — audit-only pivot. The reader returns the full DLP surface
    // (every policy + every rule + every sensitive type) so the audit_only
    // matches() can do snapshot equality. No "Panoptica-managed" name
    // special-casing — operators manage policies via Purview portal under
    // whatever names they want.
    const policyDetails = policies.map(p => {
      // Apr 27, 2026 (revised) — attach rules by ParentPolicyName when
      // Microsoft surfaces it, fall back to Policy. Both are force-cast to
      // strings in the PowerShell expression above so this is a clean string
      // comparison without complex-type weirdness.
      const pName = p?.Name;
      const policyRules = rules.filter(r => {
        const ppn = r?.ParentPolicyName;
        const pol = r?.Policy;
        return (ppn && ppn === pName) || (pol && pol === pName);
      }).map(r => ({
        name: r?.Name,
        sensitive_types: Array.isArray(r?.SensitiveTypes)
          ? r.SensitiveTypes.map(s => String(s))
          : (r?.SensitiveTypes ? [String(r.SensitiveTypes)] : []),
        block_access: r?.BlockAccess === true,
        disabled: r?.Disabled === true,
      }));
      return {
        name: p?.Name,
        mode: String(p?.Mode || ''),
        enabled: p?.Enabled === true,
        workloads: String(p?.Workloads || '').split(',').map(w => w.trim()).filter(Boolean).sort(),
        rules: policyRules,
      };
    });

    let interpreted;
    if (total === 0) {
      interpreted = 'No DLP policies configured — Match captures the empty state as a baseline so any new policy fires drift';
    } else if (enforcing.length > 0 && auditing.length > 0) {
      interpreted = `Monitoring ${total} DLP polic${total === 1 ? 'y' : 'ies'} — ${enforcing.length} enforcing, ${auditing.length} in audit mode (${[...workloads].join(', ')})`;
    } else if (enforcing.length > 0) {
      interpreted = `Monitoring ${enforcing.length} enforcing DLP polic${enforcing.length === 1 ? 'y' : 'ies'} (${[...workloads].join(', ')})`;
    } else if (auditing.length > 0) {
      interpreted = `Monitoring ${auditing.length} audit-mode DLP polic${auditing.length === 1 ? 'y' : 'ies'} — these log violations but do NOT block`;
    } else {
      interpreted = `Monitoring ${total} DLP polic${total === 1 ? 'y' : 'ies'} (none currently active)`;
    }

    return {
      ok: true,
      current_value: {
        total_policies: total,
        enforcing_count: enforcing.length,
        auditing_count: auditing.length,
        workloads: [...workloads],
        // Audit snapshot source: full per-policy detail with all rules and
        // their sensitive types. Consumed by CMP-02's captureBaseline + matches.
        policy_details: policyDetails,
      },
      interpreted,
    };
  } catch (e) {
    return handlePwshError(e, 'CMP-02', { role: 'Exchange Administrator + Compliance Administrator' });
  }
}


// ══════════════════════════════════════════════════════════════════
// TEA-01 — Disable Anonymous Meeting Join and Restrict Meeting Lobby
// ══════════════════════════════════════════════════════════════════
//
// Cmdlet: Get-CsTeamsMeetingPolicy -Identity Global
//
// Properties of interest:
//   AllowAnonymousUsersToJoinMeeting — bool. $false = anonymous join blocked.
//   AutoAdmittedUsers — string enum. Controls who skips the lobby.
//     Values: 'EveryoneInCompany' | 'EveryoneInSameAndFederatedCompany' |
//             'Everyone' | 'OrganizerOnly' | 'EveryoneInCompanyExcludingGuests' |
//             'InvitedUsers'
//
// Recommended state: AllowAnonymous=$false AND AutoAdmittedUsers in
// {'EveryoneInCompany','EveryoneInCompanyExcludingGuests','OrganizerOnly',
//  'InvitedUsers'} (anything that's NOT 'Everyone' — i.e. lobby holds
// external/anonymous attendees).
async function readTeamsAnonymousAndLobby(tenantAzureId) {
  try {
    const expression = `
Get-CsTeamsMeetingPolicy -Identity Global | Select-Object AllowAnonymousUsersToJoinMeeting, AutoAdmittedUsers | ConvertTo-Json -Compress
`;
    const result = await runTeamsCmdlet(tenantAzureId, expression);
    const allowAnon = result?.AllowAnonymousUsersToJoinMeeting === true;
    const autoAdmit = String(result?.AutoAdmittedUsers || '').trim();

    // 'Everyone' is the only AutoAdmittedUsers value that bypasses the
    // lobby for unauthenticated attendees. All others hold them.
    const lobbyHoldsExternal = autoAdmit && autoAdmit !== 'Everyone';

    // Apr 28, 2026 — interpreted strings rewritten to match the three-option
    // model on the writer. "Anonymous + lobby" is now a deliberate option
    // (permissive_with_lobby — for training/coaching/external-customer
    // tenants), not a "risk" label. Risk framing is reserved for the
    // genuinely-risky configurations.
    let interpreted;
    if (!allowAnon && lobbyHoldsExternal) {
      interpreted = `Hardened — anonymous join blocked + lobby holds external (${autoAdmit}). Suits federated-only meeting tenants.`;
    } else if (!allowAnon) {
      interpreted = `Anonymous join blocked, but AutoAdmittedUsers="${autoAdmit}" lets externals skip lobby — inconsistent configuration`;
    } else if (lobbyHoldsExternal) {
      interpreted = `Permissive with lobby — anonymous join allowed + lobby holds external (${autoAdmit}). Suits training/coaching/external-customer tenants.`;
    } else {
      interpreted = `Open — anonymous join allowed + everyone auto-admits (${autoAdmit}). Zoom-bombing exposure.`;
    }

    return {
      ok: true,
      current_value: {
        allow_anonymous: allowAnon,
        auto_admitted_users: autoAdmit,
        lobby_holds_external: lobbyHoldsExternal,
      },
      interpreted,
    };
  } catch (e) {
    return handlePwshError(e, 'TEA-01', { role: 'Teams Administrator' });
  }
}


// ══════════════════════════════════════════════════════════════════
// TEA-02 — Restrict External Access and Guest Access in Teams
// ══════════════════════════════════════════════════════════════════
//
// Cmdlet: Get-CsTenantFederationConfiguration
//
// Properties of interest:
//   AllowFederatedUsers — bool. Master toggle for Teams federation.
//   AllowedDomains — complex. Can be {AllowAllKnownDomains} (open to all)
//                    or a Domain-list (allowlist).
//   BlockedDomains — list (denylist).
//   AllowTeamsConsumer — bool. Allow chat with personal Microsoft accounts.
//   AllowPublicUsers — bool (legacy Skype consumer). Should be false.
//
// Recommended state: AllowFederatedUsers=$true with AllowedDomains as a
// SPECIFIC LIST (allowlist) of partner domains. "Open to all" federation
// is the SMB-default risky state.
async function readTeamsFederation(tenantAzureId) {
  try {
    // Discriminator: count entries in AllowedDomain. AllowFederatedUsers=true
    // with zero AllowedDomain entries means "open to all known domains"
    // (the AllowAllKnownDomains form). With entries it's an allowlist.
    // Type-name probing was unreliable — PowerShell wraps the object in
    // PSObject in v4.x, so GetType().Name returns "PSObject" instead of
    // the underlying CsEdgeAllowAllKnownDomains / CsEdgeAllowList type.
    const expression = `
Get-CsTenantFederationConfiguration |
  Select-Object AllowFederatedUsers, AllowTeamsConsumer, AllowPublicUsers,
                @{Name='AllowlistDomains'; Expression={
                  if ($_.AllowedDomains.AllowedDomain) {
                    @($_.AllowedDomains.AllowedDomain | ForEach-Object { ($_.Domain -as [string]).ToLowerInvariant() } | Sort-Object)
                  } else { @() }
                }},
                @{Name='BlockedDomainsList'; Expression={
                  if ($_.BlockedDomains) {
                    @($_.BlockedDomains | ForEach-Object { ($_.Domain -as [string]).ToLowerInvariant() } | Sort-Object)
                  } else { @() }
                }} |
  ConvertTo-Json -Depth 5 -Compress
`;
    const result = await runTeamsCmdlet(tenantAzureId, expression);
    const allowFed = result?.AllowFederatedUsers === true;
    const allowConsumer = result?.AllowTeamsConsumer === true;
    const allowPublic = result?.AllowPublicUsers === true;
    // Defensive: ConvertTo-Json may unwrap single-element arrays
    const rawAllow = result?.AllowlistDomains;
    const allowlistDomains = Array.isArray(rawAllow) ? rawAllow : (rawAllow ? [String(rawAllow)] : []);
    const rawBlock = result?.BlockedDomainsList;
    const blockedDomains  = Array.isArray(rawBlock) ? rawBlock : (rawBlock ? [String(rawBlock)] : []);
    const allowlistCount = allowlistDomains.length;
    const blockCount = blockedDomains.length;

    const consumerWarning = allowConsumer ? ', personal Microsoft accounts ALLOWED (extra risk)' : '';

    let interpreted;
    if (!allowFed) {
      interpreted = `Federation DISABLED — no external Teams chat${consumerWarning}`;
    } else if (allowlistCount > 0) {
      interpreted = `Federation restricted to ${allowlistCount} domain${allowlistCount === 1 ? '' : 's'} (allowlist) — recommended${consumerWarning}`;
    } else {
      // AllowFederatedUsers=true + 0 allowlist entries = open to all known
      // M365 tenants. The risk profile depends on whether personal Microsoft
      // accounts (consumer) are also allowed — that's the dangerous flag for
      // SMB phishing exposure. "Open + consumer blocked" is the SMB-recommended
      // baseline per Jacques' product framing (most practical, blocks personal
      // account vector). "Open + consumer allowed" is the Microsoft default
      // and the truly risky state.
      const blockNote = blockCount > 0 ? ` (with ${blockCount} blocked)` : '';
      if (allowConsumer) {
        interpreted = `Federation OPEN to all M365 tenants + personal accounts ALLOWED${blockNote} — risk (any tenant or personal account can chat your users)`;
      } else {
        interpreted = `Federation open to other M365 tenants${blockNote}, personal accounts blocked (recommended for SMBs)`;
      }
    }

    return {
      ok: true,
      current_value: {
        allow_federated_users: allowFed,
        allow_teams_consumer: allowConsumer,
        allow_public_users: allowPublic,
        allowlist_count: allowlistCount,
        blocked_domains_count: blockCount,
        allowlist_domains: allowlistDomains,  // sorted, lowercased
        blocked_domains: blockedDomains,      // sorted, lowercased
      },
      interpreted,
    };
  } catch (e) {
    return handlePwshError(e, 'TEA-02', { role: 'Teams Administrator' });
  }
}


// ══════════════════════════════════════════════════════════════════
// EXO-09 — Strict Mailbox Audit Posture (Bypass + Action List)
// ══════════════════════════════════════════════════════════════════
//
// EXO-03 covers AuditEnabled but NOT the two ways mailbox audit silently
// produces zero events even with AuditEnabled=True:
//
//   1. AuditBypassAssociation=True (via Set-MailboxAuditBypassAssociation)
//      — legacy migration artifact common on shared/resource mailboxes set
//      up via PowerShell; suppresses ALL audit logging silently.
//   2. Missing actions in AuditOwner — without MailItemsAccessed in the
//      owner action list, the entire MailItemsAccessed UAL detection
//      produces no events for owner-driven reads (which is what we care
//      about most when investigating compromise).
//
// Required AuditOwner action set. Aligned with what Microsoft accepts on
// Business Premium tenants per the verbatim Set-Mailbox error message:
// "Supported audit operations for Mailbox Owner are None, Create, SoftDelete,
//  HardDelete, Update, Move, MoveToDeletedItems, MailboxLogin and
//  UpdateFolderPermissions."
//
// MailItemsAccessed (the original headline action) is NOT in this list —
// it's license-gated above Business Premium (requires Defender for Office 365
// P2 / E3+). Including it caused per-mailbox Apply failures on May 5 2026
// against caevsf.com. FolderBind is also rejected on this tenant tier.
//
// MailboxLogin is supported but excluded by choice — it logs every successful
// mailbox login which generates significant volume for active mailboxes
// without proportional forensic value (we already have sign-in alerts).
const REQUIRED_AUDIT_OWNER_ACTIONS = [
  'Create',
  'SoftDelete',
  'HardDelete',
  'Update',
  'Move',
  'MoveToDeletedItems',
  'UpdateFolderPermissions',
];

// Per-tenant cap on how many problem mailboxes we serialize back. Reader
// stays lightweight; the count is what matters for matches() / interpret().
// Operator drilling into specifics can run their own Get-Mailbox query.
const MAX_PROBLEM_MAILBOXES_REPORTED = 50;

async function readMailboxAuditPosture(tenantAzureId) {
  try {
    // Per-mailbox bypass check requires Get-MailboxAuditBypassAssociation
    // per mailbox. Pre-filter to only enabled mailboxes so the loop is
    // bounded; tenants with thousands of disabled mailboxes don't pay the
    // per-mailbox cost twice.
    const expression = `
$mboxes = Get-Mailbox -ResultSize Unlimited -Filter 'RecipientTypeDetails -eq "UserMailbox"' | Where-Object { $_.AuditEnabled } | Select-Object Identity,UserPrincipalName,AuditOwner
$total = ($mboxes | Measure-Object).Count
$bypassEnabledCount = 0
$missingActionsCount = 0
$problems = @()
$required = @('${REQUIRED_AUDIT_OWNER_ACTIONS.join("','")}')
$reported = 0

# v8 (May 6 2026) fast-path: a single bulk call tells us tenant-wide whether
# ANY mailbox has bypass=true. On a clean tenant (the common case once
# remediated, expected on >95% of tenants in steady state), we skip the
# expensive per-mailbox bypass check entirely. We only fall through to the
# per-mailbox loop when the bulk count is non-zero, where UPN-based per-
# mailbox lookup is needed for accurate identification under Name collisions.
# If the bulk call fails (rare), -1 forces the slow path defensively.
$anyBypassCount = -1
try {
  $anyBypassCount = @(Get-MailboxAuditBypassAssociation -ResultSize Unlimited -ErrorAction Stop |
    Where-Object { $_.AuditBypassEnabled }).Count
} catch {
  $anyBypassCount = -1
}

foreach ($mbx in $mboxes) {
  $bypassFlag = $false
  if ($anyBypassCount -ne 0) {
    try {
      # Use UPN (globally unique) instead of mbx.Identity. EXO V3 returns Name
      # in mbx.Identity, which is NOT unique — Cuisi-N-Art (May 6 2026) has two
      # objects whose Name resolves to "reception". Get is lenient with
      # ambiguous lookups and returns BOTH matches; the boolean array check on
      # b.AuditBypassEnabled evaluates truthy if ANY match has bypass=true,
      # so the reader counts the OTHER object's bypass against njoanisse's
      # UserMailbox and persistently mis-reports "1 of N orphans" forever.
      $b = Get-MailboxAuditBypassAssociation -Identity $mbx.UserPrincipalName -ErrorAction Stop
      if ($b -and $b.AuditBypassEnabled) { $bypassFlag = $true }
    } catch {}
  }

  $ownerActions = @()
  if ($mbx.AuditOwner) { $ownerActions = @($mbx.AuditOwner) }
  $missing = @($required | Where-Object { $_ -notin $ownerActions })

  $hasBypass = $bypassFlag
  $hasMissing = ($missing.Count -gt 0)

  if ($hasBypass) { $bypassEnabledCount++ }
  if ($hasMissing) { $missingActionsCount++ }

  if (($hasBypass -or $hasMissing) -and ($reported -lt ${MAX_PROBLEM_MAILBOXES_REPORTED})) {
    $problems += @{
      upn = "$($mbx.UserPrincipalName)"
      bypass = $hasBypass
      missingActions = $missing
    }
    $reported++
  }
}

@{
  total_user_mailboxes = $total
  bypass_enabled_count = $bypassEnabledCount
  missing_owner_actions_count = $missingActionsCount
  problem_mailboxes = $problems
  required_actions = $required
  truncated = ($bypassEnabledCount + $missingActionsCount) -gt ${MAX_PROBLEM_MAILBOXES_REPORTED}
} | ConvertTo-Json -Depth 4 -Compress
`;
    const result = await runExoCmdlet(tenantAzureId, expression, { timeoutMs: 90000 });
    const total = result?.total_user_mailboxes ?? 0;
    const bypassCount = result?.bypass_enabled_count ?? 0;
    const missingCount = result?.missing_owner_actions_count ?? 0;
    const problems = Array.isArray(result?.problem_mailboxes) ? result.problem_mailboxes : [];

    let interpreted;
    if (total === 0) {
      interpreted = 'No audit-enabled user mailboxes found — apply EXO-03 first';
    } else if (bypassCount === 0 && missingCount === 0) {
      interpreted = `Audit posture clean across all ${total} audit-enabled mailbox${total === 1 ? '' : 'es'}`;
    } else {
      const parts = [];
      if (bypassCount > 0) parts.push(`${bypassCount} with audit bypass enabled`);
      if (missingCount > 0) parts.push(`${missingCount} missing critical owner actions`);
      interpreted = `Audit gap: ${parts.join(', ')} of ${total} mailbox${total === 1 ? '' : 'es'}`;
    }

    return {
      ok: true,
      current_value: {
        total_user_mailboxes: total,
        bypass_enabled_count: bypassCount,
        missing_owner_actions_count: missingCount,
        problem_mailboxes: problems,
        required_actions: result?.required_actions || REQUIRED_AUDIT_OWNER_ACTIONS,
        truncated: !!result?.truncated,
      },
      interpreted,
    };
  } catch (e) {
    return handlePwshError(e, 'EXO-09');
  }
}


// ══════════════════════════════════════════════════════════════════
// Dispatcher
// ══════════════════════════════════════════════════════════════════
const READERS = {
  'EXO-01': readMailTips,
  'EXO-02': readAutoForwardingDefault,
  'EXO-03': readMailboxAuditing,
  'EXO-05': readOutboundSpamPolicy,
  'EXO-06': readPresetSecurityPolicy,
  // EXO-07 removed Apr 26, 2026 — see /dev/Panoptica/Security_Settings_Backlog.md
  'EXO-08': readSmtpAuth,
  'EXO-09': readMailboxAuditPosture,
  'CMP-01': readUnifiedAuditLog,
  'CMP-02': readDlpPolicies,
  'TEA-01': readTeamsAnonymousAndLobby,
  'TEA-02': readTeamsFederation,
  // SPO-01, SPO-02 — Phase A2.4 (need SPO runner extension)
};

/**
 * Poll a single (tenant, setting) pair via PowerShell.
 *
 * @param {string} tenantAzureId — Azure AD GUID (tenants.tenant_id)
 * @param {string} settingId     — e.g. 'EXO-02'
 */
async function pollSetting(tenantAzureId, settingId) {
  const reader = READERS[settingId];
  if (!reader) {
    return {
      ok: false,
      unavailable: true,
      error: `${settingId} reader not yet implemented (Phase A2.4 for SPO)`,
    };
  }
  return reader(tenantAzureId, settingId);
}

module.exports = {
  pollSetting,
  getConfigStatus,
  _readers: READERS,
};
