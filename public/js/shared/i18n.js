/**
 * Panoptica — Frontend i18n bridge
 *
 * Loads locale strings from /api/i18n/:lang and exposes window.t() for
 * page modules + a DOM walker that processes data-i18n attributes on
 * any subtree.
 *
 * Mirror of src/i18n.js — same dot-notation keys, same {var} interpolation,
 * same simple plural rule (1 vs not-1, with optional `zero`). Server-side
 * t() and client-side t() should produce identical output for identical
 * input. If they diverge, that's a bug.
 *
 * Lifecycle:
 *   1. Script loads (in <head>, before app.js).
 *   2. boot() is called inline at the bottom — kicks off async fetch.
 *      Sets window.Panoptica.i18n.ready (a Promise) so callers can await.
 *   3. app.js, page modules, and partial renderers should call
 *      window.Panoptica.i18n.applyTo(rootEl) AFTER any DOM injection
 *      to translate elements with [data-i18n] / [data-i18n-attr-*]
 *      attributes within `rootEl`. (See data-i18n attribute conventions
 *      below.)
 *
 * data-i18n attribute conventions:
 *   <span data-i18n="nav.main_console">Main Console</span>
 *     → element textContent replaced with the translation
 *
 *   <p data-i18n-html="exemptions.explainer">Default <strong>HTML</strong> here</p>
 *     → element innerHTML replaced with the translation. Use ONLY for
 *       en.json values that legitimately contain inline tags (`<strong>`,
 *       `<code>`, `<b>`, `<em>`). Translated values are NEVER
 *       user-provided — locale files are author-controlled — so injecting
 *       them as HTML is safe within Panoptica's threat model. Do not use
 *       this for any value sourced from user input.
 *
 *   <input data-i18n-attr-placeholder="forms.search_placeholder">
 *     → the placeholder attribute is set to the translation. Generic
 *       pattern: data-i18n-attr-{attribute_name} = "{key}"
 *
 *   <span data-i18n="alerts.toast" data-i18n-params='{"count":5}'>...
 *     → params for interpolation/pluralization, JSON-encoded
 *
 * Language source of truth:
 *   1. URL param ?lang=xx (debug only — overrides everything)
 *   2. /api/user-prefs response (DB)
 *   3. localStorage 'panoptica365-prefs-lang' (cross-page fast path)
 *   4. <html lang> attribute
 *   5. fall back to 'en'
 */
