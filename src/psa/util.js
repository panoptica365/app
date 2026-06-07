/**
 * Panoptica365 — PSA shared helpers (Feature 8.3)
 *
 * toMysqlDatetime is duplicated here (rather than imported from lib/ual-events)
 * on purpose: requiring ual-events runs its UAL schema migrations as a load-time
 * side effect. The PSA modules must not drag that in. This mirrors the same
 * local-copy convention used by message-center-store.js / known-good-store.js.
 *
 * Converts a Date or ISO string to MySQL DATETIME ('YYYY-MM-DD HH:MM:SS') —
 * mysql2 pool.execute rejects Date objects and ISO 'Z' suffixes. Passes
 * null/undefined through unchanged so column NULLs can be set explicitly.
 */
function toMysqlDatetime(value) {
  if (value === null || value === undefined) return value;
  const iso = value instanceof Date ? value.toISOString() : String(value);
  return iso.replace('T', ' ').replace(/Z$/, '');
}

module.exports = { toMysqlDatetime };
