/**
 * Panoptica365 — Autotask REST API client (Feature 8.3)
 *
 * Thin, dumb HTTP layer: zone discovery, header injection, entity calls,
 * in-call exponential backoff on 429/5xx. NO business logic — the provider
 * abstraction (psa/index.js) owns dedup, link rows, audit, and config.
 *
 * Auth (per Kaseya/Datto REST docs, verified 2026-06-06): three headers —
 * UserName, Secret, ApiIntegrationCode — plus Content-Type. Zone discovery is
 * unauthenticated and returns the per-instance base URL, which we cache in
 * AUTOTASK_ZONE_URL and re-discover on 5xx zone errors or credential change.
 * TLS 1.2 is required (Node's default fetch satisfies this).
 *
 * Every method accepts an optional `ctx` { username, secret, integrationCode,
 * zoneUrl } so the settings "Test connection" flow can validate operator-typed
 * credentials BEFORE persisting them. When omitted, ctx is read live from
 * config.psa.autotask (so a settings save takes effect without a restart).
 */

const config = require('../../config/default');

// Unauthenticated zone-discovery endpoint. Returns the per-instance REST base.
const ZONE_DISCOVERY_BASE = 'https://webservices.autotask.net/atservicesrest';

const MAX_RETRIES = 3;       // in-call retries on 429/5xx
const RETRY_BASE_MS = 1000;  // exponential: 1s, 2s, 4s

/**
 * Typed error carrying the HTTP status + the Autotask `errors` array so the
 * worker/provider can classify (401 → auth-health flip; 4xx → permanent;
 * 5xx/429/network → retryable). statusCode 0 = network/transport failure.
 */
class AutotaskError extends Error {
  constructor(statusCode, message, errors = [], endpoint = '') {
    super(message || `Autotask error ${statusCode}`);
    this.name = 'AutotaskError';
    this.statusCode = statusCode;
    this.errors = Array.isArray(errors) ? errors : [];
    this.endpoint = endpoint;
  }
  get isAuthError() { return this.statusCode === 401; }
  get isRetryable() {
    return this.statusCode === 0 || this.statusCode === 429 || this.statusCode >= 500;
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/** Resolve credentials + zone URL from config unless explicitly supplied. */
function getCtx(override) {
  const at = (config.psa && config.psa.autotask) || {};
  return {
    username:        (override && override.username)        || at.username || '',
    secret:          (override && override.secret)          || at.secret || '',
    integrationCode: (override && override.integrationCode) || at.integrationCode || '',
    zoneUrl:         (override && override.zoneUrl)          || at.zoneUrl || '',
  };
}

/** Normalize a zone base (strip trailing slash) and build a versioned URL. */
function buildUrl(zoneUrl, path) {
  const base = String(zoneUrl || '').replace(/\/+$/, '');
  const rel = String(path).replace(/^\/+/, '');
  return `${base}/v1.0/${rel}`;
}

/**
 * Core request. method/path relative to the zone's /v1.0/. Returns parsed JSON
 * (or null on empty 2xx). Retries 429/5xx with exponential backoff; throws
 * AutotaskError on auth/client errors or exhausted retries.
 */
async function request(method, path, { body, ctx, query } = {}) {
  const c = getCtx(ctx);
  if (!c.zoneUrl) {
    throw new AutotaskError(0, 'Autotask zone URL not set — run zone discovery / Test Connection first', [], path);
  }
  if (!c.username || !c.secret || !c.integrationCode) {
    throw new AutotaskError(0, 'Autotask credentials incomplete (UserName, Secret, ApiIntegrationCode all required)', [], path);
  }

  let url = buildUrl(c.zoneUrl, path);
  if (query && typeof query === 'string') url += (url.includes('?') ? '&' : '?') + query;

  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ApiIntegrationCode: c.integrationCode,
    UserName: c.username,
    Secret: c.secret,
  };

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const opts = { method, headers };
      if (body !== undefined) opts.body = JSON.stringify(body);
      const res = await fetch(url, opts);

      if (res.status === 429 || res.status >= 500) {
        const text = await res.text().catch(() => '');
        if (attempt < MAX_RETRIES) {
          const waitMs = res.status === 429
            ? (parseInt(res.headers.get('Retry-After') || '0', 10) * 1000 || RETRY_BASE_MS * 2 ** (attempt - 1))
            : RETRY_BASE_MS * 2 ** (attempt - 1);
          await sleep(waitMs);
          continue;
        }
        throw new AutotaskError(res.status, `Autotask ${res.status} on ${method} ${path}`, parseErrors(text), path);
      }

      if (res.status >= 400) {
        const text = await res.text().catch(() => '');
        throw new AutotaskError(res.status, `Autotask ${res.status} on ${method} ${path}`, parseErrors(text), path);
      }

      const text = await res.text();
      if (!text) return null;
      try { return JSON.parse(text); }
      catch { return { _raw: text }; }
    } catch (err) {
      if (err instanceof AutotaskError) throw err;
      // Network/transport — retry, then surface as statusCode 0.
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
        continue;
      }
      throw new AutotaskError(0, err.message, [], path);
    }
  }
}

