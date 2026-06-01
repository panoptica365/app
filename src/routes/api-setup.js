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
const certProvisioner = require('../lib/setup/cert-provisioner');

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

// ─── POST /api/setup/app-reg ───────────────────────────────────────────
// Operator acknowledges they've completed the Entra app registration via
// the modal's instructions. No data captured — just marks the step done.
// v0.1.13+
router.post('/app-reg', (req, res) => {
  setupState.markStepComplete('app_reg', { acknowledged: true });
  res.json({ ok: true });
});

// ─── POST /api/setup/cert/generate ─────────────────────────────────────
// Generate (once, idempotent) the app-only monitoring certificate. The
// private .pfx stays on the server and is wired into .env; the operator
// downloads the public .cer (next endpoint) and uploads it to their app
// registration's Certificates & secrets blade. Called by the frontend when
// the operator reaches the cert sub-step of the app-reg modal.
//
// Passing { regenerate: true } mints a fresh keypair (deliberate rotation) —
// not used by the wizard, reserved for the future cert-management card.
router.post('/cert/generate', async (req, res) => {
  try {
    const regenerate = req.body && req.body.regenerate === true;
    const result = await certProvisioner.ensureCert({ regenerate });
    res.json({
      ok: true,
      thumbprint: result.thumbprint,
      notAfter: result.notAfter,
      regenerated: result.regenerated,
    });
  } catch (e) {
    res.status(500).json({
      error: 'cert_generation_failed',
      detail: `Could not generate the certificate: ${e.message}. ` +
        `Verify the certs directory is writable (the container mounts ` +
        `./certs read-write) and that openssl is available in the image.`,
    });
  }
});

// ─── GET /api/setup/cert/download ──────────────────────────────────────
// Stream the public .cer as a file attachment for the operator to upload to
// Entra. 404 if generation hasn't run yet (the frontend always generates
// first, so this is the belt-and-suspenders case).
router.get('/cert/download', (req, res) => {
  const cer = certProvisioner.cerPath();
  if (!cer) {
    return res.status(404).json({
      error: 'cert_not_generated',
      detail: 'The certificate has not been generated yet. Open the App Registration instructions to generate it first.',
    });
  }
  res.setHeader('Content-Type', 'application/x-x509-ca-cert');
  res.setHeader('Content-Disposition', 'attachment; filename="panoptica365.cer"');
  res.sendFile(cer);
});

// ─── POST /api/setup/entra/test ────────────────────────────────────────
// Multi-permission spot-check. Acquires an app-only access token using
// the just-saved ENTRA_TENANT_ID/CLIENT_ID/CLIENT_SECRET, then fires ~9
// representative Graph calls in parallel. Categorizes failures:
//   - Token request failed → cred problem (401 / wrong secret / wrong IDs)
//   - Token OK but Graph calls 403 → missing permission or missing admin consent
//   - All 200 → all spot-checks passed
//
// Doesn't validate EVERY permission (58 calls would be slow + noisy). The
// 9 reps cover the major permission buckets so the common "operator
// forgot to grant admin consent" failure mode lights up immediately.
//
// v0.1.13+
const ENTRA_TEST_CHECKS = [
  { perm: 'User.Read.All',            url: '/users?$top=1' },
  { perm: 'Application.Read.All',     url: '/applications?$top=1' },
  { perm: 'Group.Read.All',           url: '/groups?$top=1' },
  { perm: 'Directory.Read.All',       url: '/devices?$top=1' },
  { perm: 'Policy.Read.All',          url: '/policies/conditionalAccessPolicies?$top=1' },
  { perm: 'Reports.Read.All',         url: "/reports/getOffice365ActiveUserCounts(period='D7')" },
  { perm: 'SecurityIncident.Read.All', url: '/security/incidents?$top=1' },
  { perm: 'AuditLog.Read.All',        url: '/auditLogs/signIns?$top=1' },
  { perm: 'ServiceMessage.Read.All',  url: '/admin/serviceAnnouncement/messages?$top=1' },
];

