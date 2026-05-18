/**
 * Panoptica365 — Security Settings Writer Dispatcher (Phase B v2)
 *
 * Single entry point that routes Apply requests to the right writer module
 * based on writer.strategy in the registry. api-security.js calls only this
 * dispatcher; the per-strategy modules (graph-writers, pwsh-writers) are
 * implementation details.
 *
 * Routing:
 *   strategy = 'graph'                                      → graph-writers
 *   strategy = 'powershell_exo'   | 'powershell_ipps'
 *            | 'powershell_teams'                           → pwsh-writers
 *   strategy = 'powershell_spo'                             → pwsh-writers (NO_WRITER stub)
 *
 * Errors are unified — both writer modules throw WriterError, and this
 * dispatcher rethrows without translation. The api-security.js layer maps
 * WriterError.code → HTTP status.
 */

'use strict';

const { byId } = require('./registry');
const graphWriters = require('./graph-writers');
const pwshWriters  = require('./pwsh-writers');
const pwshDelegated = require('./pwsh-delegated');
const { WriterError } = graphWriters;

/**
 * Dispatch an Apply call to the appropriate writer module.
 *
 * @param {string} tenantAzureId  Azure AD GUID (tenants.tenant_id)
 * @param {string} settingId      e.g. 'CMP-01', 'ENT-09'
 * @param {*}      chosenValue    The UI-selected value (string|bool|array|{option,input})
 * @param {object} [options]      Apr 26 v3 — optional context for writers that
 *                                need pre-write tenant state (e.g. ENT-06's
 *                                prepareGraphCall needs to know if the
 *                                Password Rule Settings template exists to
 *                                decide POST vs PATCH).
 * @param {object} [options.currentValue]  Current tenant state from the reader
 * @param {object} [options.req]           Express request — required for
 *                                         delegated_teams strategy (operator
 *                                         session carries the refresh token).
 * @param {function} [options.onProgress]  May 6, 2026 — called with parsed
 *                                         {current,total,message} for each
 *                                         [PANOPTICA-PROGRESS] line emitted
 *                                         by the underlying PowerShell. Used
 *                                         by the async-Apply worker to write
 *                                         progress into apply_jobs row.
 * @param {function} [options.handleProcess]  Receives the spawned ChildProcess
 *                                            so the caller can attach extra
 *                                            timeouts / kill the process out
 *                                            of band (worker uses this for
 *                                            the 30-min hard cap).
 * @returns {Promise<object>}     Writer module's return value.
 * @throws {WriterError}
 */
async function applySetting(tenantAzureId, settingId, chosenValue, options = {}) {
  const setting = byId(settingId);
  if (!setting) {
    throw new WriterError('NOT_FOUND', `Unknown setting ${settingId}`, settingId);
  }
  if (!setting.writer) {
    throw new WriterError('NO_WRITER', `Setting ${settingId} has no writer (read-only in registry)`, settingId);
  }

  // Apr 27 — audit-only writers (CMP-02 DLP) intentionally have no Apply path.
  // The api-security.js Apply/Remediate handlers reject these with 405 BEFORE
  // reaching the dispatcher, but defend in depth in case a future code path
  // reaches here directly (e.g. an internal reconciliation job).
  if (setting.writer.audit_only === true) {
    throw new WriterError('NO_WRITER', `Setting ${settingId} is audit-only — no write path`, settingId);
  }

  const strategy = setting.writer.strategy;
  switch (strategy) {
    case 'graph':
      return graphWriters.applySetting(tenantAzureId, settingId, chosenValue, options);
    case 'powershell_exo':
    case 'powershell_ipps':
    case 'powershell_teams':
    case 'powershell_spo':  // pwsh-writers throws NO_WRITER — not yet built
      return pwshWriters.applySetting(tenantAzureId, settingId, chosenValue, options);
    case 'delegated_teams':
      // Apr 28, 2026 — Teams admin write cmdlets that don't honor cert-based
      // app-only SP auth on customer tenants. Run via the operator's
      // delegated session (browser sign-in flow). Requires options.req with
      // an active req.session.teamsDelegated. The api-security.js layer
      // handles the 401-w-auth-url response when the session lacks tokens.
      return applyDelegatedTeams(tenantAzureId, settingId, chosenValue, options);
    case 'audit_only':       // belt-and-suspenders, see audit_only check above
      throw new WriterError('NO_WRITER', `audit_only writers have no Apply path (${settingId})`, settingId);
    default:
      throw new WriterError('NO_WRITER', `Unknown writer.strategy=${strategy} for ${settingId}`, settingId);
  }
}

