/**
 * Panoptica — Microsoft Graph API Module
 * Resilient Graph API caller with retry, rate-limit handling, and health tracking.
 */

const config = require('../config/default');
const auth = require('./auth');
const db = require('./db/database');

/**
 * Make a resilient Graph API call for a specific tenant.
 * Handles: 401 (re-auth), 429 (rate limit backoff), 404, 5xx (retry).
 */
async function callGraph(tenantId, endpoint, options = {}) {
  const {
    version = 'v1.0',
    method = 'GET',
    body = null,
    retries = config.graph.retryAttempts,
    silent = false,       // suppress logging/health updates for expected per-item 403/404
  } = options;

  const baseUrl = version === 'beta' ? config.graph.betaUrl : config.graph.baseUrl;
  const url = endpoint.startsWith('http') ? endpoint : `${baseUrl}${endpoint}`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const token = await auth.acquireTokenForTenant(tenantId);

      const fetchOptions = {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      };
      if (body) fetchOptions.body = JSON.stringify(body);

      const response = await fetch(url, fetchOptions);

      // Rate limited — back off and retry
      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('Retry-After') || '5', 10);
        console.warn(`[Graph] 429 rate limited on ${endpoint} — waiting ${retryAfter}s (attempt ${attempt}/${retries})`);
        await updateApiHealth(tenantId, endpoint, 'degraded', `Rate limited (429)`);
        await sleep(retryAfter * 1000);
        continue;
      }

      // Auth failure — token may have expired, one retry
      if (response.status === 401 || response.status === 403) {
        const errText = await response.text();
        if (silent) {
          throw new GraphError(response.status, errText, endpoint);
        }
        if (response.status === 403) {
          console.log(`[Graph] 403 Forbidden on ${endpoint.split('?')[0]}`);
        } else {
          console.error(`[Graph] ${response.status} on ${endpoint}: ${errText}`);
        }
        await updateApiHealth(tenantId, endpoint, 'degraded', `Auth error (${response.status})`);
        if (attempt < retries) {
          await sleep(config.graph.retryDelayMs);
          continue;
        }
        throw new GraphError(response.status, `Auth error: ${errText}`, endpoint);
      }

      // Not found — endpoint may be deprecated
      if (response.status === 404) {
        const errText = await response.text();
        if (!silent) {
          console.error(`[Graph] 404 on ${endpoint}: ${errText}`);
          await updateApiHealth(tenantId, endpoint, 'broken', `Not found (404)`);
        }
        throw new GraphError(404, `Endpoint not found: ${endpoint}`, endpoint);
      }

      // Client error (400, 405, 409, etc.) — not retryable
      if (response.status >= 400 && response.status < 500) {
        const errText = await response.text();
        if (!silent) {
          console.error(`[Graph] ${response.status} on ${endpoint}: ${errText}`);
        }
        throw new GraphError(response.status, errText, endpoint);
      }

      // Server error — retry
      if (response.status >= 500) {
        const errText = await response.text();
        console.error(`[Graph] ${response.status} on ${endpoint} (attempt ${attempt}/${retries}): ${errText}`);
        if (attempt < retries) {
          await sleep(config.graph.retryDelayMs * attempt);
          continue;
        }
        await updateApiHealth(tenantId, endpoint, 'broken', `Server error (${response.status})`);
        throw new GraphError(response.status, errText, endpoint);
      }

      // Success
      if (response.status === 204) {
        await updateApiHealth(tenantId, endpoint, 'healthy', null);
        return null;
      }

      // Graph report endpoints may still return CSV despite $format=application/json.
      // ALSO: some Graph endpoints (notably DELETE against /deviceManagement/intents
      // and a few others) return 200 OK with an empty body instead of 204. A naive
      // response.json() on an empty body throws "Unexpected end of JSON input",
      // which previously surfaced as a bogus "DELETE failed" audit row while the
      // tenant-side delete had actually succeeded. Always read as text first so
      // we can distinguish empty from JSON; parse only when non-empty.
      const contentType = response.headers.get('content-type') || '';
      const rawText = await response.text();

      let data;
      if (rawText.length === 0) {
        // Empty body on a 2xx = "success, nothing to return" — same semantics as 204.
        data = null;
      } else if (contentType.includes('application/json') || contentType === '') {
        try {
          data = JSON.parse(rawText);
        } catch (parseErr) {
          // Non-JSON body on a JSON-ish content type. Capture a preview for
          // diagnostics rather than throwing an opaque "Unexpected end of JSON".
          console.warn(`[Graph] Non-JSON payload on ${endpoint} (content-type=${contentType || 'absent'}, len=${rawText.length}): ${rawText.substring(0, 200)}`);
          data = { _raw: rawText };
        }
      } else if (contentType.includes('text/')) {
        // CSV or other text — return as raw for caller to handle
        console.warn(`[Graph] Non-JSON response for ${endpoint} (${contentType}), length=${rawText.length}`);
        data = { _csv: rawText };
      } else {
        // Unknown content type with a body — expose it rather than silently erroring
        console.warn(`[Graph] Unhandled content-type on ${endpoint}: ${contentType} (len=${rawText.length})`);
        data = { _raw: rawText };
      }

      await updateApiHealth(tenantId, endpoint, 'healthy', null);
      return data;

    } catch (err) {
      if (err instanceof GraphError) throw err;

      // Network or unexpected error
      console.error(`[Graph] Error on ${endpoint} (attempt ${attempt}/${retries}):`, err.message);
      if (attempt === retries) {
        await updateApiHealth(tenantId, endpoint, 'broken', err.message);
        throw new GraphError(0, err.message, endpoint);
      }
      await sleep(config.graph.retryDelayMs * attempt);
    }
  }
}

