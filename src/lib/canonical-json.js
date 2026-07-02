/**
 * Panoptica365 — Canonical JSON + structural-diff helpers (shared)
 *
 * House rule (load-bearing): drift compares are STRUCTURAL, never a
 * `JSON.stringify` of a raw Graph payload (key order + server-managed volatile
 * fields would produce false drift). These helpers give every surface one
 * deterministic canonicalization + hash + leaf-level diff so the comparison is
 * identical regardless of JavaScript insertion order or MySQL JSON
 * round-tripping.
 *
 * `canonicalJsonStringify` is intentionally byte-compatible with the private
 * copy that already lives in src/routes/api-intune.js (computeDriftHash). That
 * route predates this shared module; it keeps its local copy to avoid touching
 * a load-bearing drift path mid-feature. New code should import from here.
 *
 * Pure + I/O-free → unit-testable in isolation (see test/).
 */

'use strict';

const crypto = require('crypto');

/**
 * JSON.stringify with deterministic key ordering. Every plain object is emitted
 * with keys in lexicographic order so the output is independent of insertion
 * order or MySQL JSON normalization. Arrays keep their order (order is
 * significant for most config arrays; callers that need order-independence sort
 * before hashing — see normalizeForBaseline).
 */
function canonicalJsonStringify(obj) {
  return JSON.stringify(obj, (_key, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const sorted = {};
      for (const k of Object.keys(value).sort()) sorted[k] = value[k];
      return sorted;
    }
    return value;
  });
}

/** sha256 hex of the canonical (key-sorted) serialization of `obj`. */
function canonicalHash(obj) {
  return crypto.createHash('sha256').update(canonicalJsonStringify(obj)).digest('hex');
}

/** Structural deep equality (order-sensitive for arrays). */
function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepEqual(a[k], b[k])) return false;
  }
  return true;
}

// Server-managed / volatile keys that are NOT part of the configuration an
// operator authored — they churn on their own and would manufacture false
// drift. Stripped (deeply, by key name) before a baseline is captured or a
// live object is compared. Superset of the per-type skip lists already used by
// the Intune template drift compare.
const DEFAULT_VOLATILE_KEYS = new Set([
  'id', 'createdDateTime', 'lastModifiedDateTime', 'modifiedDateTime',
  'version', 'supportsScopeTags', 'isAssigned',
  'deviceStatuses', 'userStatuses', 'deviceStatusOverview', 'userStatusOverview',
  'deviceSettingStateSummaries', 'assignments',
  'deviceManagementApplicabilityRuleDeviceMode',
  'deviceManagementApplicabilityRuleOsEdition',
  'deviceManagementApplicabilityRuleOsVersion',
  'validOperatingSystemBuildRanges',
]);

/**
 * Deep-clone `obj` with volatile keys removed and any OData annotation keys
 * dropped, so the result is a stable representation of the *authored*
 * configuration. This covers BOTH object-scoped annotations (`@odata.context`,
 * `@odata.type`) AND property-scoped ones (`authenticationStrength@odata.context`,
 * `foo@odata.count`) — Graph sprinkles these onto nested objects and they are
 * never part of the config an operator authored. `@` never appears in a real
 * Graph property name, so "key contains @" is a safe, exhaustive predicate.
 * Object keys are left as-is here; ordering is handled at serialization time by
 * canonicalJsonStringify.
 *
 * @param {*} obj
 * @param {object} [opts]
 * @param {Iterable<string>} [opts.extraVolatile] — extra key names to strip
 * @param {boolean} [opts.keepAssignments=false] — retain `assignments` (default strips it)
 */
function normalizeForBaseline(obj, opts = {}) {
  const volatile = new Set(DEFAULT_VOLATILE_KEYS);
  if (opts.keepAssignments) volatile.delete('assignments');
  if (opts.extraVolatile) for (const k of opts.extraVolatile) volatile.add(k);

  function walk(node) {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      const out = {};
      for (const k of Object.keys(node)) {
        if (volatile.has(k)) continue;
        // Drop every OData annotation — object-scoped (@odata.context) AND
        // property-scoped (authenticationStrength@odata.context). Using the
        // former startsWith('@') here missed property-scoped annotations, which
        // then surfaced as phantom drift (e.g. "grantControls.authenticationStrength
        // @odata.context: empty → empty"). '@' is never in an authored Graph key.
        if (k.includes('@')) continue;
        out[k] = walk(node[k]);
      }
      return out;
    }
    return node;
  }
  return walk(obj);
}

/**
 * Leaf-level structural diff between two already-normalized values. Returns an
 * array of change records, each:
 *   { path, change: 'modified'|'added'|'removed', from?, to? }
 * `path` is a dotted/bracketed breadcrumb (e.g. "grantControls.builtInControls[0]").
 *
 * Used to build a human-readable "what changed from as-found" payload for the
 * drift alert. The hash compare (canonicalHash) is the fast yes/no gate; this
 * runs only when the hashes differ.
 */
function structuralDiff(baseline, current) {
  const diffs = [];

  function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }

  function walk(a, b, path) {
    if (deepEqual(a, b)) return;

    if (isObj(a) && isObj(b)) {
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      for (const k of Array.from(keys).sort()) {
        const childPath = path ? `${path}.${k}` : k;
        if (!(k in a)) diffs.push({ path: childPath, change: 'added', to: b[k] });
        else if (!(k in b)) diffs.push({ path: childPath, change: 'removed', from: a[k] });
        else walk(a[k], b[k], childPath);
      }
      return;
    }

    if (Array.isArray(a) && Array.isArray(b)) {
      const len = Math.max(a.length, b.length);
      for (let i = 0; i < len; i++) {
        const childPath = `${path}[${i}]`;
        if (i >= a.length) diffs.push({ path: childPath, change: 'added', to: b[i] });
        else if (i >= b.length) diffs.push({ path: childPath, change: 'removed', from: a[i] });
        else walk(a[i], b[i], childPath);
      }
      return;
    }

    // Scalar (or type) mismatch.
    diffs.push({ path: path || '(root)', change: 'modified', from: a, to: b });
  }

  walk(baseline, current, '');
  return diffs;
}

module.exports = {
  canonicalJsonStringify,
  canonicalHash,
  deepEqual,
  normalizeForBaseline,
  structuralDiff,
  DEFAULT_VOLATILE_KEYS,
};
