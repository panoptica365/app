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
const CERT_BASENAME = 'panoptica-graph';

// data/state is already a writable, host-persisted bind mount (the wizard
// writes setup.json there). It is our guaranteed-writable fallback when the
// preferred certs dir is read-only or root-owned — see ensureCert. Using it
// means cert generation works even before the ./certs rw mount change is
// deployed, and survives container recreates either way.
const FALLBACK_CERT_DIR = path.join(PROJECT_ROOT, 'data', 'state', 'certs');

function pathsFor(pfxPath) {
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

// Where the cert lives. Once generated, GRAPH_CERT_PATH points at the actual
// file (preferred dir OR the fallback), so this stays consistent across calls
// (e.g. the download endpoint resolving the .cer after generation).
function certPaths() {
  const pfxPath = process.env.GRAPH_CERT_PATH
    || path.join(config.pwsh.certDir, `${CERT_BASENAME}.pfx`);
  return pathsFor(pfxPath);
}

// A directory is usable if we can create it (idempotent) AND write to it.
// Catches both the read-only bind mount (EROFS) and the root-owned empty
// dir the container user can't write (EACCES) — the two sharp edges.
function isWritableDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
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

// Run openssl, surfacing a CLEAN error on failure. openssl writes RSA
// key-generation progress (".+.+...+++++") to stderr; on a real failure
// execFile's message would otherwise be those dots followed by the actual
// error. Strip the noise so the UI shows just the meaningful message.
async function openssl(args) {
  try {
    return await execFileP('openssl', args);
  } catch (e) {
    // Strip only the long runs of progress dots/pluses (".+.+...+++++"),
    // not single dots in file paths, then collapse whitespace.
    const clean = String(e.stderr || e.message || '')
      .replace(/[.+]{3,}/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    throw new Error(`openssl ${args[0]} failed: ${clean || e.message}`);
  }
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
  let p = certPaths();

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

  // Resolve a WRITABLE cert dir before generating. Prefer the configured
  // certs dir (matches ps-setup.sh convention); if it's read-only or
  // root-owned (sharp edge #1 — the ./certs:ro mount, or a root-owned empty
  // bind dir), fall back to the always-writable persisted data/state mount.
  if (!isWritableDir(p.dir)) {
    if (!isWritableDir(FALLBACK_CERT_DIR)) {
      throw new Error(
        `No writable certificate directory. Tried "${p.dir}" (read-only or ` +
        `not owned by the app user) and "${FALLBACK_CERT_DIR}". Mount ./certs ` +
        `read-write, or ensure data/state is writable.`
      );
    }
    // Switch all artifact paths to the fallback dir.
    p = pathsFor(path.join(FALLBACK_CERT_DIR, `${CERT_BASENAME}.pfx`));
  }

  // 1. RSA key + self-signed cert in one shot (no passphrase: file perms are
  //    the protection; a passphrase would have to live in .env).
  await openssl([
    'req', '-x509', '-nodes',
    '-days', String(config.pwsh.certDays),
    '-newkey', `rsa:${CERT_KEY_BITS}`,
    '-keyout', p.key,
    '-out', p.crt,
    '-subj', CERT_SUBJECT,
    '-batch',
  ]);

  // 2. Bundle into a PASSWORDLESS PFX — the runner loads it with empty pwd.
  await openssl([
    'pkcs12', '-export',
    '-out', p.pfx,
    '-inkey', p.key,
    '-in', p.crt,
    '-name', 'Panoptica365 Graph Service',
    '-passout', 'pass:',
  ]);

  // 3. DER-encoded public half — what the operator uploads to Entra.
  await openssl([
    'x509', '-in', p.crt, '-outform', 'DER', '-out', p.cer,
  ]);

  // 4. SHA-1 thumbprint — uppercase hex, no colons (Entra/pwsh identity key).
  const { stdout: fp } = await openssl(
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
