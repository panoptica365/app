/**
 * Panoptica365 — Delegated PowerShell runner for Microsoft Teams admin writers.
 *
 * Uses the operator's delegated access tokens (from oauth-delegated.js) to
 * run Connect-MicrosoftTeams in a PowerShell child process via the
 * `-AccessTokens` parameter, then executes a Set-Cs* cmdlet against a
 * customer tenant.
 *
 * Existence rationale: Microsoft Teams admin Set-Cs* cmdlets don't honor
 * cert-based app-only SP authentication on customer tenants accessed via
 * GDAP — verified May 2, 2026. This module is the workaround: per-Apply
 * we acquire fresh tenant-scoped tokens via the operator's stored refresh
 * token, then hand them to Connect-MicrosoftTeams.
 *
 * Symmetry with pwsh-runner.js: same JSON-output protocol, same
 * success-suffix wrapper, same error classification. Caller-facing API
 * mirrors runTeamsSetCmdlet but takes the operator's session instead of
 * just a tenantAzureId.
 */

'use strict';

const { spawn } = require('child_process');
const config = require('../../../config/default');
const oauthDelegated = require('./oauth-delegated');
const { PwshError } = require('./pwsh-runner');

const PWSH_WRITE_TIMEOUT_MS = 90000;  // 90s — delegated path adds token-acquisition latency
const SUCCESS_JSON_SUFFIX = '; @{ ok = $true } | ConvertTo-Json -Compress';

/**
 * Run a Set-Cs* cmdlet against a customer tenant using the operator's
 * delegated tokens. Acquires fresh tenant-scoped tokens via the refresh
 * token in req.session, then spawns pwsh with Connect-MicrosoftTeams
 * -AccessTokens.
 *
 * @param {Object} req                 Express request — must have req.session.teamsDelegated
 * @param {string} customerTenantId    Azure AD GUID of the target customer tenant
 * @param {string} setExpression       The Set-Cs* cmdlet expression (no surrounding semicolons)
 * @param {Object} [options]
 * @param {number} [options.timeoutMs] Override the default 90s timeout
 * @returns {Promise<Object>}          The parsed JSON output from pwsh ({ ok: true } on success)
 * @throws {PwshError}                 With code in { PWSH_AUTH, PWSH_TENANT_PERMS, PWSH_TIMEOUT, PWSH_PARSE, PWSH_CMDLET }
 */
