/**
 * Panoptica365 — First-Boot Wizard API
 *
 * Endpoints consumed by the wizard SPA (public/setup.html + public/js/setup.js).
 * Mounted at /api/setup. The setup middleware (src/lib/setup/middleware.js)
 * lets these through regardless of setup state because the wizard itself
 * needs them — but EACH endpoint here independently checks that the install
 * is still in setup mode. Once setup is complete, every endpoint here
 * returns 403. This is the security gate: the wizard cannot be re-exposed
 * on a live install (the setup-completed-once.flag in data/state/ makes
 * isInSetupMode() return false permanently).
 *
 *   GET  /api/setup/state               — current setup.json contents
 *   POST /api/setup/language            — record language pick (no .env)
 *   POST /api/setup/hostname            — PANOPTICA365_HOSTNAME + LETSENCRYPT_EMAIL
 *   POST /api/setup/entra               — ENTRA_TENANT_ID + CLIENT_ID + SECRET
 *   POST /api/setup/smtp                — SMTP_HOST + PORT + USER + PASS + FROM
 *   POST /api/setup/smtp/test           — send a real test email
 *   POST /api/setup/anthropic           — ANTHROPIC_API_KEY
 *   POST /api/setup/anthropic/test      — tiny Haiku API call to validate
 *   POST /api/setup/license             — exchange activation_key for JWT
 *                                          via license.panoptica365.com/api/v1/activate
 *   POST /api/setup/skip/:step          — mark an OPTIONAL step as skipped
 *   POST /api/setup/complete            — finalize (requires all required steps complete)
 *
 * Auth: NONE. The operator running the wizard isn't logged in yet. The
 * setup mode itself IS the gate — once setup completes, every endpoint here
 * 403s. This is the same pattern Microsoft Azure / Synology / similar
 * appliances use for first-boot wizards.
 *
 * .env writes mirror src/routes/api-settings.js's parseEnvFile +
 * updateEnvVars pattern (preserves comments + ordering). Implemented
 * locally rather than imported from api-settings to avoid pulling in the
 * full Anthropic + nodemailer + mspAudit dep chain at wizard time.
 */

'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const Anthropic = require('@anthropic-ai/sdk');

const setupState = require('../lib/setup/state');
const setupMiddleware = require('../lib/setup/middleware');
const licenseValidator = require('../lib/license/validator');
const licenseStore = require('../lib/license/store');

const router = express.Router();
router.use(express.json());

// ─── Setup-mode-required gate ──────────────────────────────────────────
// Every endpoint in this router refuses unless the install is actively
// in setup mode. Belt-and-suspenders: the setup middleware's path
// allowlist lets /api/setup/* through, but once setup-completed-once.flag
// exists, that middleware is a pass-through — and we don't want wizard
// endpoints reachable on a live install.
router.use((req, res, next) => {
  if (!setupState.isInSetupMode()) {
    return res.status(403).json({
      error: 'setup_already_complete',
      detail: 'Setup wizard endpoints are disabled because this install has already completed first-boot setup.',
    });
  }
  next();
});

// ─── Local .env helpers (parseEnvFile / updateEnvVars pattern) ─────────
const ENV_PATH = path.join(__dirname, '..', '..', '.env');

function parseEnvFile() {
  let content = '';
  try { content = fs.readFileSync(ENV_PATH, 'utf8'); } catch { content = ''; }
  const lines = content.split('\n');
  const vars = new Map();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) vars.set(m[1], { lineIdx: i, value: m[2] });
  }
  return { lines, vars };
}

function updateEnvVars(updates) {
  const { lines, vars } = parseEnvFile();
  if (!fs.existsSync(ENV_PATH)) {
    // Bootstrap: fresh install with no .env yet. Copy from .env.template
    // if present; otherwise start blank. Should rarely happen in practice
    // because the installer (Stage 4 Part A) copies .env.template → .env
    // before bringing up the stack.
    const templatePath = path.join(__dirname, '..', '..', '.env.template');
    if (fs.existsSync(templatePath)) {
      fs.copyFileSync(templatePath, ENV_PATH);
      // Re-parse the fresh copy so subsequent edits respect ordering.
      const { lines: tLines, vars: tVars } = parseEnvFile();
      lines.length = 0;
      lines.push(...tLines);
      for (const [k, v] of tVars) vars.set(k, v);
    } else {
      lines.push('# Panoptica365 .env — created by setup wizard');
    }
  }
  for (const [key, value] of Object.entries(updates)) {
    const safeVal = String(value);
    if (vars.has(key)) {
      lines[vars.get(key).lineIdx] = `${key}=${safeVal}`;
    } else {
      lines.push(`${key}=${safeVal}`);
    }
    process.env[key] = safeVal;
  }
  fs.writeFileSync(ENV_PATH, lines.join('\n'), 'utf8');
}

const GUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ─── GET /api/setup/state ──────────────────────────────────────────────
router.get('/state', (req, res) => {
  res.json({
    state: setupState.readSetupState(),
    required_steps: setupState.REQUIRED_STEPS,
    optional_steps: setupState.OPTIONAL_STEPS,
  });
});

// ─── POST /api/setup/language ──────────────────────────────────────────
router.post('/language', (req, res) => {
  const { language } = req.body || {};
  if (!['en', 'fr', 'es'].includes(language)) {
    return res.status(400).json({ error: 'invalid_language', detail: 'language must be en | fr | es' });
  }
  // Record the pick but DON'T write to .env — language is per-operator,
  // not per-install. The wizard uses it for its own UI; once setup
  // completes the first real operator login sets their own users.language.
  setupState.markStepComplete('language', { value: language });
  res.json({ ok: true, language });
});

// ─── POST /api/setup/hostname ──────────────────────────────────────────
router.post('/hostname', (req, res) => {
  const { hostname, letsencrypt_email } = req.body || {};
  if (!hostname || typeof hostname !== 'string' || hostname.length < 4 || hostname.length > 253) {
    return res.status(400).json({ error: 'invalid_hostname', detail: 'hostname must be 4-253 chars' });
  }
  if (!EMAIL_RE.test(letsencrypt_email || '')) {
    return res.status(400).json({ error: 'invalid_email', detail: 'letsencrypt_email must be a valid email address' });
  }
  // Strip protocol if operator pasted https://hostname/... — they only
  // want the bare hostname for Caddy + Entra redirect URI patterns.
  const cleanHostname = hostname.replace(/^https?:\/\//, '').replace(/\/$/, '').trim();

  updateEnvVars({
    PANOPTICA365_HOSTNAME: cleanHostname,
    LETSENCRYPT_EMAIL: letsencrypt_email,
    PANOPTICA_BASE_URL: `https://${cleanHostname}`,
    // Also derive the Entra redirect URIs so the operator doesn't have to
    // type them in step 3 — they're a 1:1 function of the hostname.
    ENTRA_REDIRECT_URI: `https://${cleanHostname}/auth/callback`,
    ENTRA_ADMIN_CONSENT_REDIRECT_URI: `https://${cleanHostname}/auth/adminconsent/callback`,
    ENTRA_TEAMS_DELEGATED_REDIRECT_URI: `https://${cleanHostname}/auth/teams-delegated/callback`,
  });
  setupState.markStepComplete('hostname', { hostname: cleanHostname });
  res.json({ ok: true, hostname: cleanHostname, base_url: `https://${cleanHostname}` });
});

// ─── POST /api/setup/entra ─────────────────────────────────────────────
router.post('/entra', (req, res) => {
  const { tenant_id, client_id, client_secret,
          admin_group_id, member_group_id, viewer_group_id } = req.body || {};
  if (!GUID_RE.test(tenant_id || '')) {
    return res.status(400).json({ error: 'invalid_tenant_id', detail: 'tenant_id must be a GUID' });
  }
  if (!GUID_RE.test(client_id || '')) {
    return res.status(400).json({ error: 'invalid_client_id', detail: 'client_id must be a GUID' });
  }
  if (!client_secret || typeof client_secret !== 'string' || client_secret.length < 20) {
    return res.status(400).json({ error: 'invalid_client_secret', detail: 'client_secret looks too short' });
  }
  // Group IDs optional but if provided must be GUIDs.
  for (const [field, val] of [
    ['admin_group_id', admin_group_id],
    ['member_group_id', member_group_id],
    ['viewer_group_id', viewer_group_id],
  ]) {
    if (val && !GUID_RE.test(val)) {
      return res.status(400).json({ error: `invalid_${field}`, detail: `${field} must be a GUID if provided` });
    }
  }

  const updates = {
    ENTRA_TENANT_ID: tenant_id,
    ENTRA_CLIENT_ID: client_id,
    ENTRA_CLIENT_SECRET: client_secret,
  };
  if (admin_group_id) {
    updates.ENTRA_ADMIN_GROUP_ID = admin_group_id;
    updates.ENTRA_AUTHORIZED_GROUP_ID = admin_group_id;  // legacy alias used as fallback
  }
  if (member_group_id) updates.ENTRA_MEMBER_GROUP_ID = member_group_id;
  if (viewer_group_id) updates.ENTRA_VIEWER_GROUP_ID = viewer_group_id;
  updateEnvVars(updates);
  setupState.markStepComplete('entra', { tenant_id });
  res.json({ ok: true });
});

// ─── POST /api/setup/smtp ──────────────────────────────────────────────
router.post('/smtp', (req, res) => {
  const { host, port, user, password, from } = req.body || {};
  if (!host || typeof host !== 'string') {
    return res.status(400).json({ error: 'invalid_host' });
  }
  const portNum = parseInt(port, 10);
  if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
    return res.status(400).json({ error: 'invalid_port', detail: 'port must be 1-65535' });
  }
  if (!user || typeof user !== 'string') {
    return res.status(400).json({ error: 'invalid_user' });
  }
  if (!password || typeof password !== 'string') {
    return res.status(400).json({ error: 'invalid_password' });
  }
  if (!EMAIL_RE.test(from || '')) {
    return res.status(400).json({ error: 'invalid_from', detail: 'from must be a valid email address' });
  }
  updateEnvVars({
    SMTP_HOST: host,
    SMTP_PORT: String(portNum),
    SMTP_USER: user,
    SMTP_PASS: password,
    SMTP_FROM: from,
  });
  setupState.markStepComplete('smtp', { tested: false });
  res.json({ ok: true });
});

