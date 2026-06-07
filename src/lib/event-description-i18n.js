/**
 * Panoptica365 — Event description i18n renderer
 *
 * Server-side renderer for `description` columns on:
 *   - msp_audit_events       (event_descriptions.msp_audit.<key>)
 *   - tenant_change_events   (event_descriptions.tenant_change.<key>)
 *
 * Contract:
 *   - If row.template_key is set AND the locale file has a matching template,
 *     interpolate row.template_params into it and return the localized string.
 *   - Otherwise, fall back to row.description (English, as-typed by the writer).
 *
 * Why server-side: the same row is consumed by multiple surfaces (operator
 * UI, PDF report, future email/digest paths). Centralizing the render here
 * means each surface just calls renderDescription(row, lang) and gets a
 * finished string. No per-surface i18n logic to keep in sync.
 *
 * Loaded once per locale at boot (or first use); cached in-memory. The
 * locale files are static at runtime, so cache invalidation isn't a concern.
 *
 * Param interpolation is `{paramName}` — same syntax as the alert message
 * templates already in locales/*.json. Missing params render as the bare
 * placeholder text (NOT empty string) — this is intentional: a placeholder
 * stays visible so we notice the gap, an empty string would silently lie.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Locale cache. Populated lazily on first lookup. Keyed by lang code.
const _localeCache = Object.create(null);

// Default to English when an unsupported language is requested.
const SUPPORTED_LANGS = ['en', 'fr', 'es'];

// Path to the locale JSON files. The Panoptica project root is two levels up
// from src/lib/. Resolved once at module load.
const LOCALES_DIR = path.join(__dirname, '..', '..', 'locales');

function _loadLocale(lang) {
  if (lang in _localeCache) return _localeCache[lang];
  const filePath = path.join(LOCALES_DIR, `${lang}.json`);
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    _localeCache[lang] = JSON.parse(raw);
  } catch (err) {
    console.warn(`[EventI18n] Failed to load locales/${lang}.json (will fall back):`, err.message);
    _localeCache[lang] = null;
  }
  return _localeCache[lang];
}

/**
 * Look up a template under event_descriptions.<table>.<key> in the requested
 * locale, falling back to English if not present in the requested locale,
 * then to null if not present in English either.
 */
function _resolveTemplate(table, key, lang) {
  const want = SUPPORTED_LANGS.includes(lang) ? lang : 'en';
  const tryLangs = want === 'en' ? ['en'] : [want, 'en'];
  for (const l of tryLangs) {
    const locale = _loadLocale(l);
    if (!locale) continue;
    const tpl = locale.event_descriptions
      && locale.event_descriptions[table]
      && locale.event_descriptions[table][key];
    if (typeof tpl === 'string') return tpl;
  }
  return null;
}

/**
 * Interpolate {paramName} placeholders. Missing params render as the literal
 * "{paramName}" so the gap is visible rather than silently rendering empty.
 * Param values are coerced to string; null/undefined become empty.
 */
function _interpolate(template, params) {
  if (!template) return '';
  if (!params || typeof params !== 'object') return template;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, name) => {
    if (!(name in params)) return `{${name}}`;
    const v = params[name];
    return v === null || v === undefined ? '' : String(v);
  });
}

/**
 * Public API — render a row's description in the requested language.
 *
 * @param {string} table  'msp_audit' | 'tenant_change'
 * @param {object} row    must have at least { template_key, template_params, description }
 * @param {string} [lang] 'en' | 'fr' | 'es' (default 'en')
 * @returns {string}      localized description, or English fallback
 */
function renderDescription(table, row, lang = 'en') {
  if (!row) return '';

  // No template? Pure legacy row — use the bare description as the writer typed it.
  const key = row.template_key;
  if (!key) return row.description || '';

  const template = _resolveTemplate(table, String(key), lang);
  if (!template) {
    // Template referenced but missing from locale files. Console warn so we
    // notice gaps, then fall back to the English description so the operator
    // still sees something useful.
    console.warn(`[EventI18n] Missing template event_descriptions.${table}.${key} in any locale; using description fallback`);
    return row.description || '';
  }

  // template_params is JSON in the DB; mysql2 auto-parses JSON columns into
  // JS objects, but defensive parse-if-string for any caller that pre-stringified.
  let params = row.template_params;
  if (typeof params === 'string') {
    try { params = JSON.parse(params); } catch { params = null; }
  }

  return _interpolate(template, params);
}

/**
 * Convenience helpers — bind the table param so callers don't have to.
 */
function renderMspAuditDescription(row, lang = 'en') {
  return renderDescription('msp_audit', row, lang);
}

function renderTenantChangeDescription(row, lang = 'en') {
  return renderDescription('tenant_change', row, lang);
}

/**
 * Bulk helper — apply renderDescription to every row in an array, mutating
 * each row's `description` field with the localized version. Original
 * description is preserved on `description_en` for any caller that wants
 * the canonical English copy alongside the localized one.
 *
 * @param {string} table  'msp_audit' | 'tenant_change'
 * @param {object[]} rows
 * @param {string} lang
 * @returns {object[]} same array, each row mutated in place
 */
function localizeRows(table, rows, lang = 'en') {
  if (!Array.isArray(rows)) return rows;
  for (const row of rows) {
    if (!row) continue;
    const localized = renderDescription(table, row, lang);
    // Preserve canonical English so the UI / API can show both if useful.
    row.description_en = row.description;
    row.description = localized;
  }
  return rows;
}

/**
 * Test/diagnostic helper — clears the locale cache. Used by hot-reload
 * during dev when the locale files are edited at runtime.
 */
function _clearCache() {
  for (const k of Object.keys(_localeCache)) delete _localeCache[k];
}

module.exports = {
  renderDescription,
  renderMspAuditDescription,
  renderTenantChangeDescription,
  localizeRows,
  _clearCache,
};
