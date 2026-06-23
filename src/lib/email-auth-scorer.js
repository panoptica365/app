/**
 * Panoptica365 — Email-auth deterministic scorer (Feature A6 §8)
 *
 * THE contract that keeps the gauge defensible: same unchanged domain →
 * identical score every run. Code computes the gauge; the AI writes prose only
 * (see `ai_analysis_overhaul`, the Secure Score lesson). Never let an LLM near
 * this number.
 *
 * Input  : the `records` object produced by dns-reader.readDomain() + the
 *          detected-providers object.
 * Output : { findings, overall_score (0-100), grade (A-F), non_mail, scored_weight }
 *          where findings[mech] = { status, sub_score (0..1), weight,
 *          detail_key, detail_params, excluded }.
 *
 * Renormalization (§8): mechanisms we genuinely can't judge are EXCLUDED from
 * the denominator rather than scored 0 — DKIM `indeterminate` (unprobeable
 * selector) and DNSSEC `unknown` (Node can't read the AD bit). Excluding, not
 * zeroing, is what stops a false low grade.
 *
 * Pure + I/O-free → unit-testable in isolation (see test/email-auth-scorer.test.js).
 */

'use strict';

// Starting weights (§8). Tunable — NOT magic numbers scattered through the code.
// Big-three (SPF/DKIM/DMARC) = 72 of 100, honouring "most weight on the three".
// BIMI + DANE are intentionally NOT scored or displayed: almost no SMB tenant
// configures them, so penalizing their absence (or cluttering the UI) is noise.
// dns-reader no longer reads them either. Re-add here + in the reader/UI if a
// customer ever needs them.
const WEIGHTS = Object.freeze({
  spf: 22, dkim: 22, dmarc: 28, mx: 8,
  dnssec: 7, mta_sts: 6, tls_rpt: 3,
});

// Grade bands (§8, tunable). First band whose floor is met wins.
const GRADE_BANDS = Object.freeze([
  { grade: 'A', min: 90 }, { grade: 'B', min: 75 }, { grade: 'C', min: 60 },
  { grade: 'D', min: 40 }, { grade: 'F', min: 0 },
]);

function gradeFor(score) {
  for (const b of GRADE_BANDS) if (score >= b.min) return b.grade;
  return 'F';
}

function f(status, sub_score, detail_key, detail_params = {}, excluded = false) {
  return { status, sub_score, detail_key, detail_params, excluded };
}

// ── Per-mechanism scorers (each returns a finding sans weight) ───────────────

function scoreSpf(spf) {
  if (!spf || !spf.present) return f('fail', 0, 'spf_missing');
  const term = spf.terminal;
  if (term === '+all') return f('fail', 0, 'spf_passall'); // catastrophic — allows anyone
  if (spf.lookup_overflow) {
    // Published but exceeds the RFC 7208 10-lookup cap → validators may PermError.
    return f('partial', 0.5, 'spf_lookup_overflow', { lookups: spf.lookups });
  }
  if (term === '-all') return f('pass', 1, 'spf_hardfail', { lookups: spf.lookups });
  if (term === '~all') return f('partial', 0.6, 'spf_softfail', { lookups: spf.lookups });
  if (term === '?all' || term === null) return f('partial', 0.4, 'spf_neutral', { lookups: spf.lookups });
  return f('partial', 0.4, 'spf_neutral', { lookups: spf.lookups });
}

function scoreDkim(dkim) {
  const state = dkim && dkim.state;
  if (state === 'pass') {
    if (dkim.weakKey) return f('partial', 0.7, 'dkim_pass_weak', { provider: dkim.passProvider || '' });
    return f('pass', 1, 'dkim_pass', { provider: dkim.passProvider || '' });
  }
  if (state === 'fail') {
    if (dkim.revoked) return f('fail', 0, 'dkim_revoked', { provider: dkim.expectedLabel || '' });
    if (dkim.testMode) return f('fail', 0, 'dkim_testmode', { provider: dkim.expectedLabel || '' });
    return f('fail', 0, 'dkim_provider_missing', { provider: dkim.expectedLabel || '' });
  }
  // indeterminate — unprobeable selector. EXCLUDE from denominator (§7a/§8).
  return f('indeterminate', 0, 'dkim_indeterminate', { provider: dkim && dkim.expectedLabel || '' }, true);
}

function scoreDmarc(dmarc) {
  if (!dmarc || !dmarc.present) return f('fail', 0, 'dmarc_missing');
  const p = (dmarc.p || '').toLowerCase();
  let base, status, key;
  if (p === 'reject') { base = 1.0; status = 'pass'; key = 'dmarc_reject'; }
  else if (p === 'quarantine') { base = 0.75; status = 'partial'; key = 'dmarc_quarantine'; }
  else if (p === 'none') { base = dmarc.rua && dmarc.rua.length ? 0.4 : 0.3; status = 'partial'; key = 'dmarc_none'; }
  else { return f('fail', 0, 'dmarc_no_policy'); }
  // Small penalties: pct<100 dilutes enforcement; no rua = blind to abuse.
  const params = { p, pct: dmarc.pct == null ? 100 : dmarc.pct, rua: !!(dmarc.rua && dmarc.rua.length) };
  if (dmarc.pct != null && dmarc.pct < 100) base -= 0.1;
  if (!(dmarc.rua && dmarc.rua.length)) base -= 0.1;
  base = Math.max(0, Math.min(1, base));
  return f(status, base, key, params);
}