// Verify the operator actually uploaded our generated .cer to the app
// registration's Certificates & secrets. We can't do a full
// Connect-ExchangeOnline at install time (no customer tenant onboarded, no
// Exchange Admin role yet), so we confirm the public half is on the app reg
// via Graph instead. The real EXO smoke test happens on first tenant onboard.
//
// ENCODING GOTCHA: Graph returns keyCredentials[].customKeyIdentifier as
// base64 of the SHA-1 thumbprint BYTES, not the hex string. We store the
// thumbprint as uppercase hex, so we convert hex → bytes → base64 before
// comparing. A naive hex-vs-base64 string compare always fails.
async function verifyCertOnAppReg(token, clientId) {
  const thumbHex = (process.env.GRAPH_CERT_THUMBPRINT || '').trim();
  if (!thumbHex) {
    return { checked: false, present: false, reason: 'cert_not_generated' };
  }
  let expectedB64;
  try {
    expectedB64 = Buffer.from(thumbHex, 'hex').toString('base64');
  } catch {
    return { checked: false, present: false, reason: 'bad_thumbprint' };
  }
  try {
    const url = `https://graph.microsoft.com/v1.0/applications?$filter=appId eq '${encodeURIComponent(clientId)}'&$select=appId,keyCredentials`;
    const r = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
    });
    if (!r.ok) {
      return { checked: false, present: false, reason: `graph_${r.status}` };
    }
    const body = await r.json();
    const app = (body.value || [])[0];
    const creds = (app && app.keyCredentials) || [];
    const present = creds.some((c) => {
      const ck = (c.customKeyIdentifier || '').replace(/\s/g, '');
      // Primary: base64-of-bytes match. Fallbacks: some Graph reads expose a
      // hex `thumbprint`/`customKeyIdentifier`; compare case-insensitively.
      return ck === expectedB64
        || ck.toUpperCase() === thumbHex
        || (c.thumbprint || '').replace(/:/g, '').toUpperCase() === thumbHex;
    });
    return { checked: true, present };
  } catch (e) {
    return { checked: false, present: false, reason: `network:${e.message}` };
  }
}

