#!/usr/bin/env node
/**
 * Panoptica365 — CI i18n parity check (Reliability 1.6, 2026-06-12).
 *
 * Enforces the three-locales-day-one rule as a build gate instead of a habit:
 *   1. en/fr/es leaf-key parity — every leaf key present in one locale must
 *      exist in all three (3,401 leaves at the time this shipped, zero gaps).
 *   2. Content presence — the operator-facing content sections that alerts
 *      depend on must exist and be non-empty in every locale:
 *      alert_explanations, event_descriptions.msp_audit.
 *   3. JSON validity + the exact formatting contract the programmatic locale
 *      editors rely on (JSON.stringify(obj, null, 2) + trailing newline).
 *
 * Exit 0 = clean; exit 1 = violations (listed, capped at 30 per direction).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.join(__dirname, '..', '..', 'locales');
const LANGS = ['en', 'fr', 'es'];

function leaves(obj, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...leaves(v, key));
    else out.push(key);
  }
  return out;
}

let failed = false;
const data = {};

for (const lang of LANGS) {
  const file = path.join(LOCALES_DIR, `${lang}.json`);
  const raw = fs.readFileSync(file, 'utf8');
  data[lang] = JSON.parse(raw); // throws (failing CI) on invalid JSON
  const canonical = JSON.stringify(data[lang], null, 2) + '\n';
  if (raw !== canonical) {
    console.error(`i18n-parity: ${lang}.json violates the formatting contract (must be JSON.stringify(obj, null, 2) + '\\n')`);
    failed = true;
  }
}

const sets = Object.fromEntries(LANGS.map(l => [l, new Set(leaves(data[l]))]));
for (const a of LANGS) {
  for (const b of LANGS) {
    if (a === b) continue;
    const missing = [...sets[a]].filter(k => !sets[b].has(k));
    if (missing.length) {
      failed = true;
      console.error(`i18n-parity: ${missing.length} key(s) in ${a} missing from ${b}:`);
      for (const k of missing.slice(0, 30)) console.error('  ' + k);
      if (missing.length > 30) console.error(`  …and ${missing.length - 30} more`);
    }
  }
}

for (const lang of LANGS) {
  for (const section of ['alert_explanations', 'event_descriptions']) {
    const v = data[lang][section];
    if (!v || typeof v !== 'object' || Object.keys(v).length === 0) {
      console.error(`i18n-parity: ${lang}.json is missing the required '${section}' content section`);
      failed = true;
    }
  }
  const ma = data[lang].event_descriptions && data[lang].event_descriptions.msp_audit;
  if (!ma || Object.keys(ma).length === 0) {
    console.error(`i18n-parity: ${lang}.json is missing event_descriptions.msp_audit templates`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log(`i18n-parity: ${sets.en.size} leaf keys, full parity across ${LANGS.join('/')}, content sections present.`);
