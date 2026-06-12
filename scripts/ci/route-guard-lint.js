#!/usr/bin/env node
/**
 * Panoptica365 — CI route-guard lint (Reliability 1.6, 2026-06-12).
 *
 * Encodes the lesson from the pre-ship security review's H-1: one router in
 * thirty was missing its auth guard. This makes that defect class fail the
 * build instead of relying on review.
 *
 * Rule, per file in src/routes/:
 *   1. A documented exemption marker passes:
 *        // CI-ROUTE-GUARD-EXEMPT: <reason>
 *      The reason is mandatory — a bare marker fails.
 *   2. A router-level guard passes:  router.use(auth.requireAuth | requireAdmin)
 *   3. Otherwise, EVERY route definition line (router.get/post/put/delete/
 *      patch) must reference an auth.require* middleware inline.
 *
 * Exit 0 = clean; exit 1 = violations (listed).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROUTES_DIR = path.join(__dirname, '..', '..', 'src', 'routes');
const EXEMPT_RE = /\/\/\s*CI-ROUTE-GUARD-EXEMPT:\s*(\S.*)/;
const ROUTER_LEVEL_RE = /router\.use\(\s*auth\.require(Auth|Admin|MemberOrAdmin)\b/;
const ROUTE_DEF_RE = /router\.(get|post|put|delete|patch)\(/;
const INLINE_GUARD_RE = /auth\.require(Auth|Admin|MemberOrAdmin)\b/;

const violations = [];
// Skip macOS AppleDouble sidecars (._*) that SMB editing leaves behind.
const files = fs.readdirSync(ROUTES_DIR).filter(f => f.endsWith('.js') && !f.startsWith('.'));

for (const file of files) {
  const full = path.join(ROUTES_DIR, file);
  const src = fs.readFileSync(full, 'utf8');

  const exempt = src.match(EXEMPT_RE);
  if (exempt) {
    console.log(`  EXEMPT  ${file} — ${exempt[1].trim()}`);
    continue;
  }
  if (ROUTER_LEVEL_RE.test(src)) {
    console.log(`  OK      ${file} (router-level guard)`);
    continue;
  }

  // Per-route mode: every route definition line must carry an inline guard.
  const lines = src.split('\n');
  const bad = [];
  lines.forEach((line, i) => {
    if (ROUTE_DEF_RE.test(line) && !INLINE_GUARD_RE.test(line)) {
      bad.push(`${file}:${i + 1}  ${line.trim().slice(0, 90)}`);
    }
  });
  if (bad.length) {
    violations.push(...bad);
    console.log(`  FAIL    ${file} (${bad.length} unguarded route(s))`);
  } else {
    console.log(`  OK      ${file} (per-route guards)`);
  }
}

if (violations.length) {
  console.error(`\nroute-guard-lint: ${violations.length} unguarded route(s):`);
  for (const v of violations) console.error('  ' + v);
  console.error('\nAdd auth.requireAuth/requireAdmin, or document why with:');
  console.error('  // CI-ROUTE-GUARD-EXEMPT: <reason>');
  process.exit(1);
}
console.log(`\nroute-guard-lint: ${files.length} routers clean.`);