async function runDelegatedTeamsSetCmdlet(req, customerTenantId, setExpression, options = {}) {
  if (!req || !req.session || !req.session.teamsDelegated || !req.session.teamsDelegated.refreshToken) {
    throw new PwshError(
      'PWSH_AUTH',
      'Operator has not authenticated for Teams admin (delegated). Sign in first via /auth/teams-delegated/login.'
    );
  }
  if (!customerTenantId) {
    throw new PwshError('PWSH_CMDLET', 'runDelegatedTeamsSetCmdlet: customerTenantId is required');
  }
  if (!setExpression || typeof setExpression !== 'string') {
    throw new PwshError('PWSH_CMDLET', 'runDelegatedTeamsSetCmdlet: setExpression must be a non-empty string');
  }

  // Step 1: acquire fresh tenant-scoped tokens via the refresh token.
  // Exchange may rotate the refresh token; persist whatever comes back.
  let tokens;
  try {
    tokens = await oauthDelegated.getTeamsAccessTokensForTenant(
      req.session.teamsDelegated.refreshToken,
      customerTenantId
    );
  } catch (e) {
    // Diagnostic logging — pm2 logs need this to debug AADSTS failures.
    // Without it, the error is invisible until the operator screenshots the
    // modal. Common causes: refresh token expired (90d), Microsoft consent
    // gap for the requested resource, GDAP-elevated tokens not honored by
    // the target API.
    console.error(`[TeamsDelegatedRunner] Per-tenant token acquisition failed for tenant ${customerTenantId}:`, e.message);
    throw new PwshError(
      'PWSH_AUTH',
      `Failed to acquire delegated Teams tokens for tenant ${customerTenantId}: ${e.message}. Operator may need to re-authenticate.`
    );
  }
  console.log(`[TeamsDelegatedRunner] Acquired delegated Teams tokens for tenant ${customerTenantId} (graph + teams admin)`);

  // Persist any rotated refresh token back into the session.
  if (tokens.refreshToken && tokens.refreshToken !== req.session.teamsDelegated.refreshToken) {
    req.session.teamsDelegated.refreshToken = tokens.refreshToken;
    req.session.teamsDelegated.lastRefreshedAtMs = Date.now();
    // Fire-and-forget save — if it fails, the next acquisition will use the
    // older token (still valid until expiry, just less fresh).
    if (typeof req.session.save === 'function') {
      req.session.save(() => {});
    }
  }

  // Step 2: spawn pwsh with Connect-MicrosoftTeams -AccessTokens.
  // ORDER MATTERS: Microsoft Teams module expects [graphToken, teamsToken].
  // Tokens are passed via stdin to avoid them appearing in process args
  // (visible in `ps`). The script reads them from $env or via parameters.
  //
  // Approach: pass tokens via environment variables. Child env is private
  // to the spawned process — not visible in `ps`. Cleaner than building
  // long script strings with tokens embedded.
  const timeoutMs = options.timeoutMs || PWSH_WRITE_TIMEOUT_MS;

  const script = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$InformationPreference = 'SilentlyContinue'
$WarningPreference = 'SilentlyContinue'
try {
  $graphToken = $env:PANOPTICA_GRAPH_TOKEN
  $teamsToken = $env:PANOPTICA_TEAMS_TOKEN
  if (-not $graphToken -or -not $teamsToken) {
    throw "Tokens not provided via env"
  }
  Import-Module MicrosoftTeams -ErrorAction Stop
  Connect-MicrosoftTeams -AccessTokens @($graphToken, $teamsToken) -ErrorAction Stop | Out-Null
  try {
    ${setExpression}${SUCCESS_JSON_SUFFIX}
  } finally {
    Disconnect-MicrosoftTeams -ErrorAction SilentlyContinue | Out-Null
  }
} catch {
  @{
    __error__ = $_.Exception.Message
    __category__ = $_.CategoryInfo.Category.ToString()
  } | ConvertTo-Json -Compress
  exit 1
}
`;

  return new Promise((resolve, reject) => {
    const child = spawn(config.pwsh.binary, [
      '-NoProfile',
      '-NonInteractive',
      '-Command', script,
    ], {
      timeout: timeoutMs,
      env: {
        ...process.env,
        PANOPTICA_GRAPH_TOKEN: tokens.graphAccessToken,
        PANOPTICA_TEAMS_TOKEN: tokens.teamsAccessToken,
      },
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });

    child.on('error', (err) => {
      reject(new PwshError('PWSH_CMDLET', `spawn failed: ${err.message}`, err.message));
    });

    child.on('close', (code, signal) => {
      if (signal === 'SIGTERM' || code === null) {
        return reject(new PwshError('PWSH_TIMEOUT', `pwsh timed out after ${timeoutMs}ms`, stderr.slice(0, 500)));
      }
      const trimmed = stdout.trim();
      if (!trimmed) {
        return reject(new PwshError('PWSH_PARSE', 'pwsh produced empty stdout', stderr.slice(0, 500)));
      }
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
      if (parsed && typeof parsed === 'object' && parsed.__error__) {
        // Classify: tokens-still-rejected (rare, possibly upstream Microsoft
        // change) → PWSH_AUTH so the UI knows to prompt re-sign-in.
        // Otherwise PWSH_CMDLET so the operator sees the actual cmdlet error.
        const msg = String(parsed.__error__ || '');
        const isAuth = /unauthor|forbidden|access.denied|invalid.token/i.test(msg);
        console.error(`[TeamsDelegatedRunner] Cmdlet failed for tenant ${customerTenantId} (classified as ${isAuth ? 'PWSH_AUTH' : 'PWSH_CMDLET'}):`, msg);
        if (stderr) console.error(`[TeamsDelegatedRunner] stderr:`, stderr.slice(0, 1000));
        return reject(new PwshError(
          isAuth ? 'PWSH_AUTH' : 'PWSH_CMDLET',
          parsed.__error__,
          parsed.__category__ || null
        ));
      }
      console.log(`[TeamsDelegatedRunner] Cmdlet succeeded for tenant ${customerTenantId}`);
      resolve(parsed);
    });
  });
}

module.exports = {
  runDelegatedTeamsSetCmdlet,
};