/**
 * Apply a delegated_teams writer using the operator's interactive session.
 * Mirrors pwsh-writers.applySetting in shape (validates the chosen value,
 * builds the cmdlet via the writer's buildPwshCmdlet, dispatches to the
 * delegated runner) but the runner takes the operator's req (for session
 * tokens) instead of just the tenant id.
 */
async function applyDelegatedTeams(tenantAzureId, settingId, chosenValue, options) {
  const setting = byId(settingId);
  const w = setting.writer;
  if (!options || !options.req) {
    throw new WriterError(
      'NO_WRITER',
      `delegated_teams strategy requires options.req (operator session). Setting: ${settingId}`,
      settingId
    );
  }
  if (typeof w.buildPwshCmdlet !== 'function') {
    throw new WriterError(
      'NO_WRITER',
      `delegated_teams writer ${settingId} requires buildPwshCmdlet`,
      settingId
    );
  }
  // Reuse the same chosen-value validation as the standard pwsh path.
  // pwsh-writers exports the validator as _internal — depend on it here so
  // both paths can never disagree about what's a valid chosen value.
  if (pwshWriters._internal && typeof pwshWriters._internal.validateChosenValue === 'function') {
    pwshWriters._internal.validateChosenValue(setting, chosenValue);
  }

  let cmdletExpression;
  try {
    cmdletExpression = w.buildPwshCmdlet(chosenValue);
  } catch (e) {
    throw new WriterError('BAD_VALUE', `buildPwshCmdlet threw: ${e.message}`, settingId);
  }
  if (typeof cmdletExpression !== 'string' || !cmdletExpression.trim()) {
    throw new WriterError('BAD_VALUE', `buildPwshCmdlet returned non-string`, settingId);
  }

  const callOpts = (typeof w.timeoutMs === 'number' && w.timeoutMs > 0)
    ? { timeoutMs: w.timeoutMs }
    : {};

  try {
    await pwshDelegated.runDelegatedTeamsSetCmdlet(
      options.req,
      tenantAzureId,
      cmdletExpression,
      callOpts
    );
  } catch (e) {
    if (e && e.name === 'PwshError') {
      // Map PwshError taxonomy to WriterError taxonomy. PWSH_AUTH on the
      // delegated path means "operator needs to (re-)sign in" — surface as
      // a distinct DELEGATED_AUTH_REQUIRED code so the API layer can return
      // 401 with the auth URL instead of a generic 403.
      if (e.code === 'PWSH_AUTH') {
        throw new WriterError('DELEGATED_AUTH_REQUIRED', e.message, settingId);
      }
      const codeMap = {
        PWSH_TENANT_PERMS: 'PERMS',
        PWSH_NOT_CONFIGURED: 'PERMS',
        PWSH_TIMEOUT: 'NETWORK',
        PWSH_PARSE: 'UNKNOWN',
        PWSH_CMDLET: 'BAD_REQUEST',
      };
      throw new WriterError(
        codeMap[e.code] || 'UNKNOWN',
        `delegated_teams for ${settingId} failed (${e.code}): ${e.message}`,
        settingId
      );
    }
    throw new WriterError('UNKNOWN', `Unexpected delegated_teams error: ${e.message}`, settingId);
  }

  return { cmdlet: cmdletExpression };
}

module.exports = {
  applySetting,
  WriterError,
};
