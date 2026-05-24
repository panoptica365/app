/**
 * Panoptica365 — App-meta API
 *
 * Read-only metadata about the running app. Mounted at /api/meta.
 *
 *   GET /api/meta/whats-new?lang=en|fr|es
 *     Returns the raw WHATS-NEW.md content + the current version. The
 *     frontend renders the markdown for the in-app "What's New" modal
 *     (v0.1.7+). The `lang` query param picks which translation to serve;
 *     unknown / missing values fall back to English (see src/version.js).
 *
 * The current version alone is already on /auth/status — no need for a
 * separate /version endpoint here.
 */

const express = require('express');
const auth = require('../auth');
const versionInfo = require('../version');

const router = express.Router();
router.use(auth.requireAuth);

router.get('/whats-new', (req, res) => {
  const lang = typeof req.query.lang === 'string' ? req.query.lang : 'en';
  res.json({
    version: versionInfo.version,
    releasedAt: versionInfo.releasedAt,
    lang,
    markdown: versionInfo.whatsNewMarkdownFor(lang),
  });
});

module.exports = router;
