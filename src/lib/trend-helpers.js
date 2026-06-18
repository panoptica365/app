/* ════════════════════════════════════════════════════════════════════════
 * Panoptica365 — Trend derivation helpers (shared)
 *
 * Pure functions used by BOTH the per-tenant Trends endpoint
 * (src/routes/api-tenants.js) and the fleet/global Trends endpoint
 * (src/routes/api-global-trends.js). No DB, Graph, or env dependency — safe to
 * require offline.
 *
 * The Secure-Score derivations (categoryPct, recommendationsCount) read the
 * full Microsoft Secure Score payload stored in `daily_agg_secure_score`
 * metric_value rows. They live here, in one place, so a correction after the
 * "eyeball against the Defender portal" check only has to be made once.
 * ════════════════════════════════════════════════════════════════════════ */
'use strict';

// Coerce a DB value (DECIMAL/SUM come back as strings, BIGINT counts vary) to a
// finite number; 0 on anything unusable.
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Median of a numeric array (resists the long-tail outliers that wreck a mean
// TTR). Returns null for an empty set.
function median(arr) {
  if (!arr.length) return null;
  const s = arr.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Nearest-rank percentile (p in 0..100) of a numeric array. Returns null when
// empty. Used for the fleet TTR p90 line.
function percentile(arr, p) {
  if (!arr.length) return null;
  const s = arr.slice().sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[idx];
}

// 202623 (YEARWEEK mode 3) → "2026-W23".
function isoWeekLabel(yw) {
  const s = String(yw);
  return s.length >= 6 ? `${s.slice(0, 4)}-W${s.slice(4)}` : s;
}

// Parse a stored metric_value into an object (mysql2 auto-parses JSON columns,
// but older rows can come back as strings). Returns null on anything unusable.
function parseJson(value) {
  let v = value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return null; } }
  return (v && typeof v === 'object') ? v : null;
}

// Sum each Secure Score control's points by Microsoft category, expressed as a
// % of maxScore so the stacked categories add up to the headline percentage.
// Categories are kept verbatim from Graph (Identity/Data/Device/Apps/
// Infrastructure/…); the frontend localises + colours them.
function categoryPct(controlScores, maxScore) {
  if (!Array.isArray(controlScores) || !(maxScore > 0)) return null;
  const byCat = {};
  for (const ctl of controlScores) {
    const cat = (ctl && ctl.controlCategory) ? String(ctl.controlCategory) : 'Other';
    const score = Number(ctl && ctl.score);
    if (!Number.isFinite(score)) continue;
    byCat[cat] = (byCat[cat] || 0) + score;
  }
  const out = {};
  for (const cat of Object.keys(byCat)) {
    out[cat] = Math.round((byCat[cat] / maxScore) * 1000) / 10; // 1 decimal
  }
  return out;
}

// "Recommendations addressed" — count of Microsoft improvement actions fully
// implemented vs total. Driven by each control's scoreInPercentage (>=99.5% =
// addressed). LOWER-CONFIDENCE derivation (see Trends Build Instructions §3.2):
// if no control carries scoreInPercentage we return addressed:null so the
// frontend shows the chart as unavailable rather than fabricating a count.
// Eyeball `addressed` against the Defender portal's improvement-actions count
// before trusting it.
function recommendationsCount(controlScores) {
  if (!Array.isArray(controlScores)) return { addressed: null, total: 0 };
  let total = 0, addressed = 0, sawPct = false;
  for (const ctl of controlScores) {
    if (!ctl) continue;
    total += 1;
    const sip = Number(ctl.scoreInPercentage);
    if (Number.isFinite(sip)) { sawPct = true; if (sip >= 99.5) addressed += 1; }
  }
  return { addressed: sawPct ? addressed : null, total };
}

module.exports = { num, median, percentile, isoWeekLabel, parseJson, categoryPct, recommendationsCount };
