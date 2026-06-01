'use strict';

/**
 * cert-provisioner.js — wizard-driven app-only certificate provisioning.
 *
 * Exchange Online app-only PowerShell auth REQUIRES a certificate (EXO does
 * not accept a client secret the way Graph does). A fresh containerized
 * install ships pwsh + modules but no cert, so every powershell_* reader
 * shows "Awaiting Infra" until one is provisioned. This module mints that
 * keypair from inside the running app during the first-boot wizard:
 *
 *   - the PRIVATE half (.pfx, passwordless) stays on the server — the pwsh
 *     runner loads it via X509Certificate2(path, '').
 *   - the PUBLIC half (.cer, DER) is downloaded by the operator and uploaded
 *     to the app registration's Certificates & secrets blade in their own
 *     tenant. Entra stores only the public half + SHA-1 thumbprint.
 *
 * Modelled on ps-setup.sh's openssl steps (the VM install path) so the two
 * paths produce byte-identical artifacts. Generation is IDEMPOTENT: reopening
 * the wizard / restarting must NOT mint a fresh keypair (that would orphan a
 * .cer the operator already uploaded and silently break auth). A new keypair
 * is only minted on an explicit regenerate=true (deliberate rotation, used by
 * the future cert-management card).
 *
 * .env wiring follows the same self-contained pattern as
 * src/lib/license/store.js — each lib that must persist to .env mirrors the
 * parseEnvFile/updateEnvVars semantics rather than sharing api-setup's copy
 * (avoids a circular require: api-setup requires this module).
 */

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const util = require('util');
const config = require('../../../config/default');

const execFileP = util.promisify(execFile);

const PROJECT_ROOT = path.join(__dirname, '..', '..', '..');
const ENV_PATH = path.join(PROJECT_ROOT, '.env');

const CERT_SUBJECT = '/CN=Panoptica365';
const CERT_KEY_BITS = 2048;

// ──────────────────────────────────────────────────────────────
// Artifact paths
// ──────────────────────────────────────────────────────────────
// The runner loads GRAPH_CERT_PATH (…/panoptica-graph.pfx). We derive the
// sibling .key/.crt/.cer/.thumbprint from that same basename + dir so all
// five artifacts live together and match ps-setup.sh's naming.
function certPaths() {
  const pfxPath = process.env.GRAPH_CERT_PATH
    || path.join(config.pwsh.certDir, 'panoptica-graph.pfx');
  const dir = path.dirname(pfxPath);
  const base = path.basename(pfxPath, path.extname(pfxPath)); // panoptica-graph
  return {
    dir,
    key:   path.join(dir, `${base}.key`),
    crt:   path.join(dir, `${base}.crt`),
    pfx:   pfxPath,
    cer:   path.join(dir, `${base}.cer`),
    thumb: path.join(dir, `${base}.thumbprint`),
  };
}

// ──────────────────────────────────────────────────────────────
// .env writer — mirrors license/store.js / api-setup.js semantics
// ──────────────────────────────────────────────────────────────
function writeEnvVars(updates) {
  let content = '';
  try { content = fs.readFileSync(ENV_PATH, 'utf8'); } catch { content = ''; }
  const lines = content.split('\n');
  const idx = new Map();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) idx.set(m[1], i);
  }
  for (const [key, value] of Object.entries(updates)) {
    const safeVal = String(value);
    if (idx.has(key)) {
      lines[idx.get(key)] = `${key}=${safeVal}`;
    } else {
      lines.push(`${key}=${safeVal}`);
    }
    // Set live so the running process picks up the new cert without a
    // restart — pwsh-runner re-reads process.env per invocation.
    process.env[key] = safeVal;
  }
  fs.writeFileSync(ENV_PATH, lines.join('\n'), 'utf8');
}

