/**
 * Panoptica365 — License Token Validator
 *
 * Verifies Ed25519-signed JWTs issued by the Panoptica365 license server.
 * Uses the public key baked into the image at keys/license-server-public-key.pem;
 * verification is fully offline — license-server outage cannot block boot.
 *
 * Design notes (locked May 24, 2026):
 *
 *   - Algorithm is EdDSA (Ed25519). Anything else is rejected.
 *
 *   - Issuer is fixed to 'panoptica365-license-server'. A token signed by a
 *     different issuer (even with the right key) fails.
 *
 *   - Fingerprint binding: every JWT carries a `fingerprint` claim. The
 *     caller passes the install's actual fingerprint; we reject if they
 *     don't match exactly. Stops copying tokens between installs.
 *
 *   - Generalized stale-acceptance (May 24 design refinement): when
 *     jose.jwtVerify throws JWTExpired, we decode the token unverified to
 *     read billing_mode, then re-verify with a 100-year clockTolerance.
 *     This still enforces signature + issuer + algorithm but bypasses exp.
 *     The returned `stale` flag tells the caller the token is past exp.
 *
 *     Why for BOTH NFR and paid (not just NFR): the three-phase degrade
 *     timeline for paid (warning 1-14d / soft 15-21d / hard 22+d) is
 *     measured FROM exp. If the validator hard-failed on paid+expired,
 *     boot would crash and the degrade phases could never trigger.
 *     Instead: validator accepts stale, marks stale=true, and the
 *     degrade middleware (Stage C) reads billing_mode + stale + exp to
 *     decide what the install can still do. NFR + stale → no degrade
 *     (refresh client retries urgently). Paid + stale → degrade phases.
 *
 *   - `jose` is lazy-loaded inside loadAndVerifyLicenseToken() so this
 *     module can be `require()`d cheaply (e.g., by unit tests) without
 *     pulling in the crypto bundle.
 *
 *   - Public key is loaded ONCE and cached in module scope. Pem path is
 *     hardcoded to `keys/license-server-public-key.pem` relative to the
 *     project root — the .gitignore `!keys/...` negation guarantees the
 *     file is in-tree; the Dockerfile's `COPY . .` step copies it into
 *     the image. No env var override — making the verification key
 *     configurable would defeat the offline-verification guarantee.
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..', '..', '..');
const PUBLIC_KEY_PATH = path.join(PROJECT_ROOT, 'keys', 'license-server-public-key.pem');
const EXPECTED_ISSUER = 'panoptica365-license-server';
const EXPECTED_ALG = 'EdDSA';

// 100 years in seconds — effectively "ignore exp" for NFR stale-recovery.
// Picked deliberately large rather than Infinity because jose validates the
// tolerance is a finite number.
const NFR_STALE_CLOCK_TOLERANCE_SEC = 60 * 60 * 24 * 365 * 100;

// Module-scope caches. These are intentional singletons: the public key is
// immutable across the process lifetime, and the parsed key is expensive to
// re-import on every call.
let _josePromise = null;
let _publicKeyPromise = null;
let _lastVerifiedClaims = null;

/**
 * Lazy-load the jose library. Returns a promise; resolves to the module.
 */
function getJose() {
  if (!_josePromise) {
    _josePromise = Promise.resolve(require('jose'));
  }
  return _josePromise;
}

/**
 * Lazy-load + parse the public key. Returns a promise; resolves to a
 * jose KeyLike. Cached for the process lifetime — never re-read from disk.
 */
function getPublicKey() {
  if (!_publicKeyPromise) {
    _publicKeyPromise = (async () => {
      const jose = await getJose();
      if (!fs.existsSync(PUBLIC_KEY_PATH)) {
        throw new LicenseError(
          'PUBLIC_KEY_MISSING',
          `License server public key not found at ${PUBLIC_KEY_PATH}. ` +
          `This installation cannot verify license tokens. Re-deploy a clean image ` +
          `from GHCR (the public key is baked into every release).`
        );
      }
      const pem = fs.readFileSync(PUBLIC_KEY_PATH, 'utf8');
      return jose.importSPKI(pem, EXPECTED_ALG);
    })();
    // If the import fails, allow a retry on the next call (don't poison the
    // cache permanently — the operator may swap in a corrected key file).
    _publicKeyPromise.catch(() => { _publicKeyPromise = null; });
  }
  return _publicKeyPromise;
}

/**
 * Categorized error thrown by the validator. The `code` is machine-readable
 * for the boot-error-message formatter; the `message` is operator-readable.
 *
 * Codes:
 *   PUBLIC_KEY_MISSING        — image deployment problem
 *   TOKEN_MISSING             — no LICENSE_TOKEN AND no cache file
 *   TOKEN_MALFORMED           — string isn't a JWT
 *   SIGNATURE_INVALID         — signature failed verification (tamper / wrong key)
 *   WRONG_ISSUER              — JWT signed for a different service
 *   WRONG_ALGORITHM           — JWT used something other than EdDSA
 *   FINGERPRINT_MISMATCH      — JWT fingerprint claim != install fingerprint
 *   TOKEN_EXPIRED             — paid license has expired (server-side)
 *   FINGERPRINT_REQUIRED      — caller passed empty / missing fingerprint
 *   UNKNOWN                   — anything else
 */
class LicenseError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'LicenseError';
    this.code = code;
  }
}

/**
 * Verify a JWT against the embedded public key and an expected fingerprint.
 *
 * Returns: { claims, stale }
 *   claims — the verified JWT payload (object)
 *   stale  — true if the JWT exp was bypassed via NFR stale-acceptance
 *
 * Throws LicenseError on any failure.
 */
