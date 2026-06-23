/**
 * Panoptica365 — Public DNS reader for email-auth posture (Feature A6 §7)
 *
 * Reads a domain's public email-authentication records (MX, SPF, DKIM, DMARC +
 * the lighter mechanisms) using Node's `dns.promises`. Read-only, external —
 * never touches the customer tenant.
 *
 * Robustness decisions (locked 2026-06-22, see project memory):
 *   1. Pinned resolvers (1.1.1.1 / 8.8.8.8 / 9.9.9.9) WITH automatic fallback to
 *      the host's system resolver if outbound :53 to public resolvers is
 *      firewalled — so it is correct on any MSP host by construction. The
 *      decision is probed once per process and reported via getResolverMode().
 *   2. The v0.1.23 trap: a FAILED read must never look like "everything removed."
 *      ENOTFOUND/ENODATA/NXDOMAIN = genuinely ABSENT (safe to record).
 *      SERVFAIL/timeout/refused/network = a READ FAILURE → thrown as
 *      DnsReadError on the apex reads (MX + apex TXT) so the worker preserves
 *      the prior snapshot, or marked `read_error` on a secondary mechanism so
 *      the scorer excludes it and the drift engine skips it (never false drift).
 *
 * DKIM is the differentiator (§7a): three-state (pass/fail/indeterminate),
 * provider-driven. A miss against a DETECTED tier-1 provider (the M365
 * selector1/selector2 case) is a hard fail; a miss for a dynamic-selector
 * sender is `indeterminate`, never a fail.
 */

'use strict';

const dns = require('dns');
const https = require('https');
const url = require('url');
const catalog = require('./email-auth-catalog');

const { Resolver } = dns.promises;

const QUERY_TIMEOUT_MS = Math.max(2000, parseInt(process.env.EMAIL_AUTH_DNS_TIMEOUT_MS, 10) || 5000);
const PROBE_CONCURRENCY = Math.max(2, parseInt(process.env.EMAIL_AUTH_DKIM_CONCURRENCY, 10) || 8);
// DNS-over-HTTPS + policy-file fetch timeout (DNSSEC DS read + MTA-STS mode).
const DOH_TIMEOUT_MS = Math.max(2000, parseInt(process.env.EMAIL_AUTH_DOH_TIMEOUT_MS, 10) || 5000);
const PINNED_SERVERS = (process.env.EMAIL_AUTH_DNS_SERVERS || '1.1.1.1,8.8.8.8,9.9.9.9')
  .split(',').map(s => s.trim()).filter(Boolean);

// SPF include-tree bounds (best-effort lookup counting; never blocks the read).
const SPF_MAX_DEPTH = 10;
const SPF_MAX_QUERIES = 30;

// DNS error codes that mean "the name/record genuinely isn't there" (absent) —
// distinct from a transient failure to READ.
const ABSENT_CODES = new Set([
  dns.NOTFOUND, dns.NODATA, 'ENOTFOUND', 'ENODATA', 'NXDOMAIN',
]);

class DnsReadError extends Error {
  constructor(message, code) { super(message); this.name = 'DnsReadError'; this.code = code || 'EDNSREAD'; }
}

// ── Resolver selection (pinned → system fallback), probed once ───────────────
let _resolverPromise = null;
let _resolverMode = 'unprobed';

function buildPinned() {
  const r = new Resolver({ timeout: QUERY_TIMEOUT_MS, tries: 2 });
  try { r.setServers(PINNED_SERVERS); } catch { /* invalid env → caller falls back */ }
  return r;
}

async function chooseResolver() {
  if (_resolverPromise) return _resolverPromise;
  _resolverPromise = (async () => {
    const pinned = buildPinned();
    try {
      // Known-good probe. Success ⇒ egress to public resolvers works.
      await withTimeout(pinned.resolveTxt('cloudflare.com'), QUERY_TIMEOUT_MS);
      _resolverMode = `pinned(${PINNED_SERVERS.join(',')})`;
      return pinned;
    } catch (err) {
      // Egress to :53 likely blocked, or pinned servers unreachable → use the
      // host's configured resolver. Correct on any MSP host by construction.
      _resolverMode = `system(${(safeGetServers()).join(',') || 'default'})`;
      console.warn(`[EmailAuth] pinned DNS resolvers unreachable (${err.code || err.message}); falling back to system resolver`);
      return dns.promises;
    }
  })();
  return _resolverPromise;
}

