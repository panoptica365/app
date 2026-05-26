/**
 * Panoptica365 — First-Boot Wizard State
 *
 * Tracks setup-wizard progress in `data/state/setup.json`. The wizard
 * (v0.1.10+) walks the operator through hostname / Entra / SMTP /
 * Anthropic / license / first tenant. Each step writes a completion
 * record here; once all required steps are complete, setup.json gets
 * a `completed_at` timestamp AND a sibling `setup-completed-once.flag`
 * is dropped as a permanent "this install has been set up at least once"
 * marker.
 *
 * Why two files (setup.json + setup-completed-once.flag):
 *
 *   `setup.json` carries the rich per-step state (when each step
 *   completed, what value was saved, whether a test was skipped).
 *   Operators COULD legitimately delete it to re-run the wizard.
 *
 *   `setup-completed-once.flag` is the security backstop: once it
 *   exists, setup mode CANNOT be re-entered even if setup.json is
 *   missing or corrupted. This prevents a foot-gun where an operator
 *   on a live customer-facing install accidentally deletes the
 *   data/state/ directory and re-exposes the unauthenticated wizard
 *   to the internet. Re-running the wizard intentionally requires
 *   ALSO deleting the flag, which is a deliberate-enough act to
 *   require thinking about it.
 *
 * Design notes:
 *
 *   - Read/write pattern mirrors src/lib/license/store.js. data/state/
 *     is bind-mounted in the container so files survive image pulls.
 *
 *   - chmod 600 on both files (consistent with license-cache).
 *
 *   - JSON.parse failure on setup.json is treated as "no setup state
 *     yet" (fresh install). Combined with the flag check, this means
 *     a corrupted setup.json on a previously-set-up install still
 *     blocks setup-mode re-entry — the flag is the source of truth
 *     for "this install has been set up."
 *
 *   - The list of REQUIRED wizard steps is the constant
 *     REQUIRED_STEPS. Optional steps (currently just first_tenant)
 *     don't block setup completion.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..', '..', '..');
const STATE_DIR = path.join(PROJECT_ROOT, 'data', 'state');
const SETUP_JSON_PATH = path.join(STATE_DIR, 'setup.json');
const COMPLETED_FLAG_PATH = path.join(STATE_DIR, 'setup-completed-once.flag');

const SCHEMA_VERSION = 1;

// Steps that must be completed for setup to finish. Update this list when
// adding new required wizard steps. Order is the wizard's display order.
const REQUIRED_STEPS = [
  'language',     // operator picked / confirmed wizard language
                  // (v0.1.18 — hostname step dropped; the Stage 4 installer at
                  //  install.panoptica365.com/run prompts for hostname +
                  //  Let's Encrypt email upfront and writes them to .env BEFORE
                  //  the stack comes up. Caddy provisions TLS from boot. The
                  //  wizard never asks for hostname. The legacy /api/setup/hostname
                  //  endpoint stays in api-setup.js for backward compat but is
                  //  no longer called from the wizard's frontend.)
  'app_reg',      // operator acknowledged completing the Entra app registration
                  //   (v0.1.13+; no data captured — just a "yes I did it" ack
                  //   that gates the wizard until they've followed the modal).
  'entra',        // ENTRA_TENANT_ID + ENTRA_CLIENT_ID + ENTRA_CLIENT_SECRET written
  'smtp',         // SMTP_HOST + SMTP_PORT + SMTP_USER + SMTP_PASS + SMTP_FROM written
  'anthropic',    // ANTHROPIC_API_KEY written
  'license',      // LICENSE_TOKEN + PANOPTICA_INSTALL_FINGERPRINT written via /api/v1/activate
];

// Optional steps — completion not required to mark setup done.
const OPTIONAL_STEPS = [
  'first_tenant', // operator added first customer tenant via admin consent (skippable)
];

const ALL_STEPS = [...REQUIRED_STEPS, ...OPTIONAL_STEPS];

// ─── Storage helpers ───────────────────────────────────────────────────

function ensureStateDir() {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
}

function emptyState() {
  const now = new Date().toISOString();
  const steps = {};
  for (const s of ALL_STEPS) steps[s] = { complete: false, at: null };
  return {
    schema_version: SCHEMA_VERSION,
    started_at: now,
    completed_at: null,
    steps,
  };
}

/**
 * Read current setup state. Returns the parsed JSON object, or a fresh
 * empty state if setup.json doesn't exist OR is corrupted.
 *
 * Never throws — fs/parse errors degrade to "fresh install" semantics.
 */
