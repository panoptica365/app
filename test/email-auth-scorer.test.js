/**
 * Unit tests for the pure email-auth logic (Feature A6):
 *   - src/lib/email-auth-scorer.js  (deterministic gauge — THE contract)
 *   - src/lib/email-auth-store.js   (regression diff + findings hash, I/O-free)
 *
 * Run: node --test test/email-auth-scorer.test.js
 *
 * Per house rule these offline tests are NOT the ship gate (a real network read
 * is — see the build doc §15), but they pin the scoring + drift math so a
 * refactor can't silently change the gauge or manufacture false drift.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const scorer = require('../src/lib/email-auth-scorer');
const store = require('../src/lib/email-auth-store');
const reader = require('../src/lib/dns-reader');

// ── Fixtures ──────────────────────────────────────────────────────────────────
function cleanM365() {
  return {
    mx: { present: true, hosts: [{ exchange: 'x.mail.protection.outlook.com', priority: 0 }] },
    spf: { present: true, raw: 'v=spf1 include:spf.protection.outlook.com -all', terminal: '-all', includes: ['spf.protection.outlook.com'], lookups: 3, lookup_overflow: false },
    dkim: { state: 'pass', passProvider: 'Microsoft 365', weakKey: false, selectorsFound: [{ selector: 'selector1' }] },
    dmarc: { present: true, raw: 'v=DMARC1; p=reject; rua=mailto:r@x', p: 'reject', pct: 100, rua: ['mailto:r@x'] },
    dnssec: { status: 'unknown' }, mta_sts: { present: false }, tls_rpt: { present: false }, bimi: { present: false }, dane: { present: false },
    detected_providers: { all: ['microsoft365'] },
  };
}
const clone = (o) => JSON.parse(JSON.stringify(o));

// ── Scorer: determinism + renormalization ──────────────────────────────────────
test('clean M365 scores high, DKIM passes, DNSSEC-unknown is excluded', () => {
  const r = scorer.scoreDomain(cleanM365());
  assert.strictEqual(r.findings.dkim.status, 'pass');
  assert.strictEqual(r.findings.dnssec.excluded, true);
  assert.ok(r.overall_score >= 80, `expected >=80, got ${r.overall_score}`);
  assert.ok(['A', 'B'].includes(r.grade));
});

test('scoring is deterministic (same input → identical score)', () => {
  const a = scorer.scoreDomain(cleanM365());
  const b = scorer.scoreDomain(cleanM365());
  assert.strictEqual(a.overall_score, b.overall_score);
  assert.strictEqual(a.grade, b.grade);
});

test('M365 detected but DKIM missing → hard DKIM fail (the headline case)', () => {
  const d = clone(cleanM365());
  d.dkim = { state: 'fail', expectedLabel: 'Microsoft 365', revoked: false };
  const r = scorer.scoreDomain(d);
  assert.strictEqual(r.findings.dkim.status, 'fail');
  assert.strictEqual(r.findings.dkim.sub_score, 0);
  assert.strictEqual(r.findings.dkim.detail_key, 'dkim_provider_missing');
  // worse than the clean domain
  assert.ok(r.overall_score < scorer.scoreDomain(cleanM365()).overall_score);
});

test('indeterminate DKIM is EXCLUDED from the denominator (not punished)', () => {
  const d = clone(cleanM365());
  d.dkim = { state: 'indeterminate', expectedLabel: 'Amazon SES' };
  const r = scorer.scoreDomain(d);
  assert.strictEqual(r.findings.dkim.excluded, true);
  // total weight 96 (BIMI/DANE removed), minus DNSSEC-unknown (7) + indeterminate DKIM (22)
  assert.strictEqual(r.scored_weight, 96 - 7 - 22);
  // and the score is HIGHER than if it were a fail (which would score 0/93)
  const failVariant = clone(cleanM365()); failVariant.dkim = { state: 'fail', expectedLabel: 'X' };
  assert.ok(r.overall_score > scorer.scoreDomain(failVariant).overall_score);
});

test('read_error mechanism is excluded, never scored 0 (v0.1.23 guard)', () => {
  const d = clone(cleanM365());
  d.dmarc = { read_error: true, present: false };
  const r = scorer.scoreDomain(d);
  assert.strictEqual(r.findings.dmarc.excluded, true);
  assert.strictEqual(r.findings.dmarc.detail_key, 'read_error');
  // excluded (52/65=80), NOT zeroed (which would be 52/93=56)
  assert.ok(r.overall_score >= 75, `expected excluded not zeroed, got ${r.overall_score}`);
});

// ── Scorer: SPF / DMARC bands ───────────────────────────────────────────────────
test('SPF terminal bands: -all full, ~all partial, +all zero, missing zero', () => {
  const mk = (spf) => { const d = clone(cleanM365()); d.spf = spf; return scorer.scoreDomain(d).findings.spf; };
  assert.strictEqual(mk({ present: true, terminal: '-all', lookups: 2 }).status, 'pass');
  assert.strictEqual(mk({ present: true, terminal: '~all', lookups: 2 }).status, 'partial');
  assert.strictEqual(mk({ present: true, terminal: '+all', lookups: 2 }).sub_score, 0);
  assert.strictEqual(mk({ present: false }).status, 'fail');
});

test('DMARC policy bands: reject > quarantine > none', () => {
  const mk = (p) => { const d = clone(cleanM365()); d.dmarc = { present: true, p, pct: 100, rua: ['mailto:r@x'] }; return scorer.scoreDomain(d).findings.dmarc.sub_score; };
  assert.ok(mk('reject') > mk('quarantine'));
  assert.ok(mk('quarantine') > mk('none'));
});

// ── Scorer: non-mail (anti-spoof) model ─────────────────────────────────────────
test('non-mail domain: locked down (-all + p=reject) scores A; bare scores F', () => {
  const locked = scorer.scoreDomain({ mx: { present: false, hosts: [] }, spf: { present: true, terminal: '-all' }, dmarc: { present: true, p: 'reject' }, dnssec: { status: 'unknown' } });
  assert.strictEqual(locked.non_mail, true);
  assert.strictEqual(locked.grade, 'A');
  const bare = scorer.scoreDomain({ mx: { present: false, hosts: [] }, spf: { present: false }, dmarc: { present: false }, dnssec: { status: 'unknown' } });
  assert.strictEqual(bare.non_mail, true);
  assert.strictEqual(bare.findings.spf.status, 'advisory');
  assert.ok(bare.overall_score < locked.overall_score);
});

// ── Store: regression diff ──────────────────────────────────────────────────────
function snap(records, findings) { return { records, findings }; }

test('detectRegressions: DMARC reject→none fires a high drift', () => {
  const prev = snap({ dmarc: { present: true, p: 'reject' } }, { dkim: { status: 'pass' } });
  const next = snap({ dmarc: { present: true, p: 'none' } }, { dkim: { status: 'pass' } });
  const ev = store.detectRegressions(prev, next).filter(e => e.mechanism === 'dmarc');
  assert.strictEqual(ev.length, 1);
  assert.strictEqual(ev[0].severity, 'high');
  assert.strictEqual(ev[0].positive, undefined === ev[0].positive ? false : ev[0].positive); // not positive
  assert.strictEqual(ev[0].positive, false);
});

test('detectRegressions: DKIM pass→fail fires, but pass→indeterminate does NOT', () => {
  const base = { dmarc: { present: true, p: 'reject' } };
  const failEv = store.detectRegressions(snap(base, { dkim: { status: 'pass' } }), snap(base, { dkim: { status: 'fail' } }));
  assert.ok(failEv.some(e => e.mechanism === 'dkim'));
  const indetEv = store.detectRegressions(snap(base, { dkim: { status: 'pass' } }), snap(base, { dkim: { status: 'indeterminate' } }));
  assert.ok(!indetEv.some(e => e.mechanism === 'dkim'), 'pass→indeterminate must NOT fire drift');
});

test('detectRegressions: a read_error on the new snapshot is skipped (no false drift)', () => {
  const prev = snap({ dmarc: { present: true, p: 'reject' } }, {});
  const next = snap({ dmarc: { read_error: true, present: false } }, {});
  assert.strictEqual(store.detectRegressions(prev, next).filter(e => e.mechanism === 'dmarc').length, 0);
});

test('detectRegressions: improvement (none→reject) is positive, no alert', () => {
  const ev = store.detectRegressions(snap({ dmarc: { present: true, p: 'none' } }, {}), snap({ dmarc: { present: true, p: 'reject' } }, {}));
  const dmarc = ev.find(e => e.mechanism === 'dmarc');
  assert.ok(dmarc && dmarc.positive === true);
});

test('detectRegressions: SPF -all→+all and MX change fire', () => {
  const spfEv = store.detectRegressions(snap({ spf: { present: true, terminal: '-all' } }, {}), snap({ spf: { present: true, terminal: '+all' } }, {}));
  assert.ok(spfEv.some(e => e.mechanism === 'spf' && e.severity === 'high'));
  const mxEv = store.detectRegressions(snap({ mx: { present: true, hosts: [{ exchange: 'a.com' }] } }, {}), snap({ mx: { present: true, hosts: [{ exchange: 'b.com' }] } }, {}));
  assert.ok(mxEv.some(e => e.mechanism === 'mx'));
});

// ── Store: findings hash gates narrative regen ──────────────────────────────────
test('computeFindingsHash is stable and changes only on substantive change', () => {
  const a = scorer.scoreDomain(cleanM365());
  const h1 = store.computeFindingsHash(a);
  const h2 = store.computeFindingsHash(scorer.scoreDomain(cleanM365()));
  assert.strictEqual(h1, h2, 'same findings → same hash');
  const changed = clone(cleanM365()); changed.dmarc.p = 'none';
  assert.notStrictEqual(h1, store.computeFindingsHash(scorer.scoreDomain(changed)));
});

// ── DNS-over-HTTPS parsers (DNSSEC DS + MTA-STS policy mode) ─────────────────────
test('parseDnssecAnswer: DS present → enabled (+validated via AD); none → disabled', () => {
  assert.strictEqual(reader.parseDnssecAnswer({ Status: 0, AD: true, Answer: [{ type: 43, data: 'x' }] }).status, 'enabled');
  assert.strictEqual(reader.parseDnssecAnswer({ Status: 0, AD: true, Answer: [{ type: 43 }] }).validated, true);
  assert.strictEqual(reader.parseDnssecAnswer({ Status: 0, Answer: [] }).status, 'disabled');
  assert.strictEqual(reader.parseDnssecAnswer(null).status, 'unknown');
});

test('parseMtaStsMode reads the enforcement mode from the policy file', () => {
  assert.strictEqual(reader.parseMtaStsMode('version: STSv1\nmode: enforce\nmx: *.mail.protection.outlook.com\nmax_age: 604800'), 'enforce');
  assert.strictEqual(reader.parseMtaStsMode('version: STSv1\r\nmode: testing\r\n'), 'testing');
  assert.strictEqual(reader.parseMtaStsMode(''), null);
});

// ── DKIM verdict (the differentiator) — targetMatch must be advisory, not a gate ──
const m365 = { all: ['microsoft365'] };
test('M365 selectors resolving with a key PASS regardless of CNAME target (the dkim.mail.microsoft regression)', () => {
  // targetMatch:false simulates Microsoft's newer *.dkim.mail.microsoft target that
  // the old hardcoded onmicrosoft.com gate rejected. Must NOT false-fail.
  const probes = [
    { selector: 'selector1', provider: 'microsoft365', outcome: 'key', target: 's1._domainkey.x.w-v1.dkim.mail.microsoft', targetMatch: false, keyType: 'rsa', keyBits: 2048 },
    { selector: 'selector2', provider: 'microsoft365', outcome: 'key', target: 's2._domainkey.x.w-v1.dkim.mail.microsoft', targetMatch: false, keyType: 'rsa', keyBits: 2048 },
  ];
  const v = reader.dkimVerdict(probes, m365);
  assert.strictEqual(v.state, 'pass');
  assert.strictEqual(v.passProvider, 'Microsoft 365');
});

test('M365 detected with all selectors CONFIRMED absent → fail', () => {
  const probes = [
    { selector: 'selector1', provider: 'microsoft365', outcome: 'absent' },
    { selector: 'selector2', provider: 'microsoft365', outcome: 'absent' },
  ];
  const v = reader.dkimVerdict(probes, m365);
  assert.strictEqual(v.state, 'fail');
  assert.strictEqual(v.expectedLabel, 'Microsoft 365');
});

test('M365 detected but a selector ERRORED → indeterminate (no false fail), not fail', () => {
  const probes = [
    { selector: 'selector1', provider: 'microsoft365', outcome: 'error' },
    { selector: 'selector2', provider: 'microsoft365', outcome: 'absent' },
  ];
  const v = reader.dkimVerdict(probes, m365);
  assert.strictEqual(v.state, 'indeterminate');
  assert.strictEqual(v.unconfirmed, true);
});

test('M365 expected selector with empty key (revoked) → fail (revoked)', () => {
  const probes = [
    { selector: 'selector1', provider: 'microsoft365', outcome: 'revoked' },
    { selector: 'selector2', provider: 'microsoft365', outcome: 'absent' },
  ];
  const v = reader.dkimVerdict(probes, m365);
  assert.strictEqual(v.state, 'fail');
  assert.strictEqual(v.revoked, true);
});

test('dynamic-selector sender (Amazon SES) with nothing answering → indeterminate, never fail', () => {
  const probes = [{ selector: 'selector1', provider: 'microsoft365', outcome: 'absent' }];
  const v = reader.dkimVerdict(probes, { all: ['amazonses'] });
  assert.strictEqual(v.state, 'indeterminate');
  assert.strictEqual(v.expectedLabel, 'Amazon SES');
});