/** Pull the Autotask `errors` array out of an error body, best-effort. */
function parseErrors(text) {
  if (!text) return [];
  try {
    const j = JSON.parse(text);
    if (Array.isArray(j.errors)) return j.errors;
    if (typeof j === 'string') return [j];
    return [];
  } catch { return [String(text).slice(0, 300)]; }
}

/**
 * Zone discovery (unauthenticated). Returns the per-instance REST base URL.
 * Caller persists it as AUTOTASK_ZONE_URL.
 */
async function discoverZone(username) {
  const user = encodeURIComponent(username || '');
  const url = `${ZONE_DISCOVERY_BASE}/v1.0/zoneInformation?user=${user}`;
  let res;
  try {
    res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
  } catch (err) {
    throw new AutotaskError(0, `Zone discovery network error: ${err.message}`, [], 'zoneInformation');
  }
  if (res.status >= 400) {
    const text = await res.text().catch(() => '');
    throw new AutotaskError(res.status, `Zone discovery failed (${res.status})`, parseErrors(text), 'zoneInformation');
  }
  const data = await res.json().catch(() => null);
  if (!data || !data.url) {
    throw new AutotaskError(0, 'Zone discovery returned no url', [], 'zoneInformation');
  }
  // data.url is the REST base, e.g. https://webservices16.autotask.net/atservicesrest/
  return String(data.url).replace(/\/+$/, '');
}

// ─── Entity operations ───

/** Batch query tickets by id (≤500 ids). Returns the `items` array. */
async function queryTickets(ids, ctx) {
  if (!ids || ids.length === 0) return [];
  const body = {
    MaxRecords: 500,
    IncludeFields: ['id', 'ticketNumber', 'status', 'companyID', 'title'],
    Filter: [{ op: 'in', field: 'id', value: ids.map(Number) }],
  };
  const data = await request('POST', 'Tickets/query', { body, ctx });
  return (data && data.items) || [];
}

/** Fetch one ticket by id, or null if 404. */
async function getTicket(id, ctx) {
  try {
    const data = await request('GET', `Tickets/${Number(id)}`, { ctx });
    return (data && data.item) || null;
  } catch (err) {
    if (err instanceof AutotaskError && err.statusCode === 404) return null;
    throw err;
  }
}

/** Create a ticket. Returns the new ticket id (itemId). */
async function createTicket(payload, ctx) {
  const data = await request('POST', 'Tickets', { body: payload, ctx });
  return data && data.itemId;
}

/** Patch ONLY a ticket's status (close flow — never touches description). */
async function patchTicketStatus(id, statusId, ctx) {
  const body = { id: Number(id), status: Number(statusId) };
  const data = await request('PATCH', 'Tickets', { body, ctx });
  return data && data.itemId;
}

/** Create a TicketNote under a ticket. Returns the new note id (itemId). */
async function createTicketNote(ticketId, { title, description, noteType, publish }, ctx) {
  const body = {
    title: String(title || '').slice(0, 250),
    description: String(description || ''),
    noteType: Number(noteType),
    publish: Number(publish),
  };
  const data = await request('POST', `Tickets/${Number(ticketId)}/Notes`, { body, ctx });
  return data && data.itemId;
}

/** Live picklist + field metadata for Tickets (status/priority/queue/source). */
async function getTicketFieldInfo(ctx) {
  const data = await request('GET', 'Tickets/entityInformation/fields', { ctx });
  return (data && data.fields) || [];
}

/** Live picklist + field metadata for TicketNotes (noteType/publish). */
async function getTicketNoteFieldInfo(ctx) {
  const data = await request('GET', 'TicketNotes/entityInformation/fields', { ctx });
  return (data && data.fields) || [];
}

/** Search active companies by name substring. Returns the `items` array. */
async function queryCompanies(search, ctx) {
  const filter = [{ op: 'eq', field: 'isActive', value: true }];
  if (search && String(search).trim()) {
    filter.push({ op: 'contains', field: 'companyName', value: String(search).trim() });
  }
  const body = {
    MaxRecords: 200,
    IncludeFields: ['id', 'companyName', 'companyType', 'isActive'],
    Filter: filter,
  };
  const data = await request('POST', 'Companies/query', { body, ctx });
  return (data && data.items) || [];
}

/**
 * Validate credentials end-to-end: zone discovery → authenticated probe.
 * Returns { ok: true, zoneUrl } on success. Throws AutotaskError otherwise.
 * The probe is a cheap entityInformation GET (no data mutation).
 */
async function testConnection(ctx) {
  const c = getCtx(ctx);
  const zoneUrl = await discoverZone(c.username);
  // Probe with the freshly discovered zone, regardless of any stale cached one.
  await request('GET', 'Tickets/entityInformation', { ctx: { ...c, zoneUrl } });
  return { ok: true, zoneUrl };
}

module.exports = {
  AutotaskError,
  discoverZone,
  queryTickets,
  getTicket,
  createTicket,
  patchTicketStatus,
  createTicketNote,
  getTicketFieldInfo,
  getTicketNoteFieldInfo,
  queryCompanies,
  testConnection,
  // exposed for the provider's reuse + unit poking
  _request: request,
  _buildUrl: buildUrl,
};