function safeGetServers() { try { return dns.getServers(); } catch { return []; } }
function getResolverMode() { return _resolverMode; }
/** Test seam: drop the memoized resolver so the next read re-probes. */
function _resetResolver() { _resolverPromise = null; _resolverMode = 'unprobed'; }

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new DnsReadError(`DNS query timed out after ${ms}ms`, 'ETIMEOUT')), ms);
    if (timer.unref) timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Run one resolver method. Returns `null` for a genuine absence; throws
 * DnsReadError for a transient/read failure (so callers can tell them apart).
 */
async function query(method, name, type) {
  const resolver = await chooseResolver();
  try {
    const args = type ? [name, type] : [name];
    return await withTimeout(resolver[method](...args), QUERY_TIMEOUT_MS);
  } catch (err) {
    if (err instanceof DnsReadError) throw err; // our timeout
    const code = err && err.code;
    if (ABSENT_CODES.has(code)) return null;
    throw new DnsReadError(`${method}(${name}${type ? ',' + type : ''}) failed: ${code || err.message}`, code || 'EDNSREAD');
  }
}

/** resolveTxt → array of full strings (Node returns string[][] of chunks). */
async function resolveTxtJoined(name) {
  const recs = await query('resolveTxt', name);
  if (!recs) return null;
  return recs.map(chunks => Array.isArray(chunks) ? chunks.join('') : String(chunks));
}

/**
 * Retry-once wrapper for a SECONDARY mechanism read. Returns the value, or a
 * `{ read_error: true }` marker on persistent non-absent failure — never throws.
 * The scorer excludes read_error mechanisms; the drift engine skips them.
 */
async function safeMech(label, fn) {
  try {
    return await fn();
  } catch (err) {
    if (!(err instanceof DnsReadError)) throw err;
    try {
      return await fn(); // single retry — rides out a transient SERVFAIL/timeout
    } catch (err2) {
      console.warn(`[EmailAuth] ${label} read failed twice (${err2.code}); marking read_error (no drift, excluded from score)`);
      return { read_error: true, present: false };
    }
  }
}

// ── HTTPS helpers (DNS-over-HTTPS for DNSSEC; MTA-STS policy fetch) ───────────

