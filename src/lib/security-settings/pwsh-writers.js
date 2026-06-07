/**
 * Panoptica365 — PowerShell Writers for Security Settings (Phase B v2)
 *
 * Symmetric to graph-writers.js but for the EXO / IPPS / Teams write side.
 *
 * Phase B v2 ships the canary: CMP-01 (Enable Unified Audit Log).
 * The dispatcher is generic — adding a new pwsh-writable setting is a
 * registry entry only (writer.strategy = 'powershell_exo' | 'powershell_teams'
 * + writer.buildPwshCmdlet returning the Set-* expression text).
 *
 * Conventions (mirror graph-writers.js):
 *  - tenantAzureId is the Azure AD GUID (tenants.tenant_id), NOT the INT id.
 *  - Throws WriterError on failure with a structured `code` that the API
 *    layer maps to an HTTP status. Never returns a "soft fail" object.
 *  - Verification of write outcome is the caller's responsibility (api-security.js
 *    fires a post-write verification poll using the corresponding reader).
 */

'use strict';

const { byId } = require('./registry');
const pwshRunner = require('./pwsh-runner');
const { WriterError } = require('./graph-writers');  // shared error type

/**
 * Map a PwshError code → WriterError code. The pwsh runner uses a different
 * taxonomy (PWSH_AUTH, PWSH_TENANT_PERMS, PWSH_TIMEOUT, PWSH_NOT_CONFIGURED,
 * PWSH_PARSE, PWSH_CMDLET); collapse it onto the shared WriterError codes
 * so api-security.js can map a single error taxonomy to HTTP status.
 */
function mapPwshErrorToWriterCode(pwshCode) {
  switch (pwshCode) {
    case 'PWSH_AUTH':           return 'PERMS';
    case 'PWSH_TENANT_PERMS':   return 'PERMS';
    case 'PWSH_NOT_CONFIGURED': return 'PERMS';     // operator-side config gap; manifests as no-auth
    case 'PWSH_TIMEOUT':        return 'NETWORK';
    case 'PWSH_PARSE':          return 'UNKNOWN';   // shouldn't happen with the success-JSON suffix; surface so it's investigable
    case 'PWSH_CMDLET':         return 'BAD_REQUEST';
    default:                    return 'UNKNOWN';
  }
}

/**
 * Validate that the chosen value matches one of the registry's
 * `options[].value` entries. Same canonical-equality rule as graph-writers.
 *
 * Apr 26 v3: chosen value may be a rich {option, input} object for settings
 * that carry operator-typed input (TEA-02 allowlist, EXO-05 recipients).
 * Extract just the option for validation; input is operator data validated
 * client-side.
 */
function validateChosenValue(setting, chosenValue) {
  const opts = setting.writer && Array.isArray(setting.writer.options) ? setting.writer.options : null;
  if (!opts) return;
  const optionForCheck = (chosenValue && typeof chosenValue === 'object' && !Array.isArray(chosenValue) && 'option' in chosenValue)
    ? chosenValue.option
    : chosenValue;
  const optionJson = JSON.stringify(optionForCheck);
  const ok = opts.some(o => JSON.stringify(o.value) === optionJson);
  if (!ok) {
    const sample = opts.map(o => JSON.stringify(o.value)).join(', ');
    throw new WriterError(
      'BAD_VALUE',
      `Chosen option ${JSON.stringify(optionForCheck)} is not in the registry's allowed options [${sample}]`,
      setting.setting_id
    );
  }
}

/**
 * Apply a pwsh-writable security setting. Looks up the writer in the
 * registry, builds the Set-* cmdlet expression via writer.buildPwshCmdlet,
 * and dispatches to runExoSetCmdlet / runIppsSetCmdlet / runTeamsSetCmdlet
 * based on writer.strategy.
 *
 * @param {string} tenantAzureId  Azure AD GUID (tenants.tenant_id)
 * @param {string} settingId      e.g. 'CMP-01'
 * @param {*}      chosenValue    The UI-selected value
 * @returns {Promise<{cmdlet: string}>}  The cmdlet text that was sent (for audit).
 * @throws  WriterError on any failure path.
 */
