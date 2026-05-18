/**
 * Panoptica365 — Office 365 Management Activity API Client
 *
 * Resilient HTTP client for the Office 365 Management Activity API,
 * mirroring the pattern in src/graph.js (retry, 429 backoff, structured
 * error type) but adapted for the Management API's conventions:
 *
 *   - Different resource: https://manage.office.com (not graph.microsoft.com)
 *   - Different auth scope: https://manage.office.com/.default
 *   - Different pagination: NextPageUri response header (not @odata.nextLink)
 *   - URL pattern: /api/v1.0/{tenantGuid}/activity/feed/...
 *
 * Used exclusively by src/ual-worker.js for UAL ingestion.
 *
 * Reference: https://learn.microsoft.com/en-us/office/office-365-management-api/office-365-management-activity-api-reference
 */

const auth = require('../auth');

const BASE_URL = 'https://manage.office.com/api/v1.0';

// Conservative defaults. Microsoft's documented limits are 60 req/min per
// tenant for the Management API, lower than Graph's. Build slack into our
// retry budget.
const DEFAULT_RETRIES = 4;
const DEFAULT_RETRY_DELAY_MS = 1000;

class ManagementApiError extends Error {
  constructor(statusCode, message, endpoint) {
    super(message);
    this.name = 'ManagementApiError';
    this.statusCode = statusCode;
    this.endpoint = endpoint;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Single Management API call with retry / backoff. Returns the parsed JSON
 * body, or null on 204. Throws ManagementApiError on terminal failures.
 *
 * @param {string} tenantGuid     Customer Entra tenant GUID (NOT Panoptica tenants.id)
 * @param {string} pathOrUrl      Path beginning with /, OR a fully-qualified URL
 *                                (the latter for following pagination URIs)
 * @param {object} [options]
 * @param {string} [options.method]   GET (default) | POST
 * @param {object} [options.body]     JSON body for POST
 * @param {object} [options.query]    Query parameters as a plain object
 * @param {number} [options.retries]  Override default retry count
 * @param {boolean} [options.silent]  Suppress 4xx logging when an error is expected
 * @returns {Promise<{ data: any, headers: Headers }>}
 */
async function callManagement(tenantGuid, pathOrUrl, options = {}) {
  const {
    method = 'GET',
    body = null,
    query = null,
    retries = DEFAULT_RETRIES,
    silent = false,
  } = options;

  if (!tenantGuid) {
    throw new ManagementApiError(0, 'tenantGuid required', pathOrUrl);
  }

  let url = pathOrUrl.startsWith('http') ? pathOrUrl : `${BASE_URL}/${tenantGuid}${pathOrUrl}`;

  if (query && typeof query === 'object') {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) sp.append(k, String(v));
    }
    const qs = sp.toString();
    if (qs) url += (url.includes('?') ? '&' : '?') + qs;
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const token = await auth.acquireManagementTokenForTenant(tenantGuid);

      const fetchOptions = {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      };
      if (body) fetchOptions.body = JSON.stringify(body);

      const response = await fetch(url, fetchOptions);

      // 429 — back off and retry per Retry-After
      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('Retry-After') || '5', 10);
        if (!silent) {
          console.warn(`[MgmtAPI] 429 on ${pathOrUrl} — waiting ${retryAfter}s (attempt ${attempt}/${retries})`);
        }
        await sleep(retryAfter * 1000);
        continue;
      }

      // 401/403 — auth issue. The token cache may have stale entries from a
      // previous session; one retry after a brief pause.
      if (response.status === 401 || response.status === 403) {
        const errText = await response.text();
        if (silent) {
          throw new ManagementApiError(response.status, errText, pathOrUrl);
        }
        if (attempt < retries) {
          console.warn(`[MgmtAPI] ${response.status} on ${pathOrUrl} (attempt ${attempt}/${retries}) — retrying after ${DEFAULT_RETRY_DELAY_MS}ms`);
          await sleep(DEFAULT_RETRY_DELAY_MS);
          continue;
        }
        console.error(`[MgmtAPI] ${response.status} on ${pathOrUrl}: ${errText}`);
        throw new ManagementApiError(response.status, errText, pathOrUrl);
      }

      // 404 — endpoint or resource doesn't exist. Not retryable.
      if (response.status === 404) {
        const errText = await response.text();
        if (!silent) console.warn(`[MgmtAPI] 404 on ${pathOrUrl}: ${errText}`);
        throw new ManagementApiError(404, errText, pathOrUrl);
      }

      // Other 4xx — not retryable.
      if (response.status >= 400 && response.status < 500) {
        const errText = await response.text();
        if (!silent) console.error(`[MgmtAPI] ${response.status} on ${pathOrUrl}: ${errText}`);
        throw new ManagementApiError(response.status, errText, pathOrUrl);
      }

      // 5xx — retryable
      if (response.status >= 500) {
        const errText = await response.text();
        console.warn(`[MgmtAPI] ${response.status} on ${pathOrUrl} (attempt ${attempt}/${retries}): ${errText}`);
        if (attempt < retries) {
          await sleep(DEFAULT_RETRY_DELAY_MS * attempt);
          continue;
        }
        throw new ManagementApiError(response.status, errText, pathOrUrl);
      }

      // 204 — no content
      if (response.status === 204) {
        return { data: null, headers: response.headers };
      }

      // 2xx with body — parse JSON
      const rawText = await response.text();
      let data = null;
      if (rawText.length > 0) {
        try {
          data = JSON.parse(rawText);
        } catch (parseErr) {
          console.warn(`[MgmtAPI] Non-JSON body on ${pathOrUrl} (len=${rawText.length}): ${rawText.substring(0, 200)}`);
          data = { _raw: rawText };
        }
      }
      return { data, headers: response.headers };
    } catch (err) {
      if (err instanceof ManagementApiError) throw err;
      console.error(`[MgmtAPI] Unexpected error on ${pathOrUrl} (attempt ${attempt}/${retries}):`, err.message);
      if (attempt === retries) {
        throw new ManagementApiError(0, err.message, pathOrUrl);
      }
      await sleep(DEFAULT_RETRY_DELAY_MS * attempt);
    }
  }

  // Defensive — should not reach here
  throw new ManagementApiError(0, 'retry budget exhausted', pathOrUrl);
}

