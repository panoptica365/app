/**
 * Panoptica365 — Graph Writers for Security Settings (Phase B v1)
 *
 * Symmetric to graph-readers.js but for the WRITE side of Apply.
 *
 * Phase B v1 ships writers for three Tier-1 settings (all single-PATCH,
 * single-endpoint, single-field). The dispatcher table at the bottom is
 * additive — adding a fourth writer means one entry plus one function;
 * no caller change required.
 *
 * Conventions (mirror graph-readers.js):
 *  - tenantAzureId is the Azure AD GUID (tenants.tenant_id), NOT the INT id.
 *    Passing the INT yields AADSTS90002.
 *  - Beta/v1.0 selection via options.version, never via path prefix.
 *  - Throws WriterError on failure with a structured `code` that the API
 *    layer maps to an HTTP status. Never returns a "soft fail" object —
 *    Apply must either succeed or throw, never return partial.
 *
 * Verification convention: applySetting() does NOT re-read the value
 * post-PATCH. The caller (api-security.js) calls the corresponding reader
 * separately for the verification poll. Keeping write/read split lets the
 * verification poll go through the exact same code path the slow-tier
 * polling cycle uses, so a Match after Apply produces the identical
 * current_value shape that drift detection later compares against.
 */

'use strict';

const graph = require('../../graph');
const { byId } = require('./registry');

class WriterError extends Error {
  /**
   * @param {string} code  One of: PERMS, NOT_FOUND, BAD_REQUEST, CONFLICT,
   *                       RATE_LIMITED, NETWORK, NO_WRITER, BAD_VALUE, UNKNOWN
   * @param {string} message
   * @param {string} [settingId]
   * @param {number} [statusCode]  Underlying HTTP status if applicable
   */
  constructor(code, message, settingId, statusCode) {
    super(message);
    this.name = 'WriterError';
    this.code = code;
    this.settingId = settingId || null;
    this.statusCode = statusCode || null;
  }
}

/**
 * Map a GraphError statusCode to a WriterError code. Centralised so the
 * per-setting writers don't each re-implement the mapping.
 */
function mapGraphErrorToWriterCode(statusCode) {
  switch (statusCode) {
    case 401:
    case 403: return 'PERMS';
    case 404: return 'NOT_FOUND';
    case 400: return 'BAD_REQUEST';
    case 409: return 'CONFLICT';
    case 429: return 'RATE_LIMITED';
    case 0:   return 'NETWORK';
    default:  return statusCode >= 500 ? 'NETWORK' : 'UNKNOWN';
  }
}

/**
 * Validate that the chosen value matches one of the registry's `options[].value`
 * entries. Defends against the API layer being asked to write a value the
 * registry says isn't valid for this setting.
 *
 * Apr 26 v3: chosen value may be a rich {option, input} object for settings
 * that carry operator-typed input alongside the option choice (TEA-02
 * allowlist, EXO-05 recipients, ENT-06 banned words). Extract just the
 * option identifier for allowlist comparison; the input is operator-supplied
 * data and is validated client-side.
 */
function validateChosenValue(setting, chosenValue) {
  const opts = setting.writer && Array.isArray(setting.writer.options) ? setting.writer.options : null;
  if (!opts) return; // Writer doesn't enumerate options — caller responsible.
  const optionForCheck = (chosenValue && typeof chosenValue === 'object' && !Array.isArray(chosenValue) && 'option' in chosenValue)
    ? chosenValue.option
    : chosenValue;
  const optionJson = canonical(optionForCheck);
  const ok = opts.some(o => canonical(o.value) === optionJson);
  if (!ok) {
    const sample = opts.map(o => JSON.stringify(o.value)).join(', ');
    throw new WriterError(
      'BAD_VALUE',
      `Chosen option ${JSON.stringify(optionForCheck)} is not in the registry's allowed options [${sample}]`,
      setting.setting_id
    );
  }
}

function canonical(v) {
  // For primitives, JSON.stringify is canonical. For arrays/objects we use
  // JSON.stringify directly — sufficient because all current writer values
  // are primitives or arrays of primitives. If a writer ever ships a value
  // with object keys whose order shouldn't matter, swap this for a sorted
  // stringify.
  return JSON.stringify(v);
}

/**
 * Apply a security setting. Looks up the writer in the registry, builds the
 * PATCH payload via writer.buildPayload(), executes the Graph call, and
 * returns the payload that was sent (for audit trail). Does NOT re-read.
 *
 * @param {string} tenantAzureId  Azure AD GUID (tenants.tenant_id)
 * @param {string} settingId      e.g. 'ENT-09'
 * @param {*}      chosenValue    The UI-selected value (string|boolean|object)
 * @returns {Promise<{payload: object}>}  The body sent to Graph.
 * @throws  WriterError on any failure path.
 */