/**
 * Fetch all pages from a paginated Graph API response.
 */
async function callGraphPaged(tenantId, endpoint, options = {}) {
  const allValues = [];
  let url = endpoint;
  let pageCount = 0;
  const maxPages = options.maxPages || 10;

  while (url && pageCount < maxPages) {
    const data = await callGraph(tenantId, url, options);
    if (data && data.value) {
      allValues.push(...data.value);
    }
    url = data?.['@odata.nextLink'] || null;
    pageCount++;
  }

  return allValues;
}

// ─── Secure Score ───

/**
 * Fetch the latest Secure Score for a tenant.
 * Returns { currentScore, maxScore, percentage, date } or null.
 */
async function getSecureScore(tenantId) {
  try {
    const data = await callGraph(tenantId, '/security/secureScores?$top=1');
    if (!data?.value?.length) return null;

    const score = data.value[0];
    return {
      currentScore: score.currentScore,
      maxScore: score.maxScore,
      percentage: score.maxScore > 0
        ? parseFloat(((score.currentScore / score.maxScore) * 100).toFixed(2))
        : 0,
      date: score.createdDateTime,
      controlScores: score.controlScores || [],
      // Microsoft's comparison averages — array of { basis, averageScore }.
      // basis values: 'AllTenants', 'TotalSeats', 'IndustryTypes'.
      // averageScore is ALREADY a percentage (0-100). Microsoft's schema
      // docs are ambiguous and imply it's a raw score, but empirically it
      // matches the Defender console's displayed "%" value exactly. Do not
      // divide by maxScore before displaying — that would double-normalize.
      // Verified Apr 20 2026: Thymox tenant averageScore ≈ 46.66 matched
      // Defender's "Organizations of a similar size: 46.66%".
      // 'IndustryTypes' is often null for small tenants Microsoft hasn't
      // classified; 'TotalSeats' is reliably populated.
      averageComparativeScores: score.averageComparativeScores || [],
    };
  } catch (err) {
    console.error(`[Graph] Failed to fetch Secure Score for tenant ${tenantId}:`, err.message);
    return null;
  }
}

// ─── API Health Tracking ───

/**
 * Update the api_health table for an endpoint.
 */
async function updateApiHealth(tenantDbId, endpoint, status, errorMsg) {
  // tenantId here is the Azure tenant GUID — we resolve to DB id via subquery
  try {
    // Truncate endpoint to just the path (no query params) for grouping
    const cleanEndpoint = endpoint.split('?')[0].substring(0, 512);

    await db.query(
      `INSERT INTO api_health (tenant_id, endpoint, status, last_error,
        last_success_at, last_failure_at, failure_count)
       SELECT t.id, ?, ?, ?,
        IF(? = 'healthy', NOW(), NULL),
        IF(? != 'healthy', NOW(), NULL),
        IF(? != 'healthy', 1, 0)
       FROM tenants t WHERE t.tenant_id = ?
       ON DUPLICATE KEY UPDATE
        status = VALUES(status),
        last_error = IF(VALUES(status) != 'healthy', VALUES(last_error), last_error),
        last_success_at = IF(VALUES(status) = 'healthy', NOW(), last_success_at),
        last_failure_at = IF(VALUES(status) != 'healthy', NOW(), last_failure_at),
        failure_count = IF(VALUES(status) = 'healthy', 0, failure_count + 1)`,
      [cleanEndpoint, status, errorMsg, status, status, status, tenantDbId]
    );
  } catch (dbErr) {
    // Don't let health tracking failures break the main flow
    console.error('[Graph] Failed to update api_health:', dbErr.message);
  }
}

// ─── Utilities ───

class GraphError extends Error {
  constructor(statusCode, message, endpoint) {
    super(message);
    this.name = 'GraphError';
    this.statusCode = statusCode;
    this.endpoint = endpoint;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  callGraph,
  callGraphPaged,
  getSecureScore,
  GraphError,
};