// ─── POST /api/setup/smtp/test ─────────────────────────────────────────
router.post('/smtp/test', async (req, res) => {
  const { to_email } = req.body || {};
  if (!EMAIL_RE.test(to_email || '')) {
    return res.status(400).json({ error: 'invalid_to_email' });
  }
  // Read current SMTP from process.env (just written by /smtp).
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT, 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM;
  if (!host || !port || !user || !pass || !from) {
    return res.status(400).json({ error: 'smtp_not_configured', detail: 'Save SMTP settings first.' });
  }
  try {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
    await transporter.sendMail({
      from,
      to: to_email,
      subject: 'Panoptica365 — SMTP setup test',
      text: 'Success! Your SMTP credentials are working. You can continue the Panoptica365 setup wizard.',
      html: '<p>Success! Your SMTP credentials are working.</p><p>You can continue the Panoptica365 setup wizard.</p>',
    });
    // Mark the smtp step's tested=true (idempotent — overwrites the previous record).
    const state = setupState.readSetupState();
    const prev = state.steps.smtp || { complete: true, at: new Date().toISOString() };
    setupState.markStepComplete('smtp', { ...prev, tested: true });
    res.json({ ok: true, sent_to: to_email });
  } catch (e) {
    res.status(502).json({ error: 'smtp_test_failed', detail: e.message });
  }
});

// ─── POST /api/setup/anthropic ─────────────────────────────────────────
router.post('/anthropic', (req, res) => {
  const { api_key } = req.body || {};
  if (!api_key || typeof api_key !== 'string' || !api_key.startsWith('sk-ant-')) {
    return res.status(400).json({ error: 'invalid_api_key', detail: 'Anthropic API keys start with sk-ant-' });
  }
  updateEnvVars({ ANTHROPIC_API_KEY: api_key });
  setupState.markStepComplete('anthropic', { tested: false });
  res.json({ ok: true });
});

// ─── POST /api/setup/anthropic/test ────────────────────────────────────
router.post('/anthropic/test', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !apiKey.startsWith('sk-ant-')) {
    return res.status(400).json({ error: 'anthropic_not_configured', detail: 'Save Anthropic API key first.' });
  }
  try {
    const client = new Anthropic({ apiKey });
    // Tiny prompt — cheapest possible Haiku call (~$0.0001).
    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Reply with just the word OK.' }],
    });
    const replyText = response?.content?.[0]?.text || '';
    const state = setupState.readSetupState();
    const prev = state.steps.anthropic || { complete: true, at: new Date().toISOString() };
    setupState.markStepComplete('anthropic', { ...prev, tested: true });
    res.json({ ok: true, reply_preview: replyText.substring(0, 50) });
  } catch (e) {
    // Common failures: 401 invalid key, network down, model not found.
    res.status(502).json({ error: 'anthropic_test_failed', detail: e.message });
  }
});