function readSetupState() {
  try {
    if (!fs.existsSync(SETUP_JSON_PATH)) return emptyState();
    const raw = fs.readFileSync(SETUP_JSON_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return emptyState();
    // Defensive: ensure all known steps are present even if the file is
    // from an older schema version that didn't track some current steps.
    if (!parsed.steps) parsed.steps = {};
    for (const s of ALL_STEPS) {
      if (!parsed.steps[s]) parsed.steps[s] = { complete: false, at: null };
    }
    return parsed;
  } catch {
    return emptyState();
  }
}

/**
 * Persist setup state. Creates data/state/ if missing. chmod 600.
 */
function writeSetupState(state) {
  ensureStateDir();
  fs.writeFileSync(SETUP_JSON_PATH, JSON.stringify(state, null, 2), 'utf8');
  try { fs.chmodSync(SETUP_JSON_PATH, 0o600); } catch { /* bind-mount may reject; non-fatal */ }
}

/**
 * Mark a single step complete with optional extra data (e.g., language
 * picked, license_id from activation). Updates setup.json. Does NOT
 * automatically write the completion flag — that requires explicit
 * markSetupComplete() once all required steps are done.
 */
function markStepComplete(stepName, extra = {}) {
  if (!ALL_STEPS.includes(stepName)) {
    throw new Error(`Unknown setup step: ${stepName}`);
  }
  const state = readSetupState();
  state.steps[stepName] = {
    complete: true,
    at: new Date().toISOString(),
    ...extra,
  };
  writeSetupState(state);
  return state;
}

/**
 * Mark a single step as deliberately SKIPPED (only meaningful for
 * optional steps — for required steps, "skip" really means "defer"
 * which boots will refuse).
 */
function markStepSkipped(stepName) {
  if (!OPTIONAL_STEPS.includes(stepName)) {
    throw new Error(`Cannot skip required step: ${stepName}`);
  }
  const state = readSetupState();
  state.steps[stepName] = {
    complete: false,
    skipped: true,
    at: new Date().toISOString(),
  };
  writeSetupState(state);
  return state;
}

/**
 * Returns true iff every REQUIRED_STEPS entry is marked complete.
 */
function areRequiredStepsComplete(state = null) {
  const s = state || readSetupState();
  for (const step of REQUIRED_STEPS) {
    if (!s.steps[step] || !s.steps[step].complete) return false;
  }
  return true;
}

/**
 * Mark setup fully complete:
 *   - setup.json `completed_at` set
 *   - setup-completed-once.flag created (permanent marker)
 *
 * Throws if any required step is incomplete.
 */
function markSetupComplete() {
  const state = readSetupState();
  if (!areRequiredStepsComplete(state)) {
    const missing = REQUIRED_STEPS.filter(s => !state.steps[s]?.complete);
    throw new Error(`Cannot mark setup complete — required steps missing: ${missing.join(', ')}`);
  }
  state.completed_at = new Date().toISOString();
  writeSetupState(state);
  // Drop the permanent flag.
  ensureStateDir();
  fs.writeFileSync(
    COMPLETED_FLAG_PATH,
    `Panoptica365 install setup completed at ${state.completed_at}\n` +
    `This flag's existence prevents the setup wizard from being re-exposed\n` +
    `on subsequent boots. Delete this file ONLY if you intend to re-run the\n` +
    `wizard (also delete data/state/setup.json).\n`,
    'utf8',
  );
  try { fs.chmodSync(COMPLETED_FLAG_PATH, 0o600); } catch { /* bind-mount may reject; non-fatal */ }
  return state;
}

/**
 * THE LOAD-BEARING CHECK. Returns true iff the install should be in
 * "setup mode" right now (i.e., the wizard should be exposed and the
 * normal app should be gated).
 *
 * Logic:
 *   - If setup-completed-once.flag exists → NEVER in setup mode, regardless
 *     of setup.json. This is the safety backstop.
 *   - Else if setup.json doesn't exist OR completed_at is null → IN setup mode.
 *   - Else not in setup mode (legacy completion, no flag — old install that
 *     pre-dates this code).
 */
function isInSetupMode() {
  // Permanent flag beats everything.
  if (fs.existsSync(COMPLETED_FLAG_PATH)) return false;

  const state = readSetupState();
  if (!state.completed_at) return true;

  // setup.json says complete but no flag — write the flag retroactively
  // so subsequent boots don't have to re-check. This handles upgrades
  // from an in-development build that wrote setup.json but didn't have
  // the flag-writing code yet.
  try {
    ensureStateDir();
    fs.writeFileSync(
      COMPLETED_FLAG_PATH,
      `Panoptica365 install setup completed at ${state.completed_at}\n` +
      `(flag written retroactively on boot — setup.json was already complete)\n`,
      'utf8',
    );
    try { fs.chmodSync(COMPLETED_FLAG_PATH, 0o600); } catch { /* non-fatal */ }
  } catch { /* non-fatal */ }
  return false;
}

/**
 * Legacy-install migration (v0.1.10).
 *
 * Installs that existed BEFORE v0.1.10 (Trilogiam, any early beta MSPs)
 * went through the manual setup workflow — they have LICENSE_TOKEN +
 * fingerprint + Entra creds + SMTP + Anthropic key in .env but NEVER
 * ran the first-boot wizard, so setup-completed-once.flag doesn't exist.
 *
 * Without migration, isInSetupMode() would return true on the next pm2
 * restart and the setup middleware would gate the entire app behind /setup
 * — breaking the live install.
 *
 * Detection: presence of a valid-looking LICENSE_TOKEN in process.env.
 * (No valid license can exist without having been issued by the license
 * server, so this is a strong signal the install was operational before.)
 *
 * On detection: write a synthesized setup.json marking all required steps
 * complete (with a marker that they were migrated, not actually wizard-
 * completed) + write the permanent flag. Subsequent isInSetupMode() calls
 * return false.
 *
 * Idempotent. If the flag already exists, no-op. If LICENSE_TOKEN is
 * missing or obviously placeholder-shaped, no-op.
 *
 * MUST be called BEFORE any other setup-state query in the boot path
 * (otherwise the cache in middleware.js may have already flipped the
 * gate to "on" for an install that should be treated as set up).
 */
function migrateLegacyInstall() {
  // If the permanent flag already exists, this install has been set up
  // (either via the wizard or via a previous migration). Nothing to do.
  if (fs.existsSync(COMPLETED_FLAG_PATH)) return { migrated: false, reason: 'flag_exists' };

  // Check for a real-looking LICENSE_TOKEN. JWT minimum sanity: starts with
  // "ey" (base64url of `{"`), three dot-separated segments. Don't try to
  // verify the signature here — that's the license validator's job. We
  // just want to detect "this is not a fresh install."
  const token = process.env.LICENSE_TOKEN;
  if (!token || typeof token !== 'string' || token.length < 80) {
    return { migrated: false, reason: 'no_license_token' };
  }
  if (!token.startsWith('ey') || token.split('.').length !== 3) {
    return { migrated: false, reason: 'token_not_jwt_shaped' };
  }

  // Synthesize a setup.json marking all required steps complete-as-migrated.
  const now = new Date().toISOString();
  const steps = {};
  for (const s of REQUIRED_STEPS) {
    steps[s] = { complete: true, at: now, migrated: true };
  }
  for (const s of OPTIONAL_STEPS) {
    steps[s] = { complete: false, at: null };
  }
  const state = {
    schema_version: SCHEMA_VERSION,
    started_at: now,
    completed_at: now,
    migrated_at: now,
    migration_reason: 'pre_v0_1_10_install_with_valid_license_token',
    steps,
  };
  writeSetupState(state);

  // Drop the permanent flag with a migration note.
  ensureStateDir();
  fs.writeFileSync(
    COMPLETED_FLAG_PATH,
    `Panoptica365 install setup MIGRATED at ${now}\n` +
    `This install pre-dates the v0.1.10 first-boot wizard. A valid\n` +
    `LICENSE_TOKEN was found in .env, so setup is marked complete\n` +
    `retroactively. Delete this file only if you intend to re-run the\n` +
    `wizard from scratch (also delete data/state/setup.json).\n`,
    'utf8',
  );
  try { fs.chmodSync(COMPLETED_FLAG_PATH, 0o600); } catch { /* non-fatal */ }

  console.log(
    '[Setup] Legacy install detected (valid LICENSE_TOKEN, no completion flag) — ' +
    'marked setup complete retroactively. data/state/setup-completed-once.flag written.',
  );
  return { migrated: true, reason: 'valid_license_token_present' };
}

module.exports = {
  // State queries
  readSetupState,
  areRequiredStepsComplete,
  isInSetupMode,
  // Migration (call at boot before any other setup query)
  migrateLegacyInstall,
  // State mutations
  markStepComplete,
  markStepSkipped,
  markSetupComplete,
  // Constants
  REQUIRED_STEPS,
  OPTIONAL_STEPS,
  ALL_STEPS,
  // Paths — surfaced for diagnostic / error-message use
  SETUP_JSON_PATH,
  COMPLETED_FLAG_PATH,
  STATE_DIR,
};
