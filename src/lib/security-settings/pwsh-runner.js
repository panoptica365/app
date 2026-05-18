/**
 * Panoptica365 — PowerShell Core Runner (Phase A2.1)
 *
 * Bridges Node.js to PowerShell Core (pwsh) for EXO / SPO / Teams cmdlets
 * that have no Graph equivalent. Generic enough to drive any cmdlet via
 * runPwsh(), with an EXO convenience wrapper (runExoCmdlet) that handles
 * the Connect/Disconnect cycle and certificate-based auth.
 *
 * ─── Design choices, with reasoning ────────────────────────────
 *
 * 1. Spawn-per-invocation, not long-lived child processes.
 *    Each call spawns pwsh, connects to EXO with the cert, runs the
 *    cmdlet, prints JSON, disconnects, and exits. Cold-connect is
 *    2-4 seconds; for a 4-6 hour poll cycle that overhead is fine.
 *    A long-lived pwsh child that maintains EXO sessions is a future
 *    optimisation (~10x faster for chains of cmdlets) but adds session
 *    drift, memory leak, and crash-recovery complexity. Not worth it
 *    for Phase A2.1.
 *
 * 2. Strict JSON I/O contract.
 *    Every script the runner executes is wrapped so its output is a
 *    single JSON object on stdout. Errors become {"__error__": "..."}.
 *    The runner parses stdout, ignores stderr (EXO is chatty), and
 *    surfaces __error__ as a typed error if present. No "string match
 *    on stderr" for error detection — that pattern is fragile.
 *
 * 3. Fail-loud on misconfiguration.
 *    The runner refuses to operate if GRAPH_CERT_PATH or
 *    GRAPH_CERT_THUMBPRINT are missing from .env, returning a
 *    distinctive PWSH_NOT_CONFIGURED error. This is materially better
 *    than letting child_process.spawn fail with an obscure message.
 *
 * 4. Wall-clock timeout enforced via spawn timeout option.
 *    Default 30s. EXO PowerShell connect can stall on Microsoft-side
 *    issues for 60+ seconds; better to fail fast and let the poller
 *    move on than block the slow-tier queue.
 *
 * 5. Structured error mapping, not free-text.
 *    Errors get a `code` (PWSH_AUTH, PWSH_TENANT_PERMS, PWSH_TIMEOUT,
 *    PWSH_NOT_CONFIGURED, PWSH_PARSE, PWSH_CMDLET) so callers can
 *    discriminate without parsing English error strings. The original
 *    message is preserved in `.message`.
 */

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const config = require('../../../config/default');
const graph = require('../../graph');

// ──────────────────────────────────────────────────────────────
// Config validation — runs once on require()
// ──────────────────────────────────────────────────────────────
function checkConfig() {
  const missing = [];
  if (!config.pwsh.certPath)        missing.push('GRAPH_CERT_PATH');
  if (!config.pwsh.certThumbprint)  missing.push('GRAPH_CERT_THUMBPRINT');
  if (!config.pwsh.appId)           missing.push('ENTRA_CLIENT_ID');
  if (missing.length > 0) {
    return { configured: false, reason: `Missing env vars: ${missing.join(', ')}` };
  }
  if (!fs.existsSync(config.pwsh.certPath)) {
    return { configured: false, reason: `Certificate file not readable at ${config.pwsh.certPath}` };
  }
  if (!fs.existsSync(config.pwsh.binary)) {
    return { configured: false, reason: `pwsh binary not found at ${config.pwsh.binary} — run sudo ./ps-setup.sh` };
  }
  return { configured: true };
}

const CONFIG_STATUS = checkConfig();

// ──────────────────────────────────────────────────────────────
// PwshError — structured error type
// ──────────────────────────────────────────────────────────────
class PwshError extends Error {
  constructor(code, message, originalMessage = null) {
    super(message);
    this.name = 'PwshError';
    this.code = code;                     // PWSH_AUTH | PWSH_TENANT_PERMS | PWSH_TIMEOUT | PWSH_NOT_CONFIGURED | PWSH_PARSE | PWSH_CMDLET
    this.originalMessage = originalMessage;
  }
}

