/**
 * Panoptica365 — Diagnostics redactor (Part 3, 2026-06-03 build, §3.5).
 *
 * Runs over EVERY text file in the diagnostics working dir before zipping
 * (including the docker logs the sidecar collected). Two passes:
 *   1. Known secret VALUES — for each SECRET_KEYS entry present in the
 *      environment with a non-empty value (len ≥ 6), literal global replace of
 *      that value with [REDACTED:<KEY>]. Catches a secret no matter where it
 *      appears (mid-JSON, in a log line, etc.).
 *   2. Token PATTERNS — Bearer tokens, standalone JWTs, and key=value style
 *      secret assignments, by regex.
 *
 * NOT redacted, by explicit decision (§3.5.4): tenant names, tenant GUIDs,
 * UPNs, domains. The UI consent line is scoped to secrets/passwords/credentials
 * only — keep it that way. Support replies must be able to reference real
 * tenants.
 *
 * SECRET_KEYS is exported and reused by the collector's config-summary so the
 * "set/length only" masking and the value-redaction stay in lockstep.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Centralized secret key list (spec §3.8 / §3.5). Anything here is masked in
// config-summary.json AND its literal value is scrubbed from every text file.
// GRAPH_CERT_THUMBPRINT is intentionally NOT here (a thumbprint isn't a secret);
// certificate private keys / .pfx contents are excluded from collection entirely.
const SECRET_KEYS = [
  'DB_PASS',
  'MYSQL_ROOT_PASSWORD',
  'ENTRA_CLIENT_SECRET',
  'ANTHROPIC_API_KEY',
  'SMTP_PASS',
  'SESSION_SECRET',
  'LICENSE_TOKEN',
  'PANOPTICA_INSTALL_FINGERPRINT',
  // Certificate passphrase, if one is configured (defence in depth — the .pfx
  // itself is never collected).
  'GRAPH_CERT_PASSWORD',
  'GRAPH_CERT_PASSPHRASE',
];

const MIN_SECRET_LEN = 6;

// Token patterns (§3.5.2). Order matters: redact Bearer + JWT before the
// generic key=value rule so the more specific labels win.
const TOKEN_PATTERNS = [
  { name: 'BEARER', re: /Bearer\s+[A-Za-z0-9._~+/=-]{20,}/g, replace: 'Bearer [REDACTED:TOKEN]' },
  { name: 'JWT', re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, replace: '[REDACTED:JWT]' },
  // password=... / client_secret: ... / api-key=... (case-insensitive). Keep
  // the matched key name, redact only the value.
  {
    name: 'KEYVALUE',
    re: /(password|passwd|pwd|client_secret|api[_-]?key)(\s*[=:]\s*)(\S+)/gi,
    replace: (_m, key, sep) => `${key}${sep}[REDACTED]`,
  },
];

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build the active redaction rule set from the current environment. Computed
 * once per capture and reused for every file.
 * @param {object} [env=process.env]
 */
function buildRules(env = process.env) {
  const valueRules = [];
  for (const key of SECRET_KEYS) {
    const val = env[key];
    if (typeof val === 'string' && val.trim().length >= MIN_SECRET_LEN) {
      valueRules.push({
        key,
        re: new RegExp(escapeRegExp(val.trim()), 'g'),
        replace: `[REDACTED:${key}]`,
      });
    }
  }
  return valueRules;
}

/**
 * Redact a single string. Returns { text, counts } where counts is a map of
 * rule-name → number of replacements made.
 */
function redactText(text, valueRules) {
  const counts = {};
  let out = text;

  for (const rule of valueRules) {
    let n = 0;
    out = out.replace(rule.re, () => { n++; return rule.replace; });
    if (n) counts[rule.key] = (counts[rule.key] || 0) + n;
  }

  for (const pat of TOKEN_PATTERNS) {
    let n = 0;
    out = out.replace(pat.re, (...args) => {
      n++;
      return typeof pat.replace === 'function' ? pat.replace(...args) : pat.replace;
    });
    if (n) counts[pat.name] = (counts[pat.name] || 0) + n;
  }

  return { text: out, counts };
}

// Files we treat as text and rewrite in place. Everything in our bundle is
// .json / .log / .txt; anything else is left untouched.
const TEXT_EXT = new Set(['.json', '.log', '.txt', '.md', '.csv', '.yml', '.yaml']);

function isProbablyText(file) {
  return TEXT_EXT.has(path.extname(file).toLowerCase());
}

/**
 * Recursively redact every text file under `dir`. Returns an aggregate counts
 * object { '<KEY|PATTERN>': total } plus per-file detail. Never throws on an
 * individual file — a failed file is recorded and skipped.
 *
 * @param {string} dir
 * @param {object} [env=process.env]
 */
function redactDir(dir, env = process.env) {
  const valueRules = buildRules(env);
  const totals = {};
  const perFile = {};
  const errors = [];

  function walk(current) {
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch (e) { errors.push({ path: current, error: e.message }); return; }
    for (const ent of entries) {
      const full = path.join(current, ent.name);
      if (ent.isDirectory()) { walk(full); continue; }
      if (!ent.isFile() || !isProbablyText(full)) continue;
      try {
        const original = fs.readFileSync(full, 'utf8');
        const { text, counts } = redactText(original, valueRules);
        if (text !== original) {
          fs.writeFileSync(full, text);
        }
        if (Object.keys(counts).length) {
          perFile[path.relative(dir, full)] = counts;
          for (const [k, v] of Object.entries(counts)) totals[k] = (totals[k] || 0) + v;
        }
      } catch (e) {
        errors.push({ path: path.relative(dir, full), error: e.message });
      }
    }
  }

  walk(dir);
  return { totals, perFile, errors };
}

module.exports = { SECRET_KEYS, buildRules, redactText, redactDir, MIN_SECRET_LEN };
