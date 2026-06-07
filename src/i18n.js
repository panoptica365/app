/**
 * Panoptica — i18n Module
 *
 * Loads locale JSON files and provides key lookup with two extensions over
 * a plain dot-notation getter:
 *
 *   1. Interpolation: t('alerts.toast', { count: 5 }) replaces `{count}` in
 *      the source string.
 *   2. Cardinal pluralization: when params.count is provided AND the key
 *      resolves to an OBJECT with `one` / `other` (and optionally `zero`),
 *      the right form is selected. Plural rule: `count === 1 → one`,
 *      `count === 0 && zero exists → zero`, otherwise `other`.
 *
 *      en, fr-CA, and es all share this simple rule (1 vs not-1) — fancier
 *      languages (Russian, Polish, Arabic) would need a per-language plural
 *      function. We're not in scope for those today; if Panoptica ever
 *      ships in one, swap this rule for Intl.PluralRules.
 *
 * Backwards compatible: t(key) and t(key, langString) still work exactly
 * as before. The new optional params object is detected by typeof.
 *
 * Frontend mirror: public/js/shared/i18n.js implements the same two
 * extensions in the browser so server-rendered and client-rendered text
 * stay consistent.
 */

const fs = require('fs');
const path = require('path');

const localesDir = path.join(__dirname, '..', 'locales');
const locales = {};

/**
 * Load all available locale files. Idempotent — safe to call again to
 * pick up edits to a JSON file without restarting the server.
 */
function loadLocales() {
  // Filter `._*` to skip macOS Finder resource fork files that the SMB
  // share lists but can't actually open (ENOENT on read).
  const files = fs.readdirSync(localesDir).filter(f => f.endsWith('.json') && !f.startsWith('._'));
  // Reset before reload so a deleted locale is removed from memory too.
  for (const k of Object.keys(locales)) delete locales[k];
  for (const file of files) {
    const lang = path.basename(file, '.json');
    try {
      locales[lang] = JSON.parse(fs.readFileSync(path.join(localesDir, file), 'utf8'));
    } catch (e) {
      // A broken locale file should be loud, not silent — but it should not
      // crash the server. Log and skip; the failing language falls back to
      // en (or to the key itself if en is also broken).
      console.error(`[i18n] Failed to load ${file}: ${e.message}`);
    }
  }
}

/**
 * Interpolate `{name}` placeholders. Missing params leave the placeholder
 * intact so a typo is visible rather than silently rendering "undefined".
 */
function interpolate(str, params) {
  if (!params || typeof str !== 'string') return str;
  return str.replace(/\{(\w+)\}/g, (match, key) => {
    return Object.prototype.hasOwnProperty.call(params, key)
      ? String(params[key])
      : match;
  });
}

/**
 * Pick the plural form. `value` is whatever the dot-notation lookup landed
 * on — could be a string (no plural variants) or an object with `one` /
 * `other` / `zero` keys. Returns a string.
 */
function pluralize(value, count) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return null;
  if (count === 0 && typeof value.zero === 'string') return value.zero;
  if (count === 1 && typeof value.one === 'string') return value.one;
  if (typeof value.other === 'string') return value.other;
  // Fallback: pick whatever string variant exists, else null.
  for (const k of Object.keys(value)) {
    if (typeof value[k] === 'string') return value[k];
  }
  return null;
}

/**
 * Translate a dot-notation key.
 *
 * Signatures (all backwards compatible with prior call sites):
 *   t('nav.main_console')                           → "Main Console"
 *   t('nav.main_console', 'fr')                     → "Console principale" (when fr.json exists)
 *   t('alerts.toast', { count: 3 })                 → string with {count} replaced
 *   t('alerts.toast', { count: 3, lang: 'fr' })     → French + interpolated
 *
 * If the second arg is a string it's the language (legacy). If it's an
 * object, params.lang (if present) is the language and the rest are
 * interpolation values; params.count drives plural selection.
 */
function t(key, paramsOrLang) {
  let lang = 'en';
  let params = null;

  if (typeof paramsOrLang === 'string') {
    lang = paramsOrLang;
  } else if (paramsOrLang && typeof paramsOrLang === 'object') {
    params = paramsOrLang;
    if (typeof params.lang === 'string') lang = params.lang;
  }

  const locale = locales[lang] || locales['en'];
  if (!locale) return key;

  const parts = key.split('.');
  let val = locale;
  for (const part of parts) {
    if (val && typeof val === 'object' && part in val) {
      val = val[part];
    } else {
      // Try the en fallback before giving up — useful when a non-en locale
      // is missing a freshly added key.
      if (lang !== 'en' && locales['en']) {
        return t(key, params ? { ...params, lang: 'en' } : 'en');
      }
      return key;
    }
  }

  // If params.count is provided, accept either a string or a plural object.
  let resolved;
  if (params && typeof params.count === 'number') {
    resolved = pluralize(val, params.count);
    if (resolved == null) resolved = (typeof val === 'string') ? val : key;
  } else {
    resolved = (typeof val === 'string') ? val : key;
  }

  return interpolate(resolved, params);
}

/**
 * Get the full locale object for a language (used by frontend fetch
 * /api/i18n/:lang). Returns en if the requested lang is missing.
 */
function getLocale(lang = 'en') {
  return locales[lang] || locales['en'] || {};
}

/**
 * List available languages — driven by what's on disk in locales/.
 */
function availableLanguages() {
  return Object.keys(locales);
}

// Load on require
loadLocales();

module.exports = { t, getLocale, availableLanguages, loadLocales };