function scoreMx(mx) {
  if (!mx || !mx.present) return f('absent', 0, 'mx_absent'); // gate handled by caller (non-mail)
  return f('pass', 1, 'mx_present', { count: (mx.hosts || []).length });
}

function scoreDnssec(dnssec) {
  const s = dnssec && dnssec.status;
  if (s === 'enabled') return f('pass', 1, 'dnssec_enabled');
  if (s === 'disabled') return f('fail', 0, 'dnssec_disabled');
  // 'unknown' — Node can't read the AD bit on this resolver. Exclude, don't penalize.
  return f('indeterminate', 0, 'dnssec_unknown', {}, true);
}

function scoreMtaSts(mta) {
  if (!mta || !mta.present) return f('absent', 0, 'mta_sts_absent');
  if (mta.mode === 'enforce') return f('pass', 1, 'mta_sts_enforce');
  if (mta.mode === 'testing') return f('partial', 0.5, 'mta_sts_testing');
  return f('partial', 0.3, 'mta_sts_present');
}

function scoreTlsRpt(tls) {
  return (tls && tls.present) ? f('pass', 1, 'tls_rpt_present') : f('absent', 0, 'tls_rpt_absent');
}

/**
 * Score a domain that does NOT receive mail (no MX). Per §8/§14 the big-three
 * are N/A — instead we measure ANTI-SPOOF posture: a parked domain should
 * publish `v=spf1 -all` + `p=reject` so it can't be impersonated. The gauge for
 * a non-mail domain therefore reflects exactly that, and is A when locked down.
 */
function scoreNonMail(records) {
  const spf = records.spf || {};
  const dmarc = records.dmarc || {};
  const spfHard = spf.present && spf.terminal === '-all';
  const p = (dmarc.p || '').toLowerCase();
  const dmarcStrong = dmarc.present && (p === 'reject' ? 1 : p === 'quarantine' ? 0.6 : 0);

  const spfPart = spfHard ? 1 : 0;
  const overall = Math.round(100 * (spfPart * 0.5 + (dmarcStrong || 0) * 0.5));

  const findings = {
    mx: { ...f('na', 0, 'mx_non_mail'), weight: WEIGHTS.mx, excluded: true },
    spf: {
      ...(spfHard ? f('pass', 1, 'nonmail_spf_locked')
                  : f('advisory', 0, 'nonmail_spf_advisory')),
      weight: WEIGHTS.spf,
    },
    dmarc: {
      ...(p === 'reject' ? f('pass', 1, 'nonmail_dmarc_locked')
          : p === 'quarantine' ? f('partial', 0.6, 'nonmail_dmarc_quarantine')
          : f('advisory', 0, 'nonmail_dmarc_advisory')),
      weight: WEIGHTS.dmarc,
    },
    dkim: { ...f('na', 0, 'dkim_non_mail'), weight: WEIGHTS.dkim, excluded: true },
  };
  return { findings, overall_score: overall, grade: gradeFor(overall), non_mail: true, scored_weight: WEIGHTS.spf + WEIGHTS.dmarc };
}

/**
 * Main entry. Deterministic.
 * @param {object} records  dns-reader.readDomain() output
 * @returns {{findings, overall_score, grade, non_mail, scored_weight}}
 */
function scoreDomain(records) {
  if (!records) throw new Error('scoreDomain: records required');

  // MX gate (§8): no MX → non-mail domain, anti-spoof model.
  if (!records.mx || !records.mx.present) {
    return scoreNonMail(records);
  }

  // A secondary mechanism that failed to read (dns-reader marked it read_error)
  // is EXCLUDED, never scored 0 — so a transient SERVFAIL can't crater the gauge
  // (the other half of the v0.1.23 guard; the drift engine likewise skips it).
  const re = (record, scorer) =>
    (record && record.read_error) ? f('unknown', 0, 'read_error', {}, true) : scorer(record);

  const raw = {
    spf: scoreSpf(records.spf),
    dkim: scoreDkim(records.dkim),
    dmarc: re(records.dmarc, scoreDmarc),
    mx: scoreMx(records.mx),
    dnssec: scoreDnssec(records.dnssec),
    mta_sts: re(records.mta_sts, scoreMtaSts),
    tls_rpt: re(records.tls_rpt, scoreTlsRpt),
  };

  const findings = {};
  let num = 0;
  let den = 0;
  for (const [mech, finding] of Object.entries(raw)) {
    const weight = WEIGHTS[mech];
    findings[mech] = { ...finding, weight };
    if (finding.excluded) continue; // renormalize: drop from denominator
    num += finding.sub_score * weight;
    den += weight;
  }

  const overall = den > 0 ? Math.round((num / den) * 100) : 0;
  return { findings, overall_score: overall, grade: gradeFor(overall), non_mail: false, scored_weight: den };
}

module.exports = {
  scoreDomain,
  gradeFor,
  WEIGHTS,
  GRADE_BANDS,
  // exported for unit tests
  scoreSpf, scoreDkim, scoreDmarc, scoreMx, scoreDnssec,
};