async function applySetting(tenantAzureId, settingId, chosenValue, options = {}) {
  const setting = byId(settingId);
  if (!setting) {
    throw new WriterError('NOT_FOUND', `Unknown setting ${settingId}`, settingId);
  }
  if (!setting.writer) {
    throw new WriterError('NO_WRITER', `Setting ${settingId} has no writer (Phase A read-only)`, settingId);
  }
  const w = setting.writer;
  if (w.strategy !== 'graph') {
    throw new WriterError('NO_WRITER', `Setting ${settingId} writer.strategy=${w.strategy} not handled by graph-writers`, settingId);
  }

  validateChosenValue(setting, chosenValue);

  // Three writer-shapes supported, in order of generality:
  //
  //   1. prepareGraphCalls (plural) → returns array of {method, path, body, [graph_options]}
  //      Apr 26 v4 — for settings that need MULTIPLE Graph calls per Apply
  //      (notably ENT-01 SSPR, which PATCHes 3 separate auth-method
  //      configurations). Calls fire sequentially. If any fails, abort and
  //      report which one. Each call may return `null` to skip that step.
  //
  //   2. prepareGraphCall (singular) → returns {method, path, body} or null
  //      Apr 26 v3 — for settings with conditional method/path (e.g. ENT-06
  //      POST when template missing, PATCH when present). null means no-op.
  //
  //   3. Standard buildPayload + graph_path + graph_method → single PATCH/POST.
  //      Original v1 shape used by the simpler writers (ENT-09, SPO-*, etc).
  let calls = null;
  if (typeof w.prepareGraphCalls === 'function') {
    let result;
    try {
      result = w.prepareGraphCalls(chosenValue, options.currentValue || null);
    } catch (e) {
      throw new WriterError('BAD_VALUE', `prepareGraphCalls threw: ${e.message}`, settingId);
    }
    if (!Array.isArray(result)) {
      throw new WriterError('BAD_VALUE', `prepareGraphCalls must return an array`, settingId);
    }
    calls = result.filter(c => c !== null && c !== undefined);
    if (calls.length === 0) {
      return { payload: null, noop: true };
    }
  } else if (typeof w.prepareGraphCall === 'function') {
    let call;
    try {
      call = w.prepareGraphCall(chosenValue, options.currentValue || null);
    } catch (e) {
      throw new WriterError('BAD_VALUE', `prepareGraphCall threw: ${e.message}`, settingId);
    }
    if (call === null) {
      return { payload: null, noop: true };
    }
    if (!call || typeof call !== 'object' || !call.path || !call.method) {
      throw new WriterError('BAD_VALUE', `prepareGraphCall must return {method,path,body} or null`, settingId);
    }
    calls = [call];
  } else {
    let p;
    try {
      p = w.buildPayload(chosenValue);
    } catch (e) {
      throw new WriterError('BAD_VALUE', `buildPayload threw: ${e.message}`, settingId);
    }
    if (!p || typeof p !== 'object') {
      throw new WriterError('BAD_VALUE', `buildPayload returned non-object: ${typeof p}`, settingId);
    }
    calls = [{
      method: w.graph_method || 'PATCH',
      path: w.graph_path,
      body: p,
    }];
  }

  // Validate each call before firing so a malformed array element doesn't
  // get partway through (writes are not transactional — partial completion
  // is recoverable but messy).
  for (let i = 0; i < calls.length; i++) {
    const c = calls[i];
    if (!c || typeof c !== 'object' || !c.path || !c.method) {
      throw new WriterError('BAD_VALUE', `prepareGraphCalls[${i}] missing method/path`, settingId);
    }
  }

  // Sequential fire. If call N fails, abort. Calls 0..N-1 already landed —
  // report which one failed for operator-side recovery.
  const sentPayloads = [];
  for (let i = 0; i < calls.length; i++) {
    const c = calls[i];
    const callOpts = {
      method: c.method,
      body: c.body,
      ...(c.graph_options || w.graph_options || {}),
    };
    try {
      await graph.callGraph(tenantAzureId, c.path, callOpts);
      sentPayloads.push({ method: c.method, path: c.path, body: c.body });
    } catch (e) {
      const partialNote = i > 0 ? ` (call ${i + 1} of ${calls.length}; calls 1..${i} already succeeded)` : '';
      if (e && e.name === 'GraphError') {
        throw new WriterError(
          mapGraphErrorToWriterCode(e.statusCode),
          `Graph ${c.method} ${c.path} failed (${e.statusCode})${partialNote}: ${e.message}`,
          settingId,
          e.statusCode
        );
      }
      throw new WriterError('UNKNOWN', `Unexpected error on ${c.method} ${c.path}${partialNote}: ${e.message}`, settingId);
    }
  }

  // For backward compatibility: single-call writers expose `payload` (the body
  // sent). Multi-call writers expose `payloads` (array). Both keys present so
  // callers that destructure either work.
  return {
    payload: sentPayloads[0]?.body || null,
    payloads: sentPayloads,
  };
}

module.exports = {
  applySetting,
  WriterError,
  // Exported for unit tests
  _internal: { validateChosenValue, mapGraphErrorToWriterCode },
};