/** Bounded HTTPS GET → response body string. Rejects on non-2xx / timeout. */
function httpsGetText(target, timeoutMs, headers) {
  return new Promise((resolve, reject) => {
    const req = https.get(target, { headers: headers || {} }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) { res.resume(); reject(new Error(`HTTP ${res.statusCode}`)); return; }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; if (body.length > 65536) req.destroy(new Error('body too large')); });
      res.on('end', () => resolve(body));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

/**
 * Resolve a record type via DNS-over-HTTPS (Google, then Cloudflare). Used for
 * rrtypes Node's c-ares resolver can't query (DS/DNSKEY) and to read the AD bit.
 * Returns the parsed JSON ({Status, AD, Answer:[...]}) or null if both fail.
 */
async function dohResolve(name, type) {
  const endpoints = [
    `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`,
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`,
  ];
  for (const ep of endpoints) {
    try { return JSON.parse(await httpsGetText(ep, DOH_TIMEOUT_MS, { accept: 'application/dns-json' })); }
    catch { /* try next endpoint */ }
  }
  return null;
}

/** Pure: derive DNSSEC status from a DoH DS-query response. */
function parseDnssecAnswer(doh) {
  if (!doh) return { status: 'unknown' };
  const answers = Array.isArray(doh.Answer) ? doh.Answer : [];
  if (answers.some(a => a.type === 43)) return { status: 'enabled', validated: doh.AD === true }; // 43 = DS
  if (doh.Status === 0) return { status: 'disabled' }; // NOERROR but no DS delegated
  return { status: 'unknown' };
}

/** Pure: read `mode:` from an MTA-STS policy file body. */
function parseMtaStsMode(body) {
  const m = /^\s*mode\s*:\s*([a-z]+)/im.exec(String(body || ''));
  return m ? m[1].toLowerCase() : null;
}

// ── Mechanism reads ──────────────────────────────────────────────────────────

/** MX. Apex read — a read failure THROWS (preserve-baseline guard). */
async function getMx(domain) {
  const recs = await query('resolveMx', domain); // throws DnsReadError on failure
  if (!recs || !recs.length) return { present: false, hosts: [] };
  const hosts = recs
    .map(r => ({ exchange: catalog.norm(r.exchange), priority: r.priority }))
    .filter(h => h.exchange)
    .sort((a, b) => a.priority - b.priority);
  return { present: hosts.length > 0, hosts };
}

/** Apex TXT. Apex read — a read failure THROWS (preserve-baseline guard). */
async function getApexTxt(domain) {
  const txt = await resolveTxtJoined(domain); // throws DnsReadError on failure
  return txt || [];
}

/** Parse SPF from the apex TXT set + count the include-tree DNS lookups. */
async function parseSpf(apexTxt, domain) {
  const raw = (apexTxt || []).find(t => /^v=spf1\b/i.test(t.trim()));
  if (!raw) return { present: false, raw: null, terminal: null, includes: [], lookups: 0, lookup_overflow: false };

  const includes = [];
  const terms = raw.trim().split(/\s+/).slice(1);
  let terminal = null;
  for (const term of terms) {
    const m = /^([-~?+]?)all$/i.exec(term);
    if (m) { terminal = `${m[1] || '?'}all`; continue; }
    const inc = /^include:(.+)$/i.exec(term);
    if (inc) includes.push(catalog.norm(inc[1]));
    const red = /^redirect=(.+)$/i.exec(term);
    if (red) includes.push(catalog.norm(red[1]));
  }

  // Best-effort recursive lookup count (RFC 7208 §4.6.4). Include/redirect/a/mx/
  // ptr/exists each cost one lookup. Errors counting an include are swallowed —
  // the apex record (the drift-critical signal) was already read successfully.
  let queries = 0;
  const visited = new Set();
  async function count(d, depth) {
    if (depth > SPF_MAX_DEPTH || queries >= SPF_MAX_QUERIES || visited.has(d)) return 0;
    visited.add(d);
    let txt;
    try { txt = await resolveTxtJoined(d); } catch { return 1; } // count the attempt, stop the branch
    const rec = (txt || []).find(t => /^v=spf1\b/i.test(t.trim()));
    if (!rec) return 1;
    let local = 0;
    for (const term of rec.trim().split(/\s+/).slice(1)) {
      if (/^(a|mx|ptr|exists)(:|$)/i.test(term)) local += 1;
      const inc = /^(?:include:|redirect=)(.+)$/i.exec(term);
      if (inc) { local += 1; queries += 1; local += await count(catalog.norm(inc[1]), depth + 1); }
    }
    return local;
  }
  let lookups = 0;
  for (const term of terms) {
    if (/^(a|mx|ptr|exists)(:|$)/i.test(term)) lookups += 1;
  }
  for (const inc of includes) { queries += 1; lookups += 1; lookups += await count(inc, 1); }

  return { present: true, raw, terminal, includes, lookups, lookup_overflow: lookups > 10 };
}

/** DMARC at _dmarc.<domain>. Secondary read → read_error marker on failure. */
function getDmarc(domain) {
  return safeMech('dmarc', async () => {
    const txt = await resolveTxtJoined(`_dmarc.${domain}`);
    const raw = (txt || []).find(t => /^v=DMARC1\b/i.test(t.trim()));
    if (!raw) return { present: false, raw: null };
    const tags = parseTags(raw);
    const rua = (tags.rua || '').split(',').map(s => s.trim()).filter(Boolean);
    const ruf = (tags.ruf || '').split(',').map(s => s.trim()).filter(Boolean);
    return {
      present: true, raw,
      p: (tags.p || '').toLowerCase() || null,
      sp: (tags.sp || '').toLowerCase() || null,
      pct: tags.pct != null ? parseInt(tags.pct, 10) : null,
      rua, ruf,
      aspf: (tags.aspf || '').toLowerCase() || null,
      adkim: (tags.adkim || '').toLowerCase() || null,
    };
  });
}

// ── DKIM engine (§7a) ─────────────────────────────────────────────────────────

/** Decode a DKIM TXT record's key state. Returns null if not a DKIM record. */
function decodeDkim(txtStrings) {
  if (!txtStrings || !txtStrings.length) return null;
  const raw = txtStrings.find(t => /(^|;)\s*(v=DKIM1|k=|p=)/i.test(t)) || null;
  if (!raw) return null;
  const tags = parseTags(raw);
  const p = tags.p != null ? String(tags.p).trim() : null;
  const revoked = p === ''; // p= present but empty = revoked key
  const testMode = /(^|:)y(:|$)/i.test(tags.t || '');
  const keyType = (tags.k || 'rsa').toLowerCase();
  let keyBits = null;
  if (p && keyType === 'rsa') {
    // Estimate RSA modulus size from the base64 SPKI length (~38B SPKI overhead).
    const derBytes = Math.floor(p.replace(/[^A-Za-z0-9+/=]/g, '').length * 3 / 4);
    keyBits = Math.max(0, (derBytes - 38)) * 8;
  }
  return { hasKey: !!p && !revoked, revoked, testMode, keyType, keyBits };
}

/** Probe one selector. outcome: 'key'|'revoked'|'testmode'|'absent'|'error'. */
async function probeSelector(domain, entry) {
  const fqdn = `${entry.selector}._domainkey.${domain}`;
  let txt = null, txtErr = false, cname = null, cnameErr = false;
  try { txt = await resolveTxtJoined(fqdn); } catch (e) { if (e instanceof DnsReadError) txtErr = true; }
  try { cname = await query('resolveCname', fqdn); } catch (e) { if (e instanceof DnsReadError) cnameErr = true; }

  const target = cname && cname[0] ? catalog.norm(cname[0]) : null;
  const dec = decodeDkim(txt);
  let outcome;
  if (dec && dec.revoked) outcome = 'revoked';
  else if (dec && dec.testMode) outcome = 'testmode';
  else if (dec && dec.hasKey) outcome = 'key';
  else if (target && !dec) outcome = 'key'; // CNAME to provider (key lives at target); treat as published
  else if (txtErr || cnameErr) outcome = 'error';
  else outcome = 'absent';

  let targetMatch = true;
  if (entry.target_contains) targetMatch = target ? target.includes(entry.target_contains) : false;

  return {
    selector: entry.selector, provider: entry.provider, tier: entry.tier,
    outcome, target, targetMatch,
    keyType: dec ? dec.keyType : null, keyBits: dec ? dec.keyBits : null,
  };
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  });
  await Promise.all(workers);
  return out;
}

/**
 * DKIM verdict for a domain. Three-state, provider-driven (§7a).
 * @param {string} domain
 * @param {{all:string[]}} providers  catalog.detectProviders() output
 */
async function getDkim(domain, providers) {
  const plan = catalog.buildProbePlan();
  const probes = await mapLimit(plan, PROBE_CONCURRENCY, e => probeSelector(domain, e));

  const hits = probes.filter(p => p.outcome === 'key' && p.targetMatch);
  const revokedHits = probes.filter(p => p.outcome === 'revoked');
  const testModeHits = probes.filter(p => p.outcome === 'testmode');

  // Which detected providers had fixed selectors we EXPECTED to resolve?
  const expected = (providers.all || []).filter(catalog.expectsFixedDkim);

  // A detected tier-1 provider is "missing" only if ALL its selectors are
  // CONFIRMED absent (not errored — an errored probe can't prove absence).
  const confirmedMissing = [];
  let anyExpectedUnconfirmed = false;
  for (const prov of expected) {
    const cfg = catalog.PROBEABLE_SELECTORS[prov];
    const provProbes = probes.filter(p => p.provider === prov);
    const anyKey = provProbes.some(p => p.outcome === 'key' && p.targetMatch);
    const anyRevoked = provProbes.some(p => p.outcome === 'revoked');
    const anyError = provProbes.some(p => p.outcome === 'error');
    if (anyKey) continue;
    if (anyRevoked) { confirmedMissing.push({ prov, reason: 'revoked', label: cfg.label }); continue; }
    if (anyError) { anyExpectedUnconfirmed = true; continue; } // can't confirm absence → indeterminate
    confirmedMissing.push({ prov, reason: 'missing', label: cfg.label });
  }

  const selectorsFound = hits.map(h => ({ selector: h.selector, provider: h.provider, target: h.target, keyType: h.keyType, keyBits: h.keyBits }));
  const weakKey = hits.some(h => h.keyType === 'rsa' && h.keyBits && h.keyBits > 0 && h.keyBits < 1536);

  // Verdict ladder.
  if (confirmedMissing.length) {
    // Headline case: detected provider (M365 first) with no valid key.
    const m365 = confirmedMissing.find(c => c.prov === 'microsoft365');
    const chosen = m365 || confirmedMissing[0];
    return {
      state: 'fail',
      expectedLabel: chosen.label,
      revoked: chosen.reason === 'revoked',
      testMode: false,
      expectedProviders: expected.map(catalog.providerLabel),
      selectorsFound, weakKey,
    };
  }
  if (hits.length) {
    const passProvider = hits.find(h => h.provider) || hits[0];
    return {
      state: 'pass',
      passProvider: passProvider.provider ? catalog.providerLabel(passProvider.provider) : passProvider.selector,
      weakKey, selectorsFound,
      expectedProviders: expected.map(catalog.providerLabel),
    };
  }
  // Nothing valid answered. Revoked/test-mode without a detected expected
  // provider is still a fail signal worth surfacing.
  if (revokedHits.length) {
    return { state: 'fail', revoked: true, testMode: false, expectedLabel: '', selectorsFound, weakKey, expectedProviders: [] };
  }
  if (testModeHits.length) {
    return { state: 'fail', revoked: false, testMode: true, expectedLabel: '', selectorsFound, weakKey, expectedProviders: [] };
  }
  // Indeterminate — unprobeable/dynamic sender or custom selector (§7a). NEVER a
  // fail; that is a property of DNS (RFC 6376), not a coverage gap.
  const dynamicDetected = (providers.all || []).filter(p => catalog.DYNAMIC_UNPROBEABLE.has(p)).map(catalog.providerLabel);
  return {
    state: 'indeterminate',
    expectedLabel: dynamicDetected[0] || '',
    unconfirmed: anyExpectedUnconfirmed,
    expectedProviders: dynamicDetected,
    selectorsFound: [],
    weakKey: false,
  };
}

// ── Lighter mechanisms ─────────────────────────────────────────────────────────

function getMtaSts(domain) {
  return safeMech('mta_sts', async () => {
    const txt = await resolveTxtJoined(`_mta-sts.${domain}`);
    const raw = (txt || []).find(t => /^v=STSv1\b/i.test(t.trim()));
    if (!raw) return { present: false, raw: null, mode: null };
    // Fetch the HTTPS policy file to read the enforcement mode (enforce/testing/
    // none). Best-effort: if the fetch fails the record is still "present" and
    // scores as partial rather than full.
    let mode = null;
    try { mode = parseMtaStsMode(await httpsGetText(`https://mta-sts.${domain}/.well-known/mta-sts.txt`, DOH_TIMEOUT_MS)); }
    catch { /* policy fetch optional */ }
    return { present: true, raw, mode };
  });
}