router.post('/entra/test', async (req, res) => {
  const tenantId = process.env.ENTRA_TENANT_ID;
  const clientId = process.env.ENTRA_CLIENT_ID;
  const clientSecret = process.env.ENTRA_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    return res.status(400).json({
      error: 'entra_not_configured',
      detail: 'Save Entra credentials before testing.',
    });
  }

  // ─── Step 1: Acquire an app-only access token ─────────────────────
  let token;
  try {
    const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'https://graph.microsoft.com/.default',
    });
    const tokenRes = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!tokenRes.ok) {
      let err = {};
      try { err = await tokenRes.json(); } catch { /* */ }
      // Common MS error codes that map to specific fixes:
      //   AADSTS90002 — tenant not found (wrong Tenant ID)
      //   AADSTS700016 — app not found in tenant (wrong Client ID or app not multi-tenant)
      //   AADSTS7000215 — invalid client secret (wrong Secret VALUE or Secret ID pasted)
      //   AADSTS50012 — invalid client (wrong Client ID format)
      const code = (err.error_description || '').match(/AADSTS\d+/)?.[0] || null;
      let hint = 'Double-check Tenant ID, Client ID, and Secret VALUE (NOT the Secret ID).';
      if (code === 'AADSTS7000215') hint = 'The Client Secret is wrong. Did you paste the Secret VALUE instead of the Secret ID? The VALUE is shown once at creation time.';
      else if (code === 'AADSTS90002') hint = 'The Tenant ID is wrong — Microsoft does not recognize it. Verify the Directory (tenant) ID on the app Overview page.';
      else if (code === 'AADSTS700016') hint = 'The Client ID is not registered in this tenant, OR the app is not configured as multi-tenant. Verify "Supported account types" is set to "Accounts in any organizational directory".';
      return res.status(401).json({
        error: 'token_request_failed',
        ms_error_code: code,
        detail: err.error_description || err.error || `HTTP ${tokenRes.status}`,
        hint,
      });
    }
    const tokenJson = await tokenRes.json();
    token = tokenJson.access_token;
  } catch (e) {
    return res.status(502).json({
      error: 'network_failure',
      detail: `Could not reach Microsoft token endpoint: ${e.message}`,
    });
  }

  // ─── Step 2: Run permission spot-checks in parallel ────────────────
  const results = await Promise.all(ENTRA_TEST_CHECKS.map(async (c) => {
    try {
      const r = await fetch(`https://graph.microsoft.com/v1.0${c.url}`, {
        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
      });
      return { perm: c.perm, status: r.status, ok: r.ok };
    } catch (e) {
      return { perm: c.perm, status: 0, ok: false, network_error: e.message };
    }
  }));

  const failed = results.filter(r => !r.ok);

  // ─── Step 3: Verify our cert is uploaded to the app registration ───
  const cert = await verifyCertOnAppReg(token, clientId);

  // Both gates must pass for the entra step to count as tested: permissions
  // granted AND the monitoring cert present on the app reg. This stops an
  // operator finishing setup with a missing/wrong cert (which would leave
  // every PowerShell reader stuck at "Awaiting Infra").
  if (failed.length === 0 && cert.present) {
    const state = setupState.readSetupState();
    const prev = state.steps.entra || { complete: true, at: new Date().toISOString() };
    setupState.markStepComplete('entra', { ...prev, tested: true });
    return res.json({
      ok: true,
      checks_performed: results.length,
      cert_present: true,
      message: 'All representative permissions are granted and the monitoring certificate is uploaded. Credentials look correct.',
    });
  }

  // Distinguish the two failure modes so the operator gets an actionable
  // message instead of a generic "permissions" error when the real problem
  // is the skipped cert upload.
  const certFail = !cert.present;
  return res.json({
    ok: false,
    checks_performed: results.length,
    checks_failed: failed.length,
    failed_permissions: failed.map(f => f.perm),
    cert_present: cert.present,
    cert_not_generated: cert.reason === 'cert_not_generated',
    hint: failed.length > 0
      ? 'Token acquired successfully, but Graph calls were rejected. Most likely: admin consent was not granted for one or more permissions. Re-open the App Registration instructions and verify the "Grant admin consent" step was completed and shows green checkmarks for every permission.'
      : (certFail
        ? 'Permissions look good, but the monitoring certificate was not found on the app registration. Did you complete the "Certificates & secrets" upload step? Re-open the App Registration instructions, download the certificate, and upload it under Certificates & secrets → Certificates.'
        : null),
  });
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
// Finalizes setup, then EXITS THE PROCESS so the container restart policy
// (restart: unless-stopped) revives it. That restart is what makes the
// wizard-collected credentials go live: env_file is gone (Option A, see
// docker-compose.yml), so the only thing that loads the now-populated,
// bind-mounted /app/.env into process.env is a fresh process start, whose
// dotenv (server.js line 6) runs before config is required. A plain
// restart-policy revive — not an in-place reload — is the robust,
// sidecar-free mechanism (a container cannot cleanly `compose up` itself).
//
// The wizard frontend does NOT redirect immediately after this returns; it
// shows a "Finishing setup — reconnecting…" screen that polls
// /api/boot-status until the restarted process reports entra_configured,
// then advances to sign-in / admin consent.
router.post('/complete', (req, res) => {
  let state;
  try {
    state = setupState.markSetupComplete();
    // Invalidate the setup middleware's 5s cache so the very next request
    // hits the new state (setup complete = pass-through everywhere).
    setupMiddleware.invalidateSetupModeCache();
  } catch (e) {
    return res.status(400).json({ error: 'cannot_complete', detail: e.message });
  }

  // Schedule the controlled exit only AFTER the response has been flushed to
  // the browser, so the wizard reliably gets its 200 before the socket drops.
  res.on('finish', () => {
    console.log(
      '[Setup] First-boot wizard complete — exiting so the container restart ' +
      'policy revives the process and dotenv loads the wizard-collected ' +
      'credentials from the bind-mounted .env. The wizard is polling ' +
      '/api/boot-status and will advance once the restarted process is up.',
    );
    // Small delay as a backstop so any trailing fs flush (setup.json /
    // completion flag chmod) settles and the kernel finishes sending the
    // response body before the process tears down.
    setTimeout(() => process.exit(0), 750);
  });

  res.json({
    ok: true,
    completed_at: state.completed_at,
    next_url: '/',
    restarting: true,
  });
});

module.exports = router;
