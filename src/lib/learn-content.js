/**
 * Panoptica365 — Learn content loader
 *
 * Reads the read-only curriculum that lives on disk under `lessons/`:
 *   lessons/<topic-slug>/topic.json
 *   lessons/<topic-slug>/<lesson-slug>.<locale>.md   (en | fr | es, YAML frontmatter)
 *
 * Nothing here writes content — it only parses what's authored on disk and
 * caches per-file by mtime, so editing a lesson's frontmatter (e.g. bumping
 * last_updated) is picked up on the next request without a server restart.
 *
 * macOS `._*` AppleDouble sidecar files that the SMB share lists are skipped
 * (same hazard the i18n loader guards against).
 */

const fs = require('fs');
const path = require('path');

const LESSONS_DIR = path.join(__dirname, '..', '..', 'lessons');
const LOCALES = ['en', 'fr', 'es'];
const DEFAULT_LOCALE = 'en';

// mtime-keyed caches. Re-parse only when the file on disk changes.
const fileCache = new Map();   // absolute path -> { mtimeMs, meta, body }
const topicCache = new Map();  // topic slug -> { mtimeMs, data }

/** Map any UI language onto a locale we actually ship; fall back to en. */
function resolveLocale(lang) {
  return LOCALES.includes(lang) ? lang : DEFAULT_LOCALE;
}

/**
 * Parse a YAML-ish frontmatter block. The lesson frontmatter is intentionally
 * simple — flat `key: value` pairs with optionally-quoted scalars — so a full
 * YAML parser isn't warranted. Returns { meta, body } where body is the
 * markdown with the frontmatter stripped. Files with no frontmatter return
 * an empty meta and the full text as body.
 */
function parseFrontmatter(raw) {
  const m = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/);
  if (!m) return { meta: {}, body: raw };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    if (!key) continue;
    let val = line.slice(idx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    meta[key] = val;
  }
  return { meta, body: raw.slice(m[0].length) };
}

function lessonPath(topicSlug, lessonSlug, locale) {
  return path.join(LESSONS_DIR, topicSlug, `${lessonSlug}.${locale}.md`);
}

/** Read + parse a single lesson locale file (mtime-cached). null if absent. */
function readLessonFile(topicSlug, lessonSlug, locale) {
  const fp = lessonPath(topicSlug, lessonSlug, locale);
  let stat;
  try {
    stat = fs.statSync(fp);
  } catch {
    return null;
  }
  const cached = fileCache.get(fp);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached;
  let parsed;
  try {
    parsed = parseFrontmatter(fs.readFileSync(fp, 'utf8'));
  } catch (e) {
    console.error(`[Learn] Failed to read ${fp}: ${e.message}`);
    return null;
  }
  const entry = { mtimeMs: stat.mtimeMs, meta: parsed.meta, body: parsed.body };
  fileCache.set(fp, entry);
  return entry;
}

/** Read a lesson file in `locale`, falling back to en if missing. */
function readLessonFileWithFallback(topicSlug, lessonSlug, locale) {
  return (
    readLessonFile(topicSlug, lessonSlug, resolveLocale(locale)) ||
    readLessonFile(topicSlug, lessonSlug, DEFAULT_LOCALE)
  );
}

/** Parse a topic.json (mtime-cached). null if missing/invalid. */
function getTopic(slug) {
  const fp = path.join(LESSONS_DIR, slug, 'topic.json');
  let stat;
  try {
    stat = fs.statSync(fp);
  } catch {
    return null;
  }
  const cached = topicCache.get(slug);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.data;
  try {
    const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
    topicCache.set(slug, { mtimeMs: stat.mtimeMs, data });
    return data;
  } catch (e) {
    console.error(`[Learn] Failed to parse ${fp}: ${e.message}`);
    return null;
  }
}

/** All topics that have a topic.json, sorted by card_number. */
function listTopics() {
  let entries;
  try {
    entries = fs.readdirSync(LESSONS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  const topics = [];
  for (const d of entries) {
    if (!d.isDirectory()) continue;
    if (d.name.startsWith('.') || d.name.startsWith('_')) continue;
    const t = getTopic(d.name);
    if (t) topics.push(t);
  }
  topics.sort((a, b) => (a.card_number || 0) - (b.card_number || 0));
  return topics;
}

/** Resolved per-lesson metadata in the requested locale (with en fallback). */
function getLessonMeta(topicSlug, lessonSlug, locale) {
  const f = readLessonFileWithFallback(topicSlug, lessonSlug, locale);
  const meta = f ? f.meta : {};
  return {
    title: meta.title || lessonSlug,
    subtitle: meta.subtitle || '',
    icon: meta.icon || 'book-open',
    last_updated: meta.last_updated || null,
  };
}

/** Full lesson content (frontmatter stripped) in the requested locale. */
function getLessonContent(topicSlug, lessonSlug, locale) {
  const f = readLessonFileWithFallback(topicSlug, lessonSlug, locale);
  if (!f) return null;
  return {
    title: f.meta.title || lessonSlug,
    subtitle: f.meta.subtitle || '',
    icon: f.meta.icon || 'book-open',
    last_updated: f.meta.last_updated || null,
    body: f.body,
  };
}

/**
 * MAX(last_updated) across all three locale files for a lesson. last_updated
 * is an ISO date string (YYYY-MM-DD), so lexical comparison is chronological.
 * Returns a string or null. This is the single date used for both display
 * and the blue-dot / UPDATED-badge computations.
 */
function getLessonMaxLastUpdated(topicSlug, lessonSlug) {
  let max = null;
  for (const locale of LOCALES) {
    const f = readLessonFile(topicSlug, lessonSlug, locale);
    const lu = f && f.meta.last_updated;
    if (lu && (!max || lu > max)) max = lu;
  }
  return max;
}

module.exports = {
  LOCALES,
  DEFAULT_LOCALE,
  resolveLocale,
  listTopics,
  getTopic,
  getLessonMeta,
  getLessonContent,
  getLessonMaxLastUpdated,
};
