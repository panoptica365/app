/**
 * Panoptica — HTML Partial Routes
 * Serves HTML fragments for the AJAX SPA navigation.
 * Each route returns an HTML partial (no <html>/<body> tags).
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const auth = require('../auth');

const router = express.Router();
const partialsDir = path.join(__dirname, '..', '..', 'public', 'partials');

// All partials require authentication
router.use(auth.requireAuth);

/**
 * Helper — serve a static HTML partial file.
 */
function servePartial(filename) {
  return (req, res) => {
    const filePath = path.join(partialsDir, filename);
    if (fs.existsSync(filePath)) {
      res.sendFile(filePath);
    } else {
      res.status(404).send('<div class="panel-error">Page not found.</div>');
    }
  };
}

// ─── Main Console ───
router.get('/main-console', servePartial('main-console.html'));

// ─── Daily Activity (Phase 8) ───
router.get('/daily-activity', servePartial('daily-activity.html'));

// ─── Tenant Management ───
router.get('/tenants', servePartial('tenants.html'));

// ─── Tenant Dashboard (per-tenant view) ───
router.get('/tenant-dashboard', servePartial('tenant-dashboard.html'));

// ─── Alert Dashboard ───
router.get('/alerts', servePartial('alerts.html'));

// ─── Heatmap (multi-tenant posture roll-up) ───
// Read-only, visible to all tiers (requireAuth via router.use above; no admin gate).
router.get('/heatmap', servePartial('heatmap.html'));

// ─── Reports ───
router.get('/reports', servePartial('reports.html'));

// ─── SharePoint (ported from Tabula Accessus) ───
router.get('/sharepoint', servePartial('sharepoint.html'));

// ─── Learn (curriculum / Learning Hub) ───
router.get('/learn', servePartial('learn.html'));

// ─── CA Templates ───
router.get('/ca-templates', servePartial('ca-templates.html'));

// ─── Intune Templates ───
router.get('/intune-templates', servePartial('intune-templates.html'));

// ─── Security Settings (Phase A1) ───
router.get('/security', servePartial('security.html'));

// ─── Alert Policies ───
router.get('/alert-policies', servePartial('alert-policies.html'));

// ─── CA Exemptions (Phase 3) ───
router.get('/exemptions', servePartial('exemptions.html'));

// ─── Settings (Admin-only) ───
// A3 (May 9, 2026): admin-only — System section page partial.
router.get('/settings', auth.requireAdmin, servePartial('settings.html'));

// ─── Audit Log (Admin-only) ───
// Gated by requireAdmin — non-admins get 403 HTML, which the SPA surfaces as
// "access denied" rather than wiping their session.
router.get('/audit-log', auth.requireAdmin, servePartial('audit-log.html'));

module.exports = router;