async function loadAndVerifyLicenseToken(token, expectedFingerprint) {
  if (!token || typeof token !== 'string' || token.length < 20) {
    throw new LicenseError('TOKEN_MISSING', 'License token is empty or unreasonably short.');
  }
  if (!expectedFingerprint || typeof expectedFingerprint !== 'string') {
    throw new LicenseError(
      'FINGERPRINT_REQUIRED',
      'No install fingerprint provided to the validator.',
    );
  }

  const jose = await getJose();
  const publicKey = await getPublicKey();

  let payload;
  let stale = false;

  try {
    const verified = await jose.jwtVerify(token, publicKey, {
      issuer: EXPECTED_ISSUER,
      algorithms: [EXPECTED_ALG],
    });
    payload = verified.payload;
  } catch (e) {
    // jose error class names: JWTExpired, JWTInvalid, JWSSignatureVerificationFailed,
    // JWTClaimValidationFailed, JWSInvalid. Map to our LicenseError taxonomy.

    if (e?.code === 'ERR_JWT_EXPIRED' || e?.name === 'JWTExpired') {
      // Stale-acceptance recovery. Applies to BOTH billing modes — see
      // module header for rationale. The degrade middleware (Stage C)
      // discriminates by billing_mode + stale flag, not the validator.
      //
      // Re-verify with a clockTolerance large enough to bypass exp for any
      // realistic refresh-outage window (100 years). Signature is still
      // checked — a stale-but-tampered token still fails as SIGNATURE_INVALID.
      try {
        const reverified = await jose.jwtVerify(token, publicKey, {
          issuer: EXPECTED_ISSUER,
          algorithms: [EXPECTED_ALG],
          clockTolerance: NFR_STALE_CLOCK_TOLERANCE_SEC,
        });
        payload = reverified.payload;
        stale = true;
      } catch (e2) {
        // Signature really is bad; the original "expired" was masking a
        // tamper. Surface as signature-invalid, not expired.
        throw new LicenseError(
          'SIGNATURE_INVALID',
          'Stale-recovery failed signature verification — token may be tampered.',
        );
      }
    } else if (
      e?.code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' ||
      e?.name === 'JWSSignatureVerificationFailed'
    ) {
      throw new LicenseError(
        'SIGNATURE_INVALID',
        'License token signature did not verify against the embedded public key. ' +
        'Token was either signed by a different keypair or has been tampered with.',
      );
    } else if (
      e?.code === 'ERR_JWT_CLAIM_VALIDATION_FAILED' ||
      e?.name === 'JWTClaimValidationFailed'
    ) {
      // jose's claim validation covers our `issuer` filter. If the claim was
      // `iss`, it's WRONG_ISSUER; anything else is bucket-routed to UNKNOWN.
      if (e?.claim === 'iss') {
        throw new LicenseError(
          'WRONG_ISSUER',
          `License token was issued by '${e?.payload?.iss}', expected '${EXPECTED_ISSUER}'.`,
        );
      }
      throw new LicenseError('UNKNOWN', `Claim validation failed: ${e.message}`);
    } else if (
      e?.code === 'ERR_JWS_INVALID' ||
      e?.name === 'JWSInvalid' ||
      e?.code === 'ERR_JWT_INVALID' ||
      e?.name === 'JWTInvalid'
    ) {
      throw new LicenseError('TOKEN_MALFORMED', `License token is not a well-formed JWT: ${e.message}`);
    } else {
      throw new LicenseError('UNKNOWN', `License verification failed: ${e?.message || e}`);
    }
  }

  // ─── Post-signature claim checks (algorithm + fingerprint) ────────────
  // jose's `algorithms` option already enforces this, but defense-in-depth:
  // we re-check the algorithm header so a future jose version change can't
  // silently broaden what we accept.
  // (No way to read the protected header from the verified payload without
  // re-parsing; skip the explicit alg recheck — jose enforces it via the
  // algorithms option above.)

  if (!payload || typeof payload !== 'object') {
    throw new LicenseError('TOKEN_MALFORMED', 'Verified JWT payload is empty.');
  }

  if (payload.fingerprint !== expectedFingerprint) {
    throw new LicenseError(
      'FINGERPRINT_MISMATCH',
      `Token fingerprint does not match this install's fingerprint. ` +
      `Token was issued for a different installation. ` +
      `Re-run /api/v1/activate with the correct fingerprint.`,
    );
  }

  // Cache the most recently verified claims (read by getLicenseClaims()).
  _lastVerifiedClaims = { ...payload, _stale: stale };

  return { claims: payload, stale };
}

/**
 * Returns the most recently verified claims, or null if no token has been
 * verified in this process lifetime. Includes a `_stale` flag indicating
 * whether the last verification accepted a stale NFR token.
 */
function getLicenseClaims() {
  return _lastVerifiedClaims;
}

/**
 * Test seam: reset module-scope caches. Used by unit tests. Not part of
 * the public API for production callers.
 */
function _resetForTests() {
  _josePromise = null;
  _publicKeyPromise = null;
  _lastVerifiedClaims = null;
}

module.exports = {
  loadAndVerifyLicenseToken,
  getLicenseClaims,
  LicenseError,
  // Exposed constants for the boot-error-message formatter:
  EXPECTED_ISSUER,
  EXPECTED_ALG,
  PUBLIC_KEY_PATH,
  // Test seam — not stable API.
  _resetForTests,
};