async function applySetting(tenantAzureId, settingId, chosenValue, options = {}) {
  const setting = byId(settingId);
  if (!setting) {
    throw new WriterError('NOT_FOUND', `Unknown setting ${settingId}`, settingId);
  }
  if (!setting.writer) {
    throw new WriterError('NO_WRITER', `Setting ${settingId} has no writer`, settingId);
  }
  const w = setting.writer;
  if (typeof w.buildPwshCmdlet !== 'function') {
    throw new WriterError(
      'NO_WRITER',
      `Setting ${settingId} has writer.strategy=${w.strategy} but no buildPwshCmdlet function`,
      settingId
    );
  }

  validateChosenValue(setting, chosenValue);

  let cmdletExpression;
  try {
    cmdletExpression = w.buildPwshCmdlet(chosenValue);
  } catch (e) {
    throw new WriterError('BAD_VALUE', `buildPwshCmdlet threw: ${e.message}`, settingId);
  }
  if (typeof cmdletExpression !== 'string' || !cmdletExpression.trim()) {
    throw new WriterError('BAD_VALUE', `buildPwshCmdlet returned non-string`, settingId);
  }

  // Strategy-based dispatch. EXO and IPPS use different Connect-* paths
  // even when the cmdlet looks similar; the registry's writer.strategy is
  // the source of truth.
  let runner;
  switch (w.strategy) {
    case 'powershell_exo':   runner = pwshRunner.runExoSetCmdlet; break;
    case 'powershell_ipps':  runner = pwshRunner.runIppsSetCmdlet; break;
    case 'powershell_teams': runner = pwshRunner.runTeamsSetCmdlet; break;
    case 'powershell_spo':   throw new WriterError('NO_WRITER', 'SPO PowerShell writer not yet built', settingId);
    default: throw new WriterError('NO_WRITER', `Unknown writer.strategy=${w.strategy} for ${settingId}`, settingId);
  }

  // Apr 26 v4 — per-writer timeout override. Some writers iterate per-object
  // (EXO-03 walks every mailbox) and need much longer than the default 60s.
  // Writers without an override get the runner's default.
  const callOpts = (typeof w.timeoutMs === 'number' && w.timeoutMs > 0)
    ? { timeoutMs: w.timeoutMs }
    : {};
  // May 6, 2026 — async-Apply progress streaming. When called via the
  // background worker, options.onProgress is set; pwsh-runner forwards
  // [PANOPTICA-PROGRESS] markers from the script's stdout to that callback
  // for real-time DB updates. options.handleProcess gives the worker the
  // spawned ChildProcess for the 30-min hard-cap kill timer. Both are
  // no-ops for synchronous callers (graph-writers ignores them entirely;
  // pwsh-runner's runPwsh just doesn't intercept any markers).
  if (typeof options.onProgress === 'function') callOpts.onProgress = options.onProgress;
  if (typeof options.handleProcess === 'function') callOpts.handleProcess = options.handleProcess;

  try {
    await runner(tenantAzureId, cmdletExpression, callOpts);
  } catch (e) {
    if (e && e.name === 'PwshError') {
      throw new WriterError(
        mapPwshErrorToWriterCode(e.code),
        `pwsh ${w.strategy} for ${settingId} failed (${e.code}): ${e.message}`,
        settingId
      );
    }
    throw new WriterError('UNKNOWN', `Unexpected pwsh error: ${e.message}`, settingId);
  }

  return { cmdlet: cmdletExpression };
}

module.exports = {
  applySetting,
  WriterError,
  // Exported for unit tests
  _internal: { validateChosenValue, mapPwshErrorToWriterCode },
};
