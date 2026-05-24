/**
 * Panoptica365 — Version & changelog metadata
 *
 * Reads the canonical VERSION file at repo root and the WHATS-NEW.md files
 * (one per supported UI language) ONCE at module load and caches them in
 * memory. Used by:
 *   - /auth/status  → current version + release date sent to the frontend
 *   - GET /api/meta/whats-new?lang=xx  → the raw markdown the modal renders
 *   - the in-app "see what's new" dot, toast, and sidebar badge (v0.1.7+).
 *
 * Translation policy
 * ------------------
 * `WHATS-NEW.md` is the canonical English source. Parallel files
 * `WHATS-NEW.fr.md` and `WHATS-NEW.es.md` are kept in sync (every release
 * note ships in all three languages). The English file is also used to
 * derive `releasedAt` for the current version — the date is a fact, not a
 * translation, so we don't re-parse it from each locale.
 *
 * If a locale file is missing or unreadable, `whatsNewMarkdownFor(lang)`
 * falls back to English. This means a partial translation never breaks the
 * modal — at worst the user sees the English copy.
 *
 * Format expected in WHATS-NEW.md:  `## Version X.Y.Z — YYYY-MM-DD`
 * Either em-dash (—) or plain hyphen (-) is accepted.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const VERSION_FILE = path.join(REPO_ROOT, 'VERSION');

// Locale code → filename. English is the canonical source; everything else
// is a parallel translation that we ship alongside it.
const WHATS_NEW_FILES = {
  en: path.join(REPO_ROOT, 'WHATS-NEW.md'),
  fr: path.join(REPO_ROOT, 'WHATS-NEW.fr.md'),
  es: path.join(REPO_ROOT, 'WHATS-NEW.es.md'),
};

function readVersionFile() {
  try {
    return fs.readFileSync(VERSION_FILE, 'utf8').trim();
  } catch (err) {
    console.warn('[Version] VERSION file unreadable — reporting "unknown":', err.message);
    return 'unknown';
  }
}

function readWhatsNewFile(filePath, lang) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    console.warn(`[Version] WHATS-NEW (${lang}) unreadable at ${filePath}:`, err.message);
    return '';
  }
}

function extractReleasedAt(markdown, version) {
  if (!markdown || !version || version === 'unknown') return null;
  const escaped = version.replace(/\./g, '\\.');
  // Accept either the English "Version" or its translations — the date
  // format itself is the same in every locale.
  const re = new RegExp(`##\\s*(?:Version|Versión|Versión)\\s+${escaped}\\s*[—-]\\s*(\\d{4}-\\d{2}-\\d{2})`, 'i');
  const m = markdown.match(re);
  return m ? m[1] : null;
}

const VERSION = readVersionFile();

// Load every translation up-front. Same memory cost as a single file × 3,
// and it lets us serve any language without hitting disk on each request.
const WHATS_NEW_BY_LANG = {};
for (const [lang, filePath] of Object.entries(WHATS_NEW_FILES)) {
  WHATS_NEW_BY_LANG[lang] = readWhatsNewFile(filePath, lang);
}

// English is canonical for the release-date lookup.
const RELEASED_AT = extractReleasedAt(WHATS_NEW_BY_LANG.en, VERSION);

console.log(`[Version] Panoptica365 v${VERSION}${RELEASED_AT ? ' (released ' + RELEASED_AT + ')' : ''} — locales: ${Object.keys(WHATS_NEW_BY_LANG).filter(l => WHATS_NEW_BY_LANG[l]).join(', ')}`);

/**
 * Return the WHATS-NEW markdown for the requested language. Falls back to
 * English if the requested locale is unknown or its file was unreadable.
 */
function whatsNewMarkdownFor(lang) {
  const normalized = typeof lang === 'string' ? lang.toLowerCase().slice(0, 2) : '';
  if (normalized && WHATS_NEW_BY_LANG[normalized]) {
    return WHATS_NEW_BY_LANG[normalized];
  }
  return WHATS_NEW_BY_LANG.en || '';
}

module.exports = {
  version: VERSION,
  releasedAt: RELEASED_AT,
  // Back-compat: callers that don't care about language still get English.
  whatsNewMarkdown: WHATS_NEW_BY_LANG.en || '',
  whatsNewMarkdownFor,
  // Compact shape suitable for /auth/status etc.
  asObject: () => ({ version: VERSION, releasedAt: RELEASED_AT }),
};