function getTlsRpt(domain) {
  return safeMech('tls_rpt', async () => {
    const txt = await resolveTxtJoined(`_smtp._tls.${domain}`);
    const raw = (txt || []).find(t => /^v=TLSRPTv1\b/i.test(t.trim()));
    return { present: !!raw, raw: raw || null };
  });
}

async function getDnssec(domain) {
  // Node's c-ares resolver doesn't support the DS/DNSKEY rrtypes, so we read the
  // DS record (and the AD bit) over DNS-over-HTTPS — the same signal the public
  // checkers show. Falls back to 'unknown' only if both DoH endpoints are
  // unreachable (graceful; 'unknown' is excluded from the score, never a false
  // penalty — §8).
  try {
    return parseDnssecAnswer(await dohResolve(domain, 'DS'));
  } catch {
    return { status: 'unknown' };
  }
}

function getBimi(domain) {
  return safeMech('bimi', async () => {
    const txt = await resolveTxtJoined(`default._bimi.${domain}`);
    const raw = (txt || []).find(t => /^v=BIMI1\b/i.test(t.trim()));
    if (!raw) return { present: false, raw: null, hasVmc: false };
    const tags = parseTags(raw);
    return { present: true, raw, hasVmc: !!(tags.a && /^https:/i.test(tags.a.trim())) };
  });
}

