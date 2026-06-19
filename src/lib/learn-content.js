/**
 * Panoptica365 — Learn content loader
 *
 * Reads the read-only curriculum that lives on disk under `lessons/`:
 *   lessons/<topic-slug>/topic.json
 *   lessons/<topic-slug>/<lesson-slug>.<locale>.html   (en | fr | es)
 *
 * Each lesson is a standalone HTML document; its per-lesson metadata lives in
 * the <head> as <meta name="lesson:title|subtitle|icon|last_updated" …> tags.
 * The lesson body is served directly to the browser via the /learn-assets
 * static mount (rendered in a sandboxed iframe), so this loader only parses the
 * head metadata — it never returns the body. It caches per-file by mtime, so
 * editing a lesson's meta (e.g. bumping last_updated) is picked up on the next
 * request without a server restart.
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
const fileCache = new Map();   // absolute path -> { mtimeMs, meta }
const topicCache = new Map();  // topic slug -> { mtimeMs, data }

/** Map any UI language onto a locale we actually ship; fall back to en. */
function resolveLocale(lang) {
  return LOCALES.includes(lang) ? lang : DEFAULT_LOCALE;
}

/** Decode the handful of HTML entities that can appear in a meta `content`
 *  attribute, so titles/subtitles render as authored. &amp; is decoded last
 *  to avoid double-decoding an already-decoded sequence. */
function decodeEntities(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;/gi, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Pull the per-lesson metadata from the HTML <head>. The authored files carry
 * it as <meta name="lesson:KEY" content="…"> tags (title, subtitle, icon,
 * last_updated) — the HTML successor to the old YAML frontmatter. A regex scan
 * is intentional and consistent with the lightweight-parser choice here (no DOM
 * dependency); the tags are machine-authored with a stable name-then-content
 * shape. Returns { meta }. Missing tags simply leave keys absent.
 */
function parseHtmlMeta(raw) {
  const meta = {};
  const headMatch = raw.match(/<head[\s>][\s\S]*?<\/head>/i);
  const head = headMatch ? headMatch[0] : raw;
  const re = /<meta\s+name=["']lesson:([a-z_]+)["']\s+content=["']([\s\S]*?)["']\s*\/?>/gi;
  let m;
  while ((m = re.exec(head)) !== null) {
    meta[m[1]] = decodeEntities(m[2]);
  }
  return { meta };
}

function lessonPath(topicSlug, lessonSlug, locale) {
  return path.join(LESSONS_DIR, topicSlug, `${lessonSlug}.${locale}.html`);
}

/** Does a lesson's locale file exist on disk? (Used to resolve the served URL
 *  to the actual file, with an en fallback, without reading it.) */
function lessonFileExists(topicSlug, lessonSlug, locale) {
  try {
    fs.statSync(lessonPath(topicSlug, lessonSlug, locale));
    return true;
  } catch {
    return false;
  }
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
    parsed = parseHtmlMeta(fs.readFileSync(fp, 'utf8'));
  } catch (e) {
    console.error(`[Learn] Failed to read ${fp}: ${e.message}`);
    return null;
  }
  const entry = { mtimeMs: stat.mtimeMs, meta: parsed.meta };
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
  getLessonMaxLastUpdated,
  lessonFileExists,
};
