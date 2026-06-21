/**
 * Panoptica — Tenant Domain Resolver
 *
 * Backfills each tenant's verified domains (default + initial *.onmicrosoft.com)
 * so the Management Consoles Launcher can build the Exchange / Teams / Intune /
 * SharePoint deep-links. Navigation-only feature — this reads `/organization`
 * (already consented: Directory.Read.All, used by fetchers + SharePoint +
 * EXO domain resolution) and writes ONLY to our own tenants table, never to the
 * customer tenant.
 *
 * Zero operator action: domains are captured automatically at three moments —
 *   1. onboarding (fire-and-forget right after the consent INSERT),
 *   2. once on boot (this module's start()),
 *   3. a 24 h safety pass (re-tries tenants still missing a domain, e.g. a
 *      GDAP relationship that had lapsed and was since restored).
 *
 * Not a high-frequency poller — domains effectively never change once set, so
 * resolveMissingDomains() only ever touches rows where default_domain IS NULL.
 */

const db = require('./db/database');
const graph = require('./graph');

let timer = null;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
// Defer the boot pass so it doesn't pile onto server-startup work (mirrors the
// UAL worker's deferred first cycle).
const BOOT_DELAY_MS = 45 * 1000;

/**
 * Resolve and store the verified domains for a single tenant.
 * @param {{ id:number, tenant_id:string, display_name?:string }} tenant
 * @returns {Promise<{default_domain:string, initial_domain:string}|null>}
 *   the resolved domains, or null if none could be resolved (left NULL for the
 *   next pass to retry).
 *
 * Never throws to the caller of a batch — failures are caught and logged
 * non-fatal so one lapsed-GDAP tenant can't poison the whole sweep.
 */
async function resolveOneTenant(tenant) {
  if (!tenant || !tenant.tenant_id) return null;
  const label = tenant.display_name || tenant.tenant_id;

  let org;
  try {
    org = await graph.callGraph(tenant.tenant_id, '/organization?$select=id,verifiedDomains');
  } catch (err) {
    // A lapsed/never-granted GDAP relationship surfaces here as a 403/auth
    // error — expected, self-heals on the next pass once consent is restored.
    console.warn(`[DomainResolver] Could not read /organization for ${label}: ${err.message}`);
    return null;
  }

  // /organization returns { value: [ { verifiedDomains: [...] } ] }; handle the
  // bare-entity shape too, defensively (same pattern as pwsh-runner.js).
  const orgEntity = (Array.isArray(org && org.value) && org.value[0]) || org;
  const domains = Array.isArray(orgEntity && orgEntity.verifiedDomains) ? orgEntity.verifiedDomains : [];

  // default: prefer isDefault, fall back to isInitial, then first verified.
  // initial: the *.onmicrosoft.com domain (isInitial); fall back to default.
  const def = domains.find(d => d && d.isDefault) || domains.find(d => d && d.isInitial) || domains[0];
  const init = domains.find(d => d && d.isInitial) || def;

  const defaultDomain = def && def.name;
  const initialDomain = (init && init.name) || defaultDomain;

  if (!defaultDomain) {
    console.warn(`[DomainResolver] No verified domain returned for ${label} — leaving NULL for retry`);
    return null;
  }

  // UTC_TIMESTAMP() (NOT NOW(): the MySQL session TZ is Eastern, stored
  // datetimes are UTC). Pass plain strings — never JS Date objects.
  await db.execute(
    `UPDATE tenants
        SET default_domain = ?, initial_domain = ?, domain_resolved_at = UTC_TIMESTAMP()
      WHERE id = ?`,
    [defaultDomain, initialDomain, tenant.id]
  );
  console.log(`[DomainResolver] Resolved ${label}: default=${defaultDomain} initial=${initialDomain}`);
  return { default_domain: defaultDomain, initial_domain: initialDomain };
}

/**
 * Resolve domains for every enabled tenant that doesn't have them yet.
 * Per-tenant failures are swallowed (logged) so the batch always completes.
 */
async function resolveMissingDomains() {
  let tenants;
  try {
    tenants = await db.queryRows(
      `SELECT id, tenant_id, display_name
         FROM tenants
        WHERE enabled = TRUE AND default_domain IS NULL`
    );
  } catch (err) {
    console.error('[DomainResolver] Could not list tenants needing domains (non-fatal):', err.message);
    return;
  }
  if (!tenants.length) return;

  console.log(`[DomainResolver] Resolving domains for ${tenants.length} tenant(s)…`);
  let resolved = 0;
  for (const t of tenants) {
    try {
      if (await resolveOneTenant(t)) resolved++;
    } catch (err) {
      // resolveOneTenant already guards its own Graph call; this is a final
      // belt-and-suspenders so a DB write error on one row can't abort the loop.
      console.warn(`[DomainResolver] resolveOneTenant failed for ${t.display_name || t.tenant_id} (non-fatal):`, err.message);
    }
  }
  console.log(`[DomainResolver] Pass complete — ${resolved}/${tenants.length} resolved`);
}

/**
 * Run the backfill once on boot (deferred), then re-run every 24 h as a safety
 * pass. Idempotent — calling twice is a no-op.
 */
function start() {
  if (timer) {
    console.warn('[DomainResolver] start called twice — ignoring duplicate');
    return;
  }
  setTimeout(() => {
    resolveMissingDomains().catch(err => console.error('[DomainResolver] Boot pass failed:', err.message));
  }, BOOT_DELAY_MS);
  timer = setInterval(() => {
    resolveMissingDomains().catch(err => console.error('[DomainResolver] Daily pass failed:', err.message));
  }, ONE_DAY_MS);
  // Never let the safety-pass timer hold the process open at shutdown.
  if (timer.unref) timer.unref();
  console.log('[DomainResolver] Started — boot pass + 24h safety pass');
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
    console.log('[DomainResolver] Stopped');
  }
}

module.exports = {
  resolveOneTenant,
  resolveMissingDomains,
  start,
  stop,
};
