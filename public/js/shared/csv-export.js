/**
 * Panoptica365 — shared CSV export helper
 *
 * Single source of truth for client-side CSV downloads (extracted from the
 * private copy that used to live in sharepoint.js). Produces UTF-8 WITH a BOM
 * (EF BB BF) so Excel for Mac/Windows auto-detects UTF-8 instead of defaulting
 * to Mac Roman / Windows-1252 and mangling French/Spanish accents. Every field
 * is double-quoted with internal quotes escaped as "". Rows are CRLF-separated
 * (RFC 4180) so fields that legitimately contain newlines (e.g. audit-log
 * descriptions) round-trip cleanly. MIME: text/csv;charset=utf-8.
 *
 * Exposed as Panoptica.downloadCsv(rows, filename)
 *   rows: Array<Array<any>> — the first row is the header. Cells are coerced to
 *         strings; null/undefined become ''.
 *
 * Attach happens in a deferred init (DOMContentLoaded / already-ready) rather
 * than at module top level: app.js runs `window.Panoptica = { ... }` during its
 * own synchronous load, which would wipe a top-level attach made before it. By
 * deferring to "ready" — which fires after every synchronous head/body script,
 * app.js included — we always add to the namespace app.js already built,
 * regardless of this file's <script> position.
 */
(function () {
  'use strict';

  function downloadCsv(rows, filename) {
    const csv = (rows || [])
      .map(r => (r || []).map(c => `"${String(c == null ? '' : c).replace(/"/g, '""')}"`).join(','))
      .join('\r\n');
    // UTF-8 BOM (EF BB BF). Without it Excel mangles accents.
    const BOM = String.fromCharCode(0xFEFF); // U+FEFF byte-order mark
    const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function attach() {
    window.Panoptica = window.Panoptica || {};
    window.Panoptica.downloadCsv = downloadCsv;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attach);
  } else {
    attach();
  }
})();