(function() {
  'use strict';

  const STORAGE_KEY = 'panoptica365-prefs-lang';
  const SUPPORTED = ['en', 'fr', 'es'];

  let currentLang = 'en';
  let dictionary = {};        // Loaded locale JSON
  let readyResolve = null;
  const ready = new Promise(r => { readyResolve = r; });

  // ─── Public namespace (under window.Panoptica.i18n) ───
  // window.Panoptica is owned by app.js but app.js may not have run yet.
  // Set up a placeholder that app.js will merge with later (Panoptica
  // namespace pattern is documented in feedback memory — module-level
  // assignments to window.Panoptica risk being clobbered, so we attach
  // to a sub-namespace that app.js touches last).
  if (!window.PanopticaI18n) window.PanopticaI18n = {};

  // ─── Core ───

  function detectLang() {
    // 1. URL param (debug)
    try {
      const urlLang = new URL(location.href).searchParams.get('lang');
      if (urlLang && SUPPORTED.includes(urlLang)) return urlLang;
    } catch (_) {}

    // 2. localStorage fast path (will be confirmed/overridden by user-prefs fetch)
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && SUPPORTED.includes(stored)) return stored;
    } catch (_) {}

    // 3. <html lang>
    const htmlLang = document.documentElement.lang || '';
    const short = htmlLang.toLowerCase().split('-')[0];
    if (SUPPORTED.includes(short)) return short;

    return 'en';
  }

  async function fetchUserPrefsLang() {
    // Ask the server what the operator's saved language is. Only
    // overrides localStorage if the server has a real answer; if the
    // user isn't logged in or the call fails, keep the local guess.
    try {
      const r = await fetch('/api/user-prefs', { credentials: 'same-origin' });
      if (!r.ok) return null;
      const data = await r.json();
      const lang = data?.user?.language;
      if (lang && SUPPORTED.includes(lang)) return lang;
    } catch (_) {}
    return null;
  }

  async function fetchLocale(lang) {
    const r = await fetch('/api/i18n/' + encodeURIComponent(lang), {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!r.ok) throw new Error('Locale fetch failed: ' + r.status);
    return r.json();
  }

  function lookup(key) {
    const parts = key.split('.');
    let val = dictionary;
    for (const part of parts) {
      if (val && typeof val === 'object' && part in val) {
        val = val[part];
      } else {
        return undefined;
      }
    }
    return val;
  }

  function pluralize(value, count) {
    if (typeof value === 'string') return value;
    if (!value || typeof value !== 'object') return null;
    if (count === 0 && typeof value.zero === 'string') return value.zero;
    if (count === 1 && typeof value.one === 'string') return value.one;
    if (typeof value.other === 'string') return value.other;
    for (const k of Object.keys(value)) {
      if (typeof value[k] === 'string') return value[k];
    }
    return null;
  }

  function interpolate(str, params) {
    if (!params || typeof str !== 'string') return str;
    return str.replace(/\{(\w+)\}/g, (m, k) =>
      Object.prototype.hasOwnProperty.call(params, k) ? String(params[k]) : m);
  }

  /**
   * Translate. Returns the key itself if not found — keeps untranslated
   * strings visible during the extraction phases so we can spot what's
   * still hardcoded vs missing from en.json.
   */
  function t(key, params) {
    const val = lookup(key);
    if (val === undefined) return key;
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
   * Translate every data-i18n element within rootEl (or document).
   * Idempotent — safe to call multiple times on the same subtree.
   *
   * Three attribute conventions handled:
   *   data-i18n="key"               → set textContent (safe; no HTML)
   *   data-i18n-html="key"          → set innerHTML (preserves inline
   *                                   <strong>/<code>/<b> tags inside the
   *                                   translation value). Use sparingly;
   *                                   only for author-controlled locale
   *                                   strings.
   *   data-i18n-attr-placeholder="key" / data-i18n-attr-title="key" / etc.
   *                                 → set the named attribute
   *
   * Params (interpolation/plural) come from data-i18n-params (JSON).
   */
  function applyTo(rootEl) {
    const root = rootEl || document;

    // Text content
    const textNodes = root.querySelectorAll('[data-i18n]');
    textNodes.forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (!key) return;
      const params = readParams(el);
      el.textContent = t(key, params);
    });

    // HTML content — for translations that need to preserve embedded inline
    // markup (e.g., paragraphs with <strong> emphasis). Locale strings are
    // author-controlled (en.json/fr.json/etc. are part of the codebase, not
    // user input) so innerHTML injection is safe within our threat model.
    const htmlNodes = root.querySelectorAll('[data-i18n-html]');
    htmlNodes.forEach(el => {
      const key = el.getAttribute('data-i18n-html');
      if (!key) return;
      const params = readParams(el);
      el.innerHTML = t(key, params);
    });

    // Attribute translations: data-i18n-attr-<attr>
    const attrNodes = root.querySelectorAll('*');
    attrNodes.forEach(el => {
      // Iterate the element's attributes once; cheap because most elements
      // will have zero data-i18n-attr-* and we exit immediately.
      for (let i = 0; i < el.attributes.length; i++) {
        const a = el.attributes[i];
        if (!a.name.startsWith('data-i18n-attr-')) continue;
        const targetAttr = a.name.substring('data-i18n-attr-'.length);
        const key = a.value;
        if (!key) continue;
        const params = readParams(el);
        el.setAttribute(targetAttr, t(key, params));
      }
    });

    // Also propagate the lang on <html> so CSS / native APIs (date pickers,
    // hyphenation, etc.) get the right hint.
    if (rootEl == null || rootEl === document || rootEl === document.documentElement) {
      document.documentElement.setAttribute('lang', currentLang);
    }
  }

  function readParams(el) {
    const raw = el.getAttribute('data-i18n-params');
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (_) { return null; }
  }

  /**
   * Switch to a different language at runtime. Re-fetches the locale,
   * re-walks the entire document, then fires a 'panoptica:locale-changed'
   * event so page modules can reformat numbers/dates if needed.
   *
   * Does NOT persist to the server — that's the user-prefs PUT handler's
   * job. This function only refreshes the in-memory dictionary and DOM.
   */
  async function setLang(newLang) {
    if (!SUPPORTED.includes(newLang)) return;
    if (newLang === currentLang) return;
    try {
      const dict = await fetchLocale(newLang);
      currentLang = newLang;
      dictionary = dict;
      try { localStorage.setItem(STORAGE_KEY, newLang); } catch (_) {}
      applyTo(document);
      window.dispatchEvent(new CustomEvent('panoptica:locale-changed', {
        detail: { lang: newLang },
      }));
    } catch (e) {
      console.error('[i18n] setLang failed:', e.message);
    }
  }

  // ─── Boot ───
  async function boot() {
    currentLang = detectLang();

    // Fetch the locale immediately based on the local guess so the page
    // can render with translations on first paint. In parallel, ask the
    // server for the authoritative language; if it differs, swap in.
    let dictPromise;
    try {
      dictPromise = fetchLocale(currentLang);
      const dict = await dictPromise;
      dictionary = dict;
    } catch (e) {
      console.error('[i18n] Initial locale fetch failed:', e.message);
      dictionary = {};
    }

    // Authoritative language from server (overrides localStorage if different).
    // Don't await before resolving ready — the local guess is good enough for
    // first paint; the server-confirmed value may swap the DOM mid-frame, which
    // is the same FOUC pattern as the theme switcher.
    fetchUserPrefsLang().then(serverLang => {
      if (serverLang && serverLang !== currentLang) {
        setLang(serverLang);
      }
    });

    // Apply to whatever DOM is already present (header, sidebar, status bar).
    // app.js + page modules will call applyTo() on injected partials later.
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => applyTo(document));
    } else {
      applyTo(document);
    }

    readyResolve();
  }

  // ─── Slug-keyed lookup helpers (Phase 5) ───
  // Use case: server-side or registry-stored content (alert policy names,
  // security setting names) that we want translated WITHOUT migrating the DB
  // or registry. Pattern: derive a stable slug from the canonical English
  // string, look up `<prefix>.<slug>` in the locale, fall back to the
  // canonical English if no key exists. Adding a new alert policy or setting
  // requires no JS code change — just add the entry to en.json/fr.json.
  //
  // Slugify rules: lowercase, ASCII-only word chars, underscore-separated.
  //   "Account lockouts" → "account_lockouts"
  //   "Admin blocked by Conditional Access" → "admin_blocked_by_conditional_access"
  //   "Foreign login (non-compliant device)" → "foreign_login_non_compliant_device"
  function slugify(s) {
    if (!s) return '';
    return String(s)
      .toLowerCase()
      // Strip diacritics so French source strings (if ever used as the slug
      // basis) produce the same key regardless of locale. NFKD followed by
      // dropping combining marks (U+0300–U+036F) is the standard pattern.
      .normalize('NFKD').replace(/[̀-ͯ]/g, '')
      // Replace any non-alphanumeric run with a single underscore.
      .replace(/[^a-z0-9]+/g, '_')
      // Trim leading/trailing underscores so "(foo)" → "foo" not "_foo_".
      .replace(/^_+|_+$/g, '');
  }

  // tOrFallback(key, fallback) — convenience wrapper for the common pattern
  // "translate this key, but if the key isn't in the locale, use the
  // canonical English string from the source data." Saves callers from
  // manually checking `result === key`.
  function tOrFallback(key, fallback, params) {
    const result = t(key, params);
    return result === key ? fallback : result;
  }

  // ─── Public API ───
  Object.assign(window.PanopticaI18n, {
    t,
    applyTo,
    setLang,
    ready,
    slugify,
    tOrFallback,
    currentLang: () => currentLang,
    supported: () => SUPPORTED.slice(),
    // Expose the raw dictionary for debugging only — DO NOT mutate.
    _dict: () => dictionary,
  });

  // Convenience global for the most common case. Page modules can either
  // call window.t('nav.main_console') or window.PanopticaI18n.t(...).
  // Single-letter globals are usually a smell; t() is the universally-
  // understood convention for translation functions.
  window.t = t;

  boot();
})();