// ──────────────────────────────────────────────────────────────
// Read the cert's notAfter (expiry) from the .crt via openssl
// ──────────────────────────────────────────────────────────────
async function readNotAfter(crtPath) {
  try {
    const { stdout } = await execFileP('openssl',
      ['x509', '-in', crtPath, '-noout', '-enddate']);
    // stdout: "notAfter=Jun  1 12:00:00 2031 GMT"
    const m = stdout.match(/notAfter=(.+)/);
    return m ? new Date(m[1].trim()).toISOString() : null;
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────────────────────
// ensureCert — generate-once-then-serve-same
// ──────────────────────────────────────────────────────────────
/**
 * Ensure an app-only certificate exists, generating it on first call.
 *
 * @param {object}  [opts]
 * @param {boolean} [opts.regenerate=false] — mint a fresh keypair even if one
 *        exists (deliberate rotation). Orphans the previously-uploaded .cer.
 * @returns {Promise<{thumbprint:string, notAfter:?string, certFileName:string,
 *                     regenerated:boolean}>}
 */
async function ensureCert({ regenerate = false } = {}) {
  const p = certPaths();

  // Idempotency: a valid .pfx + .thumbprint already on disk → serve as-is.
  if (!regenerate && fs.existsSync(p.pfx) && fs.existsSync(p.thumb)) {
    const thumbprint = fs.readFileSync(p.thumb, 'utf8').trim();
    if (thumbprint) {
      // Make sure .env still points at it (e.g. after a .env wipe + restore).
      if (process.env.GRAPH_CERT_PATH !== p.pfx
          || process.env.GRAPH_CERT_THUMBPRINT !== thumbprint) {
        writeEnvVars({ GRAPH_CERT_PATH: p.pfx, GRAPH_CERT_THUMBPRINT: thumbprint });
      }
      return {
        thumbprint,
        notAfter: fs.existsSync(p.crt) ? await readNotAfter(p.crt) : null,
        certFileName: path.basename(p.cer),
        regenerated: false,
      };
    }
  }

  // Generate. mkdir -p the (writable) cert dir first — the bind mount may be
  // an empty host dir.
  fs.mkdirSync(p.dir, { recursive: true });

  // 1. RSA key + self-signed cert in one shot (no passphrase: file perms are
  //    the protection; a passphrase would have to live in .env).
  await execFileP('openssl', [
    'req', '-x509', '-nodes',
    '-days', String(config.pwsh.certDays),
    '-newkey', `rsa:${CERT_KEY_BITS}`,
    '-keyout', p.key,
    '-out', p.crt,
    '-subj', CERT_SUBJECT,
    '-batch',
  ]);

  // 2. Bundle into a PASSWORDLESS PFX — the runner loads it with empty pwd.
  await execFileP('openssl', [
    'pkcs12', '-export',
    '-out', p.pfx,
    '-inkey', p.key,
    '-in', p.crt,
    '-name', 'Panoptica365 Graph Service',
    '-passout', 'pass:',
  ]);

  // 3. DER-encoded public half — what the operator uploads to Entra.
  await execFileP('openssl', [
    'x509', '-in', p.crt, '-outform', 'DER', '-out', p.cer,
  ]);

  // 4. SHA-1 thumbprint — uppercase hex, no colons (Entra/pwsh identity key).
  const { stdout: fp } = await execFileP('openssl',
    ['x509', '-in', p.crt, '-noout', '-fingerprint', '-sha1']);
  const thumbprint = (fp.split('=')[1] || '').replace(/:/g, '').trim().toUpperCase();
  fs.writeFileSync(p.thumb, thumbprint, 'utf8');

  // Lock down the private material.
  try {
    fs.chmodSync(p.key, 0o600);
    fs.chmodSync(p.pfx, 0o600);
    fs.chmodSync(p.crt, 0o644);
    fs.chmodSync(p.cer, 0o644);
    fs.chmodSync(p.thumb, 0o644);
  } catch { /* best-effort on filesystems that don't honor chmod */ }

  // 5. Wire .env (persists via the v0.1.30 bind-mount fix; sets live too).
  writeEnvVars({ GRAPH_CERT_PATH: p.pfx, GRAPH_CERT_THUMBPRINT: thumbprint });

  return {
    thumbprint,
    notAfter: await readNotAfter(p.crt),
    certFileName: path.basename(p.cer),
    regenerated: true,
  };
}

// Resolve the .cer path for streaming the download (null if not generated).
function cerPath() {
  const p = certPaths();
  return fs.existsSync(p.cer) ? p.cer : null;
}

module.exports = { ensureCert, certPaths, cerPath };