function getDane(domain, mxHosts) {
  return safeMech('dane', async () => {
    const host = mxHosts && mxHosts[0] && mxHosts[0].exchange;
    if (!host) return { present: false };
    try {
      const tlsa = await query('resolve', `_25._tcp.${host}`, 'TLSA');
      return { present: !!(tlsa && tlsa.length) };
    } catch (err) {
      if (err instanceof DnsReadError && ABSENT_CODES.has(err.code)) return { present: false };
      throw err; // genuine read failure → safeMech retries/marks
    }
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Parse `k=v;k2=v2` tag strings (DKIM/DMARC/BIMI). Lowercased keys. */
function parseTags(raw) {
  const out = {};
  for (const part of String(raw).split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim().toLowerCase();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

/** IDN/punycode → ASCII; falls back to the lowercased input. */
function toAscii(domain) {
  const lc = String(domain || '').toLowerCase().trim().replace(/\.$/, '');
  try { return url.domainToASCII(lc) || lc; } catch { return lc; }
}

/**
 * Read the full email-auth posture for one domain.
 * Throws DnsReadError ONLY when the APEX reads (MX + apex TXT) fail — that is
 * the resolver-down signal the worker uses to preserve the prior snapshot.
 * @returns {object} the `records` object consumed by email-auth-scorer.
 */
async function readDomain(rawDomain) {
  const domain = toAscii(rawDomain);
  const is_onmicrosoft = /\.onmicrosoft\.com$/i.test(domain);

  // Apex reads first — these establish resolver health (v0.1.23 guard).
  const mx = await getMx(domain);
  const apexTxt = await getApexTxt(domain);

  const spf = await parseSpf(apexTxt, domain);
  const providers = catalog.detectProviders({
    mxHosts: mx.hosts.map(h => h.exchange),
    spfIncludes: spf.includes,
  });

  // BIMI + DANE are intentionally not read/scored/displayed (rarely configured
  // by SMB tenants — product decision). getBimi/getDane remain exported below
  // for future use, but are not part of the scored posture.
  const [dkim, dmarc, mta_sts, tls_rpt, dnssec] = await Promise.all([
    getDkim(domain, providers),
    getDmarc(domain),
    getMtaSts(domain),
    getTlsRpt(domain),
    getDnssec(domain),
  ]);

  return {
    domain, is_onmicrosoft,
    mx, spf, dkim, dmarc, mta_sts, tls_rpt, dnssec,
    detected_providers: providers,
    resolver_mode: getResolverMode(),
    read_at: new Date().toISOString(),
  };
}

module.exports = {
  readDomain,
  // mechanism readers (exported for targeted use / tests)
  getMx, getApexTxt, parseSpf, getDmarc, getDkim,
  getMtaSts, getTlsRpt, getDnssec, getBimi, getDane,
  decodeDkim, parseTags, toAscii,
  dohResolve, parseDnssecAnswer, parseMtaStsMode,
  getResolverMode, _resetResolver,
  DnsReadError,
};