// ─── POST /api/setup/license ───────────────────────────────────────────
// Exchange activation_key for a JWT via the production license server.
// Persists token + fingerprint to .env AND to data/state/license-cache.json.
const LICENSE_SERVER_URL = process.env.LICENSE_SERVER_URL
  || 'https://license.panoptica365.com';

router.post('/license', async (req, res) => {
  const { activation_key } = req.body || {};
  if (!activation_key || typeof activation_key !== 'string' || activation_key.length < 20) {
    return res.status(400).json({ error: 'invalid_activation_key', detail: 'Activation key looks too short.' });
  }
  // Get-or-create the install fingerprint. Boot's setup-mode bypass already
  // triggered fingerprint generation, so this should return the existing
  // value — but call again defensively in case data/state/setup.json was
  // wiped between boot and wizard run.
  let fingerprint;
  try {
    fingerprint = licenseStore.getOrCreateFingerprint();
  } catch (e) {
    return res.status(500).json({ error: 'fingerprint_failed', detail: e.message });
  }

  // Call license server's /api/v1/activate.
  const activateUrl = `${LICENSE_SERVER_URL}/api/v1/activate`;
  let activateResponse;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15_000);
    const r = await fetch(activateUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activation_key: activation_key.trim(), fingerprint }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!r.ok) {
      let body = '';
      try { body = JSON.stringify(await r.json()); } catch { try { body = await r.text(); } catch { body = '(no body)'; } }
      return res.status(502).json({
        error: 'license_activation_rejected',
        license_server_status: r.status,
        detail: body,
      });
    }
    activateResponse = await r.json();
  } catch (e) {
    return res.status(502).json({
      error: 'license_server_unreachable',
      detail: e.message,
      url: activateUrl,
    });
  }

  if (!activateResponse || !activateResponse.token) {
    return res.status(502).json({ error: 'license_server_bad_response', detail: 'No token in /activate response.' });
  }

  // Verify the new token locally — same path validateLicenseAtBoot uses.
  // If verification fails, the license server returned garbage; don't
  // persist it.
  let claims;
  try {
    const result = await licenseValidator.loadAndVerifyLicenseToken(
      activateResponse.token, fingerprint,
    );
    claims = result.claims;
  } catch (e) {
    return res.status(502).json({
      error: 'license_token_verification_failed',
      detail: `${e.code || 'UNKNOWN'}: ${e.message}`,
    });
  }

  // Persist to .env and cache sidecar.
  try {
    licenseStore.persistRotatedToken(activateResponse.token, claims);
    // Also write LICENSE_TOKEN explicitly via updateEnvVars to ensure it
    // shows up in our local .env structure (persistRotatedToken uses
    // licenseStore's own writer which mirrors api-settings.js shape).
  } catch (e) {
    return res.status(500).json({ error: 'persist_failed', detail: e.message });
  }

  setupState.markStepComplete('license', {
    license_id: claims.license_id,
    msp_name: claims.msp_name,
    billing_mode: claims.billing_mode,
    max_seats: claims.max_seats,
  });

  res.json({
    ok: true,
    msp_name: claims.msp_name,
    tier: claims.tier,
    billing_mode: claims.billing_mode,
    max_seats: claims.max_seats,
    expires_at: activateResponse.expires_at,
  });
});

// ─── POST /api/setup/skip/:step ────────────────────────────────────────
router.post('/skip/:step', (req, res) => {
  const step = req.params.step;
  if (!setupState.OPTIONAL_STEPS.includes(step)) {
    return res.status(400).json({
      error: 'cannot_skip',
      detail: `${step} is not an optional step. Optional steps: ${setupState.OPTIONAL_STEPS.join(', ')}`,
    });
  }
  setupState.markStepSkipped(step);
  res.json({ ok: true, skipped: step });
});

// ─── POST /api/setup/complete ──────────────────────────────────────────
router.post('/complete', (req, res) => {
  try {
    const state = setupState.markSetupComplete();
    // Invalidate the setup middleware's 5s cache so the very next request
    // hits the new state (setup complete = pass-through everywhere).
    setupMiddleware.invalidateSetupModeCache();
    res.json({
      ok: true,
      completed_at: state.completed_at,
      next_url: '/',
    });
  } catch (e) {
    res.status(400).json({ error: 'cannot_complete', detail: e.message });
  }
});

module.exports = router;
