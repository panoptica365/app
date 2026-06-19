/**
 * Panoptica365 — Learn API
 *
 * Read-only curriculum browsing + per-user "viewed" state. Content is parsed
 * from disk by src/lib/learn-content.js; view state lives in the
 * `user_lesson_views` table (one row per user × lesson).
 *
 * Mounted at /api/learn in server.js. All endpoints require auth only — the
 * Learn section is educational and available to every role (viewer included).
 * The only write here is the per-user "mark viewed" upsert, which is scoped
 * to the caller's own row.
 *
 * Schema convention (Decision #89): the table this module owns is created via
 * an idempotent ensure*() run on module load, not a manual SQL script.
 */

const express = require('express');
const auth = require('../auth');
const db = require('../db/database');
const learn = require('../lib/learn-content');

const router = express.Router();
router.use(auth.requireAuth);

const RECENT_UPDATE_DAYS = 14;

// ─── Schema (idempotent, runs on module load) ───
async function ensureLearnSchema() {
  // user_id matches users.id (INT UNSIGNED). No FK constraint — keeps boot
  // order independent of users-store and other tables don't rely on FKs here
  // either (the spec explicitly allows skipping it).
  await db.query(`
    CREATE TABLE IF NOT EXISTS user_lesson_views (
      user_id   INT UNSIGNED NOT NULL,
      lesson_id VARCHAR(255) NOT NULL,
      viewed_at DATETIME NOT NULL,
      PRIMARY KEY (user_id, lesson_id),
      INDEX idx_user (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}
ensureLearnSchema().catch((err) =>
  console.error('[Learn] ensureLearnSchema failed:', err.message)
);

// ─── Helpers ───

function localeFromReq(req) {
  return learn.resolveLocale(req.query.lang || req.session?.user?.language || 'en');
}

function pick(map, locale) {
  if (!map || typeof map !== 'object') return '';
  return map[locale] || map[learn.DEFAULT_LOCALE] || '';
}

/** Parse a 'YYYY-MM-DD HH:MM:SS' (UTC) or 'YYYY-MM-DD' string to epoch ms. */
function toUtcMs(s) {
  if (!s) return null;
  // DB DATETIME comes back as 'YYYY-MM-DD HH:MM:SS' (stored via UTC_TIMESTAMP),
  // frontmatter dates as 'YYYY-MM-DD'. Normalize both to an explicit UTC instant.
  const iso = s.includes(' ')
    ? s.replace(' ', 'T') + 'Z'
    : s + 'T00:00:00Z';
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/** A lesson is unread if never viewed, or viewed before its latest update. */
function isUnread(viewedAt, maxLastUpdated) {
  if (!viewedAt) return true;
  const v = toUtcMs(viewedAt);
  const u = toUtcMs(maxLastUpdated);
  if (u == null) return false; // no update date and it's been viewed → read
  if (v == null) return true;
  return v < u;
}

/** A lesson has a recent update if its last_updated is within the window. */
function isRecentUpdate(maxLastUpdated) {
  const u = toUtcMs(maxLastUpdated);
  if (u == null) return false;
  return Date.now() - u <= RECENT_UPDATE_DAYS * 24 * 60 * 60 * 1000;
}

/** Load all of the caller's view timestamps as a Map<lesson_id, viewed_at>. */
async function loadViews(userId) {
  const map = new Map();
  if (!userId) return map; // session predates the users table — treat all unread
  const rows = await db.queryRows(
    'SELECT lesson_id, viewed_at FROM user_lesson_views WHERE user_id = ?',
    [userId]
  );
  for (const r of rows) map.set(r.lesson_id, r.viewed_at);
  return map;
}

/** Per-lesson state used by both the topic and lesson list endpoints. */
function lessonState(topicSlug, lessonSlug, viewsMap) {
  const lessonId = `${topicSlug}/${lessonSlug}`;
  const maxLU = learn.getLessonMaxLastUpdated(topicSlug, lessonSlug);
  const viewedAt = viewsMap.get(lessonId) || null;
  return {
    lessonId,
    maxLastUpdated: maxLU,
    hasUnread: isUnread(viewedAt, maxLU),
    hasRecentUpdate: isRecentUpdate(maxLU),
  };
}

// ─── GET /api/learn/topics ───
router.get('/topics', async (req, res) => {
  try {
    const locale = localeFromReq(req);
    const userId = req.session?.user?.internal_user_id;
    const viewsMap = await loadViews(userId);

    const topics = learn.listTopics().map((t) => {
      let hasUnread = false;
      let hasRecentUpdate = false;
      let maxLU = null;
      for (const lessonSlug of t.lessons || []) {
        const st = lessonState(t.slug, lessonSlug, viewsMap);
        if (st.hasUnread) hasUnread = true;
        if (st.hasRecentUpdate) hasRecentUpdate = true;
        if (st.maxLastUpdated && (!maxLU || st.maxLastUpdated > maxLU)) {
          maxLU = st.maxLastUpdated;
        }
      }
      return {
        slug: t.slug,
        card_number: t.card_number,
        icon: t.icon,
        title: pick(t.titles, locale),
        subtitle: pick(t.subtitles, locale),
        last_updated: maxLU,
        has_unread: hasUnread,
        has_recent_update: hasRecentUpdate,
      };
    });

    res.json({ topics });
  } catch (err) {
    console.error('[Learn] GET /topics failed:', err.message);
    res.status(500).json({ error: 'Failed to load topics' });
  }
});

// ─── GET /api/learn/topics/:topicSlug/lessons ───
router.get('/topics/:topicSlug/lessons', async (req, res) => {
  try {
    const { topicSlug } = req.params;
    const locale = localeFromReq(req);
    const topic = learn.getTopic(topicSlug);
    if (!topic) return res.status(404).json({ error: 'Topic not found' });

    const userId = req.session?.user?.internal_user_id;
    const viewsMap = await loadViews(userId);

    const lessons = (topic.lessons || []).map((slug) => {
      const meta = learn.getLessonMeta(topicSlug, slug, locale);
      const st = lessonState(topicSlug, slug, viewsMap);
      return {
        slug,
        lesson_id: st.lessonId,
        icon: meta.icon,
        title: meta.title,
        subtitle: meta.subtitle,
        last_updated: st.maxLastUpdated,
        has_unread: st.hasUnread,
        has_recent_update: st.hasRecentUpdate,
      };
    });

    res.json({
      topic: {
        slug: topic.slug,
        title: pick(topic.titles, locale),
        subtitle: pick(topic.subtitles, locale),
        icon: topic.icon,
      },
      lessons,
    });
  } catch (err) {
    console.error('[Learn] GET /topics/:slug/lessons failed:', err.message);
    res.status(500).json({ error: 'Failed to load lessons' });
  }
});

// ─── GET /api/learn/lessons/:topicSlug/:lessonSlug ───
router.get('/lessons/:topicSlug/:lessonSlug', async (req, res) => {
  try {
    const { topicSlug, lessonSlug } = req.params;
    const topic = learn.getTopic(topicSlug);
    if (!topic || !(topic.lessons || []).includes(lessonSlug)) {
      return res.status(404).json({ error: 'Lesson not found' });
    }
    const locale = localeFromReq(req);
    // Serve the locale the operator asked for, falling back to en only if that
    // file is genuinely missing (all three exist today). The iframe loads the
    // file directly from the /learn-assets static mount.
    const served = learn.lessonFileExists(topicSlug, lessonSlug, locale)
      ? locale
      : learn.DEFAULT_LOCALE;
    const meta = learn.getLessonMeta(topicSlug, lessonSlug, served);

    res.json({
      lesson_id: `${topicSlug}/${lessonSlug}`,
      topic_slug: topicSlug,
      slug: lessonSlug,
      title: meta.title,
      subtitle: meta.subtitle,
      last_updated: learn.getLessonMaxLastUpdated(topicSlug, lessonSlug),
      html_url: `/learn-assets/${encodeURIComponent(topicSlug)}/${encodeURIComponent(lessonSlug)}.${served}.html`,
    });
  } catch (err) {
    console.error('[Learn] GET /lessons/:topic/:lesson failed:', err.message);
    res.status(500).json({ error: 'Failed to load lesson' });
  }
});

// ─── POST /api/learn/views ───
router.post('/views', async (req, res) => {
  try {
    const lessonId = (req.body && req.body.lesson_id) || '';
    // Shape: <topic-slug>/<lesson-slug>. Validate against real content so a
    // bogus id can't pollute the table.
    const parts = String(lessonId).split('/');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      return res.status(400).json({ error: 'Invalid lesson_id' });
    }
    const [topicSlug, lessonSlug] = parts;
    const topic = learn.getTopic(topicSlug);
    if (!topic || !(topic.lessons || []).includes(lessonSlug)) {
      return res.status(404).json({ error: 'Lesson not found' });
    }

    const userId = req.session?.user?.internal_user_id;
    // No users-table row (login predates the users table) — can't record
    // per-user state. Succeed silently so the modal flow isn't broken.
    if (!userId) return res.json({ ok: true });

    // UTC_TIMESTAMP() not NOW() — MySQL session is on Eastern, datetimes are
    // stored UTC (project convention feedback_mysql_utc_timestamp).
    await db.execute(
      `INSERT INTO user_lesson_views (user_id, lesson_id, viewed_at)
       VALUES (?, ?, UTC_TIMESTAMP())
       ON DUPLICATE KEY UPDATE viewed_at = UTC_TIMESTAMP()`,
      [userId, lessonId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[Learn] POST /views failed:', err.message);
    res.status(500).json({ error: 'Failed to record view' });
  }
});

module.exports = router;