/**
 * Follow NextPageUri pagination. Used for /subscriptions/content listings
 * which can span multiple pages when there's heavy event volume.
 *
 * Microsoft's pagination model: the response body is the array of items;
 * the next-page URL comes via the NextPageUri response header. Repeat until
 * absent.
 *
 * @returns {Promise<Array<any>>}  Concatenated items across all pages.
 */
async function callManagementPaged(tenantGuid, pathOrUrl, options = {}) {
  const all = [];
  let url = pathOrUrl;
  let firstCall = true;
  // Defensive page cap — UAL listings should not exceed this in practice;
  // hitting the cap means something pathological is happening.
  const MAX_PAGES = 200;
  let pages = 0;

  while (url && pages < MAX_PAGES) {
    const callOpts = firstCall ? options : { ...options, query: null };
    const result = await callManagement(tenantGuid, url, callOpts);
    firstCall = false;

    if (Array.isArray(result.data)) {
      all.push(...result.data);
    } else if (result.data) {
      // Defensive — non-array body. Wrap so caller still sees something.
      all.push(result.data);
    }

    const nextUri = result.headers.get('NextPageUri');
    if (!nextUri) break;
    url = nextUri;
    pages += 1;
  }

  if (pages >= MAX_PAGES) {
    console.warn(`[MgmtAPI] Hit MAX_PAGES (${MAX_PAGES}) on ${pathOrUrl} — pagination capped, may have missed events`);
  }

  return all;
}

// ──────────────────────────────────────────────────────────────────────
// Subscription lifecycle
// ──────────────────────────────────────────────────────────────────────

const CONTENT_TYPES = [
  'Audit.AzureActiveDirectory',
  'Audit.Exchange',
  'Audit.SharePoint',
  'Audit.General',
  'DLP.All',
];

/**
 * Start a subscription for a (tenant, contentType) pair.
 *
 * Microsoft's quirk: if the subscription already exists, this returns
 * 400 with a body indicating "subscription already enabled." We catch
 * that and treat it as success — the caller wanted the subscription
 * active and it is.
 *
 * @returns {Promise<{ already: boolean }>}
 */
async function startSubscription(tenantGuid, contentType) {
  try {
    await callManagement(tenantGuid, '/activity/feed/subscriptions/start', {
      method: 'POST',
      query: { contentType },
      silent: true, // we handle the "already started" 400 ourselves
    });
    return { already: false };
  } catch (err) {
    if (err instanceof ManagementApiError && err.statusCode === 400) {
      // Microsoft returns "AF20024: The subscription is already enabled" when
      // the subscription already exists. Treat as success.
      const msg = String(err.message || '');
      if (/already enabled|AF20024/i.test(msg)) {
        return { already: true };
      }
    }
    throw err;
  }
}

/**
 * List the current subscription status for a tenant.
 * @returns {Promise<Array<{contentType: string, status: string, webhook: object|null}>>}
 */
async function listSubscriptions(tenantGuid) {
  const result = await callManagement(tenantGuid, '/activity/feed/subscriptions/list');
  return Array.isArray(result.data) ? result.data : [];
}

/**
 * List available content blobs for a (tenant, contentType) within a time window.
 *
 * Microsoft constraints:
 *   - startTime and endTime must be within the last 7 days
 *   - max window is 24h per call
 *   - if startTime omitted, defaults to last 24h
 *
 * Returns array of: { contentType, contentId, contentUri, contentCreated, contentExpiration }
 */
async function listAvailableContent(tenantGuid, contentType, startTime, endTime) {
  const query = { contentType };
  if (startTime) {
    query.startTime = startTime instanceof Date ? startTime.toISOString() : startTime;
  }
  if (endTime) {
    query.endTime = endTime instanceof Date ? endTime.toISOString() : endTime;
  }
  return callManagementPaged(tenantGuid, '/activity/feed/subscriptions/content', { query });
}

/**
 * Fetch a single content blob — returns the array of audit records.
 * @param {string} contentUri  Fully-qualified URL from listAvailableContent
 */
async function fetchContentBlob(tenantGuid, contentUri) {
  const result = await callManagement(tenantGuid, contentUri);
  return Array.isArray(result.data) ? result.data : [];
}

module.exports = {
  callManagement,
  callManagementPaged,
  startSubscription,
  listSubscriptions,
  listAvailableContent,
  fetchContentBlob,
  ManagementApiError,
  CONTENT_TYPES,
  BASE_URL,
};