// Map a raw pwsh/EXO error message to a structured code. The patterns
// here are based on observed error strings; expand as new failure modes
// surface in production.
function classifyPwshError(rawMessage) {
  const msg = String(rawMessage || '');
  if (/AADSTS|invalid_client|invalid_grant|certificate.*not found|authentication failed/i.test(msg)) {
    return 'PWSH_AUTH';
  }
  if (/AccessDenied|insufficient privileges|not authorized|RoleAssignment/i.test(msg)) {
    return 'PWSH_TENANT_PERMS';
  }
  if (/timeout|timed out/i.test(msg)) {
    return 'PWSH_TIMEOUT';
  }
  if (/cannot find|not recognized|cmdlet/i.test(msg)) {
    return 'PWSH_CMDLET';
  }
  return 'PWSH_CMDLET';
}

// ──────────────────────────────────────────────────────────────
// Generic pwsh invocation
// ──────────────────────────────────────────────────────────────
/**
 * Run a pwsh script and parse JSON from stdout.
 *
 * The wrapping here is deliberate:
 *   - $ErrorActionPreference = 'Stop' makes any cmdlet error throw
 *   - $ProgressPreference / $InformationPreference = SilentlyContinue
 *     suppresses Microsoft branding banners that would corrupt stdout
 *   - try/catch produces a {"__error__": "..."} stdout payload on failure
 *     so we never have to parse stderr for error detection
 *
 * @param {string} scriptText — pwsh code that prints a SINGLE JSON object
 * @param {object} [options]
 * @param {number} [options.timeoutMs] — wall-clock limit (default from config)
 * @returns {Promise<any>} — parsed JSON
 * @throws {PwshError}
 */
