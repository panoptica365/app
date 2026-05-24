#!/usr/bin/env node
/**
 * Panoptica365 — Setup migration smoke test
 *
 * Standalone test for src/lib/setup/state.js. Verifies the legacy-install
 * migration would correctly retroactively mark this install as set up,
 * WITHOUT actually pm2-restarting the live app.
 *
 * Usage (on Panoptica365-Prod):
 *   cd /opt/panoptica
 *   node scripts/test-setup-migration.js
 *
 * What it does:
 *   1. Reports current state (does flag exist? does setup.json exist?
 *      what would isInSetupMode return?).
 *   2. Inspects process.env.LICENSE_TOKEN to confirm the migration's
 *      detection heuristic would fire.
 *   3. DRY RUN — does NOT actually write the flag. Tells you what would
 *      happen if migrateLegacyInstall() were called.
 *   4. Optionally (with --apply), actually performs the migration.
 *
 * Exits 0 on success.
 */

'use strict';

const path = require('path');
const fs = require('fs');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const setupState = require('../src/lib/setup/state');

const APPLY = process.argv.includes('--apply');
const SEP = '─'.repeat(74);

console.log('');
console.log(SEP);
console.log('  Panoptica365 — Setup Migration Smoke Test' + (APPLY ? '  [APPLY MODE]' : '  [DRY RUN]'));
console.log(SEP);
console.log('');

// 1. Current state
const flagExists = fs.existsSync(setupState.COMPLETED_FLAG_PATH);
const setupJsonExists = fs.existsSync(setupState.SETUP_JSON_PATH);
const inSetupMode = setupState.isInSetupMode();

console.log('  Current state:');
console.log(`    Flag file        : ${setupState.COMPLETED_FLAG_PATH}`);
console.log(`    Flag exists      : ${flagExists ? 'YES' : 'NO'}`);
console.log(`    setup.json       : ${setupState.SETUP_JSON_PATH}`);
console.log(`    setup.json exists: ${setupJsonExists ? 'YES' : 'NO'}`);
console.log(`    isInSetupMode()  : ${inSetupMode}`);
console.log('');

// 2. Detection signal
const token = process.env.LICENSE_TOKEN;
const tokenLooksValid = !!token && token.length >= 80 && token.startsWith('ey') && token.split('.').length === 3;

console.log('  Detection signal (LICENSE_TOKEN):');
console.log(`    Present          : ${!!token ? 'YES' : 'NO'}`);
console.log(`    Length           : ${token ? token.length : 0}`);
console.log(`    JWT-shaped       : ${tokenLooksValid ? 'YES' : 'NO'}`);
console.log(`    First 20 chars   : ${token ? token.substring(0, 20) + '...' : '(none)'}`);
console.log('');

// 3. What migration would do
console.log('  Migration prediction:');
if (flagExists) {
  console.log('    → migrate=false (reason: flag already exists)');
  console.log('    → install was already marked set up. No-op.');
} else if (!tokenLooksValid) {
  console.log('    → migrate=false (reason: no JWT-shaped LICENSE_TOKEN found)');
  console.log('    → install would enter SETUP MODE on next boot.');
  console.log('    → This is correct if this is a fresh, never-activated install.');
  console.log('    → If this is Panoptica365-Prod (Trilogiam), THIS IS A BUG — investigate.');
} else {
  console.log('    → migrate=TRUE');
  console.log('    → would write setup-completed-once.flag + synthesized setup.json');
  console.log('    → install would NOT enter setup mode on next boot.');
  console.log('    → setupState.isInSetupMode() would return false.');
}
console.log('');

// 4. Optional apply
if (APPLY) {
  console.log('  Applying migration NOW...');
  try {
    const result = setupState.migrateLegacyInstall();
    console.log(`    Result: migrated=${result.migrated}, reason=${result.reason}`);
    console.log('');

    // Re-check
    const flagAfter = fs.existsSync(setupState.COMPLETED_FLAG_PATH);
    const setupJsonAfter = fs.existsSync(setupState.SETUP_JSON_PATH);
    const modeAfter = setupState.isInSetupMode();
    console.log('  Post-migration state:');
    console.log(`    Flag exists      : ${flagAfter ? 'YES' : 'NO'}`);
    console.log(`    setup.json exists: ${setupJsonAfter ? 'YES' : 'NO'}`);
    console.log(`    isInSetupMode()  : ${modeAfter}`);
    if (modeAfter) {
      console.log('');
      console.log('  ✗ FAILED — install is still in setup mode after migration!');
      process.exit(1);
    }
    console.log('');
    console.log('  ✓ SUCCESS — install marked set up; next boot will NOT enter setup mode.');
  } catch (e) {
    console.log(`    ERROR: ${e.message}`);
    console.log('');
    process.exit(1);
  }
} else {
  console.log('  This was a DRY RUN. Re-run with --apply to actually perform migration.');
  console.log('  (Migration ALSO happens automatically on next pm2 restart via boot.js.)');
}

console.log('');
console.log(SEP);
console.log('');
