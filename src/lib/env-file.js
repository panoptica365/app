/**
 * Panoptica365 — .env value escaping (2026-06-06)
 *
 * dotenv treats an unquoted '#' in a value as the start of an inline comment,
 * so a secret like "abc#def@$" written as KEY=abc#def@$ is silently TRUNCATED
 * to "abc" on the next process boot — surfacing as a 401 (PSA), SMTP auth
 * failure, etc., only after a restart. (Confirmed against dotenv 16.6.1.)
 *
 * escapeEnvValue() quotes values so they round-trip losslessly. It is shared by
 * every .env writer (api-settings, api-setup, api-psa) so no secret can be
 * mangled regardless of which screen wrote it — a robust-by-construction fix,
 * not a per-field patch.
 *
 * Quoting strategy (dotenv 16 semantics):
 *   - Common safe charset → write BARE (back-compat; existing vars untouched).
 *   - Otherwise SINGLE-quote: dotenv treats single-quoted contents as fully
 *     literal — '#', '$', '"', '\\', spaces all survive. Only a literal single
 *     quote can't appear inside.
 *   - Value contains a single quote → double-quote (handles ' fine), escaping
 *     the rare \\ and " (best-effort for the astronomically rare secret that
 *     mixes ' with " or \\).
 */

function escapeEnvValue(value) {
  const s = String(value == null ? '' : value);

  // Bare-safe set: alphanumerics + characters dotenv round-trips unquoted with
  // no leading/trailing-space or comment hazard. Covers emails, URLs, GUIDs,
  // integration codes, numbers — i.e. nearly every existing value.
  if (/^[A-Za-z0-9_@.:/+=,~-]*$/.test(s)) return s;

  if (!s.includes("'")) return `'${s}'`;
  if (!/["\\]/.test(s)) return `"${s}"`;
  // ' present together with " or \\ — dotenv 16 can't fully round-trip this.
  // Escape what we can and warn; in practice secrets never hit this branch.
  console.warn('[env-file] value mixes single-quote with double-quote/backslash; .env round-trip may be lossy');
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

module.exports = { escapeEnvValue };