function runPwsh(scriptText, options = {}) {
  return new Promise((resolve, reject) => {
    if (!CONFIG_STATUS.configured) {
      return reject(new PwshError('PWSH_NOT_CONFIGURED', CONFIG_STATUS.reason));
    }
    const timeoutMs = options.timeoutMs || config.pwsh.invocationTimeoutMs;
    // May 6, 2026 — onProgress callback support for async-Apply.
    // The callback receives parsed progress markers emitted from PowerShell
    // scripts as `[PANOPTICA-PROGRESS] current=N total=M message=X` lines.
    // Lines matching the marker are intercepted; non-marker lines fall
    // through to the existing JSON-tail parser.
    //
    // The handleProcess option (function) is invoked synchronously with
    // the spawned ChildProcess so the caller (the security-apply-worker)
    // can attach a 30-min hard-timeout killer that's independent of the
    // spawn() built-in timeout. We can't rely on spawn's timeout alone
    // because mid-run we may want to escalate from SIGTERM to SIGKILL.
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    const handleProcess = typeof options.handleProcess === 'function' ? options.handleProcess : null;

    // Wrap the user script in error-handling and JSON output. Note: we
    // emit a single line on stdout — either the cmdlet's JSON, or a
    // structured error JSON. Anything else (banners, warnings) goes to
    // $null or stderr and is ignored on success.
    //
    // May 3, 2026 DIAGNOSTIC — error payload now includes invocation context
    // so we can see WHICH cmdlet at WHAT line threw the error.
    const wrapped = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$InformationPreference = 'SilentlyContinue'
$WarningPreference = 'SilentlyContinue'
# May 6, 2026 — when stdout is redirected to a pipe (always true under
# child_process.spawn), .NET's default Console.Out wraps it in a StreamWriter
# whose AutoFlush is FALSE. That means [Console]::Out.WriteLine progress
# markers (~50 bytes each) accumulate in a 4KB buffer and never flush mid-run
# — only on process exit. Replace Console.Out with an AutoFlush StreamWriter
# so each WriteLine flushes immediately, making progress streaming work.
# Final cmdlet output (ConvertTo-Json) ultimately routes through this same
# Console.Out via PowerShell's host, so it benefits too with no regression.
$__panopticaStdout = [Console]::OpenStandardOutput()
$__panopticaWriter = New-Object System.IO.StreamWriter($__panopticaStdout)
$__panopticaWriter.AutoFlush = $true
[Console]::SetOut($__panopticaWriter)
try {
  ${scriptText}
} catch {
  @{
    __error__ = $_.Exception.Message
    __category__ = $_.CategoryInfo.Category.ToString()
    __invocation__ = $_.InvocationInfo.MyCommand.Name
    __position__ = $_.InvocationInfo.PositionMessage
  } | ConvertTo-Json -Compress
  exit 1
}
`;
    // DIAGNOSTIC: log the actual script being sent so we can see exactly
    // what pwsh is executing. Look for [PWSH SCRIPT] in pm2 logs.
    // Gated behind PWSH_DEBUG=1 (May 9, 2026 — post-rollout cleanup; keep
    // a quiet default in steady-state production, enable per-session when
    // debugging a writer regression).
    if (process.env.PWSH_DEBUG) {
      console.log(`[PWSH SCRIPT] (${scriptText.length} chars):\n${scriptText.slice(0, 5000)}${scriptText.length > 5000 ? '\n... [truncated]' : ''}`);
    }

    const child = spawn(config.pwsh.binary, [
      '-NoProfile',
      '-NonInteractive',
      '-Command', wrapped,
    ], {
      timeout: timeoutMs,
      // Ensure the child can find user-scope modules (ExchangeOnlineManagement, etc.)
      // installed by ps-setup.sh into ~/.local/share/powershell/Modules.
      // Spawning under the same UID as the parent (default) is sufficient.
    });

    // Hand the spawned child to the caller so it can attach extra timeouts /
    // kill the process out-of-band (30-min hard cap in the apply worker).
    if (handleProcess) {
      try { handleProcess(child); } catch (e) {
        console.warn('[PWSH] handleProcess callback threw:', e.message);
      }
    }

    let stdout = '';
    let stderr = '';
    // May 6, 2026 — line-buffered stdout reading so [PANOPTICA-PROGRESS]
    // markers can be intercepted and dispatched to the onProgress callback
    // in real-time instead of being accumulated into the final result blob.
    // Non-progress lines (including the trailing JSON success/error payload)
    // are still appended to `stdout` for the existing close-handler parser.
    let stdoutLineBuf = '';
    child.stdout.on('data', d => {
      const text = d.toString();
      stdoutLineBuf += text;
      let nlIdx;
      while ((nlIdx = stdoutLineBuf.indexOf('\n')) !== -1) {
        const line = stdoutLineBuf.slice(0, nlIdx);
        stdoutLineBuf = stdoutLineBuf.slice(nlIdx + 1);
        const progressMatch = line.match(/^\[PANOPTICA-PROGRESS\]\s+(.+)$/);
        if (progressMatch && onProgress) {
          // Format: `key=value key=value key=value` (space-separated). Values
          // may contain non-= characters (the `message=X Y Z` case is fine
          // because we only split on first =). PowerShell scripts emit it
          // via Write-Host so it lands here as a literal line.
          const fields = {};
          for (const tok of progressMatch[1].split(/\s+(?=[a-zA-Z_]+=)/)) {
            const eqIdx = tok.indexOf('=');
            if (eqIdx > 0) {
              const k = tok.slice(0, eqIdx).trim();
              const v = tok.slice(eqIdx + 1).trim();
              fields[k] = v;
            }
          }
          try {
            onProgress({
              current: fields.current !== undefined ? parseInt(fields.current, 10) : undefined,
              total: fields.total !== undefined ? parseInt(fields.total, 10) : undefined,
              message: fields.message,
              raw: line,
            });
          } catch (e) {
            console.warn('[PWSH] onProgress callback threw:', e.message);
          }
          // Don't append progress markers to the final stdout buffer —
          // they're not part of the result payload.
        } else {
          stdout += line + '\n';
        }
      }
    });
    child.stdout.on('end', () => {
      // Flush any remaining partial line. If it's a progress marker we
      // dispatch it; otherwise it joins the result buffer.
      if (stdoutLineBuf) {
        const progressMatch = stdoutLineBuf.match(/^\[PANOPTICA-PROGRESS\]\s+(.+)$/);
        if (!progressMatch) stdout += stdoutLineBuf;
        stdoutLineBuf = '';
      }
    });
    child.stderr.on('data', d => { stderr += d.toString(); });

    child.on('error', (err) => {
      reject(new PwshError('PWSH_CMDLET', `spawn failed: ${err.message}`, err.message));
    });

    child.on('close', (code, signal) => {
      // Timeout signature: signal is SIGTERM and code is null
      if (signal === 'SIGTERM' || code === null) {
        return reject(new PwshError('PWSH_TIMEOUT', `pwsh timed out after ${timeoutMs}ms`, stderr.slice(0, 500)));
      }

      // Try to parse the LAST JSON line of stdout. EXO cmdlets sometimes
      // print informational text before JSON despite our preference
      // suppressions, so we extract from the end.
      const trimmed = stdout.trim();
      if (!trimmed) {
        return reject(new PwshError('PWSH_PARSE', 'pwsh produced empty stdout', stderr.slice(0, 500)));
      }
      // Take the last non-empty line as the JSON payload. JSON objects
      // can span lines, so this works only if ConvertTo-Json -Compress
      // is used in the script — which our wrapper enforces.
      const lines = trimmed.split('\n').filter(l => l.trim());
      const lastLine = lines[lines.length - 1];

      let parsed;
      try {
        parsed = JSON.parse(lastLine);
      } catch (e) {
        return reject(new PwshError(
          'PWSH_PARSE',
          `failed to parse pwsh output as JSON: ${e.message}`,
          `stdout: ${stdout.slice(0, 500)} | stderr: ${stderr.slice(0, 500)}`
        ));
      }

      // The wrapper produces this shape on cmdlet errors
      if (parsed && typeof parsed === 'object' && parsed.__error__) {
        const errCode = classifyPwshError(parsed.__error__);
        // May 3, 2026 DIAGNOSTIC — append invocation context to the error
        // message so we can see which cmdlet at which position threw it.
        // The console.error is loud-and-permanent (in pm2 logs) for the
        // operator's diagnostic; the thrown PwshError still has the clean
        // message so the UI doesn't get flooded with PowerShell stack lines.
        if ((parsed.__invocation__ || parsed.__position__) && process.env.PWSH_DEBUG) {
          console.error(`[PWSH ERROR DETAIL] cmdlet=${parsed.__invocation__ || '?'} category=${parsed.__category__ || '?'}\n  position: ${(parsed.__position__ || '').slice(0, 500)}\n  message: ${parsed.__error__}`);
        }
        return reject(new PwshError(errCode, parsed.__error__, parsed.__category__ || null));
      }

      resolve(parsed);
    });
  });
}

// ──────────────────────────────────────────────────────────────
// Tenant primary-domain resolver
// ──────────────────────────────────────────────────────────────
//
// Connect-ExchangeOnline -Organization rejects GUIDs ("Organization
// cannot be a Guid, please enter the name of the tenant instead.") and
// requires a verified domain. The most stable choice is the tenant's
// initial `.onmicrosoft.com` domain — it always exists and never
// changes. We resolve via Graph /organization → verifiedDomains and
// cache per Node process.
//
// Cache: in-memory Map. Cleared on pm2 restart, which is acceptable —
// the per-tenant Graph call is sub-second and runs at most once per
// tenant per restart cycle. A TTL/invalidation hook is unnecessary
// because verifiedDomains.isInitial=true entries don't change in
// practice.
const tenantDomainCache = new Map();

async function resolveTenantDomain(tenantAzureId) {
  if (tenantDomainCache.has(tenantAzureId)) {
    return tenantDomainCache.get(tenantAzureId);
  }
  let orgPayload;
  try {
    orgPayload = await graph.callGraph(tenantAzureId, '/organization');
  } catch (e) {
    throw new PwshError(
      'PWSH_AUTH',
      `Could not resolve tenant primary domain via Graph: ${e.message}`,
      e.message
    );
  }
  // /organization returns { value: [{ verifiedDomains: [...], ... }] }
  // (or sometimes the bare entity with verifiedDomains directly, depending
  // on Graph version — handle both shapes defensively).
  const orgEntity = (Array.isArray(orgPayload?.value) && orgPayload.value[0]) || orgPayload;
  const domains = Array.isArray(orgEntity?.verifiedDomains) ? orgEntity.verifiedDomains : [];

  // Prefer isInitial=true (the *.onmicrosoft.com domain) — always present,
  // permanent, and what EXO's -Organization parameter is documented to take.
  // Fall back to isDefault, then to the first verified domain.
  const initial  = domains.find(d => d?.isInitial === true);
  const primary  = domains.find(d => d?.isDefault === true);
  const fallback = domains[0];
  const resolved = initial?.name || primary?.name || fallback?.name;

  if (!resolved) {
    throw new PwshError(
      'PWSH_CMDLET',
      `Could not resolve a verified domain for tenant ${tenantAzureId} — Graph returned no verifiedDomains entries`
    );
  }
  tenantDomainCache.set(tenantAzureId, resolved);
  return resolved;
}

// ──────────────────────────────────────────────────────────────
// EXO convenience wrapper — handles Connect/Disconnect + cert auth
// ──────────────────────────────────────────────────────────────
/**
 * Run a single Exchange Online cmdlet against a tenant via app-only
 * (cert-based) auth, and return the parsed cmdlet output as JSON.
 *
 * The script body should be a single pipeline ending in
 * `| ConvertTo-Json -Depth N -Compress`. Connect-ExchangeOnline and
 * Disconnect-ExchangeOnline are added by this wrapper — do NOT include
 * them in cmdletExpression.
 *
 * @param {string} tenantAzureId — the customer tenant's Azure AD GUID
 *                                 (Connect-ExchangeOnline accepts the GUID
 *                                 directly via -Organization).
 * @param {string} cmdletExpression — e.g. 'Get-RemoteDomain Default | Select Name, AutoForwardEnabled | ConvertTo-Json -Compress'
 * @param {object} [options]
 * @returns {Promise<any>} — parsed cmdlet output
 */
async function runExoCmdlet(tenantAzureId, cmdletExpression, options = {}) {
  if (!tenantAzureId) {
    throw new PwshError('PWSH_CMDLET', 'runExoCmdlet: tenantAzureId is required');
  }
  if (!cmdletExpression || typeof cmdletExpression !== 'string') {
    throw new PwshError('PWSH_CMDLET', 'runExoCmdlet: cmdletExpression must be a non-empty string');
  }

  // Resolve tenant -> primary verified domain. EXO's -Organization
  // parameter rejects GUIDs; cached per-process to amortise the Graph call.
  const tenantDomain = await resolveTenantDomain(tenantAzureId);

  // Cert path is interpolated as a literal string. Use single quotes in
  // the pwsh template to avoid PowerShell variable expansion on path
  // characters. The thumbprint check after Connect-ExchangeOnline is a
  // belt-and-suspenders sanity check — Connect-ExchangeOnline will throw
  // its own auth error if the cert is rejected, but having both a path
  // load AND a thumbprint match catches "wrong cert at path" cases.
  const script = `
$cert = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new('${config.pwsh.certPath}', '')
if ($cert.Thumbprint -ne '${config.pwsh.certThumbprint}') {
  throw "Cert thumbprint mismatch: expected ${config.pwsh.certThumbprint}, got $($cert.Thumbprint)"
}
Import-Module ExchangeOnlineManagement -ErrorAction Stop
Connect-ExchangeOnline -AppId '${config.pwsh.appId}' -Certificate $cert -Organization '${tenantDomain}' -ShowBanner:$false -ErrorAction Stop
try {
  ${cmdletExpression}
} finally {
  Disconnect-ExchangeOnline -Confirm:$false -ErrorAction SilentlyContinue | Out-Null
}
`;
  return runPwsh(script, options);
}

// ──────────────────────────────────────────────────────────────
// IPPSSession (Security & Compliance) convenience wrapper
// ──────────────────────────────────────────────────────────────
//
// Same module (ExchangeOnlineManagement) and same cert auth as
// runExoCmdlet, but Connect-IPPSSession instead of Connect-ExchangeOnline.
// Used by the Security & Compliance cmdlets:
//   - Get-EOPProtectionPolicyRule / Get-ATPProtectionPolicyRule (preset policies)
//   - Get-AtpPolicyForO365 (Safe Attachments/Links global)
//   - Get-DlpCompliancePolicy / Get-DlpComplianceRule (DLP)
//
// CRITICAL — `-CommandName` is REQUIRED, not optional.
// In ExchangeOnlineManagement v3.x, Connect-IPPSSession defaults to REST
// transport. REST mode does NOT auto-import the legacy cmdlet proxies
// into the caller's scope, so a script that calls Get-DlpCompliancePolicy
// (etc.) after a clean Connect-IPPSSession will fail with
// "term not recognized as a name of a cmdlet". -CommandName forces the
// proxy import for the listed cmdlets. This bit us once on first run
// (Apr 25) — see project memory for the diagnosis.
//
// Notes on the connection lifecycle:
//   - IPPSSession also rejects GUIDs in -Organization — same domain
//     resolution as EXO.
//   - There's no standalone Disconnect-IPPSSession in older module
//     versions; Disconnect-ExchangeOnline blanket-disconnects all sessions
//     including IPPS, so it's safe to reuse here.
//   - ConnectionUri default works for Worldwide tenants. Sovereign clouds
//     need an explicit URI via PWSH_IPPS_URI env var.
//
// Default cmdlet allowlist below covers every IPPS cmdlet currently used
// across the readers. Phase B (write path) will likely add Set-* variants
// of these. Add new entries here, NOT in individual readers.
// Cmdlets we genuinely need via S&C PowerShell (Connect-IPPSSession).
// Despite the "EOP" and "Atp" names of some preset/safe-links cmdlets,
// those live in the ExchangeOnline module — call them via runExoCmdlet,
// not runIppsCmdlet. Only DLP-related cmdlets are true S&C cmdlets here.
//
// Apr 26 v4 — extended for CMP-02 DLP writer (combined policy with per-country rules).
const IPPS_DEFAULT_CMDLETS = [
  'Get-DlpCompliancePolicy',
  'Get-DlpComplianceRule',
  'New-DlpCompliancePolicy',
  'Set-DlpCompliancePolicy',
  'Remove-DlpCompliancePolicy',
  'New-DlpComplianceRule',
  'Set-DlpComplianceRule',
  'Remove-DlpComplianceRule',
];

async function runIppsCmdlet(tenantAzureId, cmdletExpression, options = {}) {
  if (!tenantAzureId) {
    throw new PwshError('PWSH_CMDLET', 'runIppsCmdlet: tenantAzureId is required');
  }
  if (!cmdletExpression || typeof cmdletExpression !== 'string') {
    throw new PwshError('PWSH_CMDLET', 'runIppsCmdlet: cmdletExpression must be a non-empty string');
  }

  const tenantDomain = await resolveTenantDomain(tenantAzureId);

  // Append -ConnectionUri only if we have one configured. Otherwise let
  // Connect-IPPSSession auto-detect the tenant's compliance endpoint.
  const connectionUriArg = config.pwsh.ippsConnectionUri
    ? `-ConnectionUri '${config.pwsh.ippsConnectionUri}'`
    : '';

  // Caller-supplied override is allowed but rare; the default list covers
  // everything our readers use. Comma-joined for the pwsh -CommandName
  // parameter syntax.
  const cmdlets = Array.isArray(options.commandNames) && options.commandNames.length > 0
    ? options.commandNames
    : IPPS_DEFAULT_CMDLETS;
  const cmdletList = cmdlets.map(c => `'${c}'`).join(',');

  const script = `
$cert = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new('${config.pwsh.certPath}', '')
if ($cert.Thumbprint -ne '${config.pwsh.certThumbprint}') {
  throw "Cert thumbprint mismatch: expected ${config.pwsh.certThumbprint}, got $($cert.Thumbprint)"
}
Import-Module ExchangeOnlineManagement -ErrorAction Stop
Connect-IPPSSession -AppId '${config.pwsh.appId}' -Certificate $cert -Organization '${tenantDomain}' ${connectionUriArg} -CommandName ${cmdletList} -ShowBanner:$false -ErrorAction Stop
try {
  ${cmdletExpression}
} finally {
  Disconnect-ExchangeOnline -Confirm:$false -ErrorAction SilentlyContinue | Out-Null
}
`;
  return runPwsh(script, options);
}

// ──────────────────────────────────────────────────────────────
// Microsoft Teams (Connect-MicrosoftTeams) convenience wrapper
// ──────────────────────────────────────────────────────────────
//
// Different module from EXO/IPPS — uses the MicrosoftTeams module installed
// by ps-setup.sh. Cert auth pattern is similar but the parameter names
// differ:
//   Connect-MicrosoftTeams -TenantId <guid-OR-domain> -Certificate $cert -ApplicationId $appId
//
// Notes vs. EXO/IPPS:
//   - -TenantId accepts the Azure GUID directly (unlike EXO's -Organization
//     which rejects GUIDs). No domain resolution needed for Teams. We pass
//     the GUID for fewer moving parts.
//   - The ApplicationId parameter is named differently (Application*Id*,
//     not AppId). Easy mistake to make.
//   - There's a real Disconnect-MicrosoftTeams (not aliased to
//     Disconnect-ExchangeOnline). Use it explicitly.
//   - Tenant-side requirement: the SP needs the Entra "Teams Administrator"
//     role granted in each customer tenant. Exchange Administrator does
//     NOT cover Teams cmdlets.
async function runTeamsCmdlet(tenantAzureId, cmdletExpression, options = {}) {
  if (!tenantAzureId) {
    throw new PwshError('PWSH_CMDLET', 'runTeamsCmdlet: tenantAzureId is required');
  }
  if (!cmdletExpression || typeof cmdletExpression !== 'string') {
    throw new PwshError('PWSH_CMDLET', 'runTeamsCmdlet: cmdletExpression must be a non-empty string');
  }

  const script = `
$cert = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new('${config.pwsh.certPath}', '')
if ($cert.Thumbprint -ne '${config.pwsh.certThumbprint}') {
  throw "Cert thumbprint mismatch: expected ${config.pwsh.certThumbprint}, got $($cert.Thumbprint)"
}
Import-Module MicrosoftTeams -ErrorAction Stop
Connect-MicrosoftTeams -TenantId '${tenantAzureId}' -Certificate $cert -ApplicationId '${config.pwsh.appId}' -ErrorAction Stop | Out-Null
try {
  ${cmdletExpression}
} finally {
  Disconnect-MicrosoftTeams -ErrorAction SilentlyContinue | Out-Null
}
`;
  return runPwsh(script, options);
}

// ──────────────────────────────────────────────────────────────
// Set-* cmdlet wrappers (Phase B v2 — write side)
// ──────────────────────────────────────────────────────────────
//
// EXO/IPPS/Teams Set-* cmdlets emit nothing on success — but the runner's
// JSON-out parser expects at least one JSON line on stdout, otherwise it
// throws PWSH_PARSE "pwsh produced empty stdout". The fix is small: append
// an explicit success-JSON emission after the Set-* expression. Errors are
// still caught by the runner's outer try/catch wrapper.
//
// Default timeout is bumped to 60s for writes — Set-* cmdlets routinely take
// 5-15s on Microsoft's side (much slower than Get-*), and the cold-connect
// overhead still applies.
//
// Idempotency note: most Set-* cmdlets are safely re-runnable (Set-Organization
// Config, Set-RemoteDomain, Set-AdminAuditLogConfig). New-* / Remove-* are NOT
// — those should not use this helper without explicit caller awareness.

const PWSH_WRITE_TIMEOUT_MS = 60000;
const SUCCESS_JSON_SUFFIX = '; @{ ok = $true } | ConvertTo-Json -Compress';

/**
 * Wrap a Set-* cmdlet expression with a success-JSON suffix and run via
 * runExoCmdlet. Returns the parsed { ok: true } object on success; throws
 * PwshError on failure (caught by the runner's wrapper).
 */
async function runExoSetCmdlet(tenantAzureId, setExpression, options = {}) {
  if (!setExpression || typeof setExpression !== 'string') {
    throw new PwshError('PWSH_CMDLET', 'runExoSetCmdlet: setExpression must be a non-empty string');
  }
  return runExoCmdlet(
    tenantAzureId,
    `${setExpression}${SUCCESS_JSON_SUFFIX}`,
    { timeoutMs: PWSH_WRITE_TIMEOUT_MS, ...options }
  );
}

/**
 * Same as runExoSetCmdlet but routed through Connect-IPPSSession for S&C
 * cmdlets. The IPPS -CommandName allowlist must include the Set-* cmdlet
 * being called — caller passes options.commandNames for non-default cmdlets.
 */
async function runIppsSetCmdlet(tenantAzureId, setExpression, options = {}) {
  if (!setExpression || typeof setExpression !== 'string') {
    throw new PwshError('PWSH_CMDLET', 'runIppsSetCmdlet: setExpression must be a non-empty string');
  }
  return runIppsCmdlet(
    tenantAzureId,
    `${setExpression}${SUCCESS_JSON_SUFFIX}`,
    { timeoutMs: PWSH_WRITE_TIMEOUT_MS, ...options }
  );
}

/**
 * Same as runExoSetCmdlet but routed through Connect-MicrosoftTeams.
 * The Teams module's Set-Cs* cmdlets often emit nothing on success; the
 * suffix wrapper makes them parser-safe.
 */
async function runTeamsSetCmdlet(tenantAzureId, setExpression, options = {}) {
  if (!setExpression || typeof setExpression !== 'string') {
    throw new PwshError('PWSH_CMDLET', 'runTeamsSetCmdlet: setExpression must be a non-empty string');
  }
  return runTeamsCmdlet(
    tenantAzureId,
    `${setExpression}${SUCCESS_JSON_SUFFIX}`,
    { timeoutMs: PWSH_WRITE_TIMEOUT_MS, ...options }
  );
}

module.exports = {
  runPwsh,
  runExoCmdlet,
  runIppsCmdlet,
  runTeamsCmdlet,
  runExoSetCmdlet,
  runIppsSetCmdlet,
  runTeamsSetCmdlet,
  resolveTenantDomain,
  PwshError,
  // Exported for status-page diagnostics — surfaces "PowerShell runner not
  // configured" reasons so the operator can fix .env without reading logs.
  getConfigStatus: () => ({ ...CONFIG_STATUS }),
  // Exported for unit testing / cache invalidation in long-running tests
  _tenantDomainCache: tenantDomainCache,
};
