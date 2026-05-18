#!/usr/bin/env node
/**
 * ────────────────────────────────────────────────────────────────────
 * Emergency one-shot: restore excludeUsers on Cuisi-N-Art's
 * "Panoptica365 - Require MFA for all users" CA policy.
 *
 * Background: the 2026-04-18 CA exemption migration appended excludeUsers
 * to every template's monitored_fields. On remediate-mode assignments the
 * next drift cycle PATCHed excludeUsers from the (empty) template to the
 * live policy, wiping ~22 per-tenant exclusions at Cuisi-N-Art.
 *
 * This script:
 *   1. Flips the affected assignment to 'monitor' so the next drift cycle
 *      cannot re-wipe what we're about to restore.
 *   2. Fetches the current live policy (to confirm excludeUsers is empty
 *      and show the current sibling fields that will be preserved).
 *   3. PATCHes excludeUsers back to the 22 object IDs supplied by Jacques.
 *   4. Verifies by re-fetching.
 *
 * Idempotent — safe to re-run if something fails mid-way. Does NOT touch
 * any field other than conditions.users.excludeUsers.
 *
 * Run on the Panoptica VM:
 *   cd /opt/panoptica && node scripts/restore-cuisi-excludeusers.js
 * ────────────────────────────────────────────────────────────────────
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const db = require('../src/db/database');
const graph = require('../src/graph');

// ─── Inputs ─────────────────────────────────────────────────────────
// The 22 user Object IDs to restore (from the wiped live policy).
const EXCLUDE_USER_IDS = [
  '6c57f203-de73-4142-980d-cf112b3286e0',
  '3a32107c-fa6e-4c69-b0e5-1b44b56d277d',
  '0db29ef0-5010-48bc-ad74-276d8dcad8b1',
  '3240fed2-f904-413f-9250-ea50fde94070',
  '1cb24006-9b09-4c53-84d6-dae7b964d54a',
  '24084764-0c21-4bf1-ad20-2bd2023eb9da',
  '3de22b09-170b-4b25-b732-e44eb32109e8',
  '1489187a-6d43-467e-ae73-043a3d295860',
  '3e2c5969-8518-402a-8cc0-58dd5dae75bc',
  '5362dd86-79ff-4c78-9d35-0ee459d04331',
  '2e3394c9-6fae-43f3-aa4e-c351400058fb',
  '02dee11e-a574-4ca4-829d-63370aeb7d7c',
  '51dd5d1f-b8ab-47c5-8481-3750cc8c2c9d',
  '606bbe2b-0313-4d46-8f43-4bd769c82943',
  '74dc01be-a685-4981-b3bd-196f80342671',
  '0e239491-5142-427d-8d95-3bbbf5f0765e',
  '27a3bf79-6046-41ee-9a49-575269af7116',
  '5215462e-1314-4172-86dc-a33e336d9fdd',
  '05251772-4a5f-4f5a-a34d-8736d4e4abab',
  '24853c4f-b32b-4985-9759-d89ed854ae4b',
  '454d0db7-b867-42eb-bc66-46dd225c5601',
  '52bcb83c-ca10-4318-b4b6-059dfcae9cdf',
];

// Lookup heuristics — edit these if your tenant / template is named differently.
const TENANT_NAME_LIKE = '%Cuisi%';
const TEMPLATE_NAME_LIKE = '%Require MFA for all users%';

// ─── Main ───────────────────────────────────────────────────────────

async function main() {
  console.log(`\n[Restore] Looking up Cuisi-N-Art assignment for "${TEMPLATE_NAME_LIKE.replace(/%/g, '')}"…`);

  const rows = await db.queryRows(
    `SELECT a.id            AS assignment_id,
            a.tenant_id,
            a.template_id,
            a.enforcement,
            a.live_policy_id,
            t.display_name  AS tenant_name,
            t.tenant_id     AS azure_tenant_id,
            tpl.name        AS template_name
       FROM ca_assignments a
       JOIN tenants t       ON t.id   = a.tenant_id
       JOIN ca_templates tpl ON tpl.id = a.template_id
      WHERE t.display_name LIKE ?
        AND tpl.name       LIKE ?`,
    [TENANT_NAME_LIKE, TEMPLATE_NAME_LIKE]
  );

  if (rows.length === 0) {
    console.error(`[Restore] No assignment found for tenant LIKE ${TENANT_NAME_LIKE} + template LIKE ${TEMPLATE_NAME_LIKE}.`);
    console.error('[Restore] Edit TENANT_NAME_LIKE / TEMPLATE_NAME_LIKE at the top of the script and re-run.');
    process.exit(1);
  }
  if (rows.length > 1) {
    console.error(`[Restore] Ambiguous match — ${rows.length} assignments matched:`);
    rows.forEach(r => console.error(`  - assignment ${r.assignment_id}: ${r.tenant_name} / ${r.template_name}`));
    console.error('[Restore] Narrow the LIKE patterns and re-run.');
    process.exit(1);
  }

  const asn = rows[0];
  console.log(`[Restore] Target: assignment ${asn.assignment_id} — ${asn.tenant_name} / ${asn.template_name}`);
  console.log(`[Restore]   Azure tenant: ${asn.azure_tenant_id}`);
  console.log(`[Restore]   Live policy : ${asn.live_policy_id}`);
  console.log(`[Restore]   Enforcement : ${asn.enforcement}`);

  if (!asn.live_policy_id) {
    console.error('[Restore] No live_policy_id on the assignment — nothing to PATCH.');
    process.exit(1);
  }

  // ─── Step 1: flip to monitor first, so a drift cycle can't re-wipe ───
  if (asn.enforcement !== 'monitor') {
    console.log(`[Restore] Flipping enforcement 'remediate' → 'monitor' to prevent re-wipe…`);
    await db.execute(
      `UPDATE ca_assignments SET enforcement = 'monitor' WHERE id = ?`,
      [asn.assignment_id]
    );
    console.log('[Restore]   OK — flipped to monitor.');
  } else {
    console.log('[Restore] Already in monitor mode — skipping enforcement flip.');
  }

  // ─── Step 2: fetch the current live policy ───
  console.log('[Restore] Fetching current live policy from Graph…');
  const livePolicy = await graph.callGraph(
    asn.azure_tenant_id,
    `/identity/conditionalAccess/policies/${asn.live_policy_id}`,
    { version: 'v1.0' }
  );

  const currentExcludeUsers = livePolicy?.conditions?.users?.excludeUsers || [];
  console.log(`[Restore]   Current excludeUsers length: ${currentExcludeUsers.length}`);
  if (currentExcludeUsers.length > 0) {
    console.log('[Restore]   Current excludeUsers (pre-PATCH):');
    currentExcludeUsers.forEach(id => console.log(`     - ${id}`));
  }

  // Merge: union of whatever's currently there + the 22 supplied IDs.
  // In practice the live array is empty (the wipe happened), but union is
  // safer in case the script is run a second time after partial restore.
  const merged = Array.from(new Set([...currentExcludeUsers, ...EXCLUDE_USER_IDS]));
  console.log(`[Restore]   Will PATCH excludeUsers to ${merged.length} unique IDs.`);

  // Show siblings for transparency — these MUST be preserved by the PATCH.
  const u = livePolicy?.conditions?.users || {};
  console.log('[Restore]   Sibling fields (untouched by PATCH):');
  console.log(`     includeUsers  : ${(u.includeUsers  || []).length} entries`);
  console.log(`     includeGroups : ${(u.includeGroups || []).length} entries`);
  console.log(`     excludeGroups : ${(u.excludeGroups || []).length} entries`);
  console.log(`     includeRoles  : ${(u.includeRoles  || []).length} entries`);
  console.log(`     excludeRoles  : ${(u.excludeRoles  || []).length} entries`);

  // ─── Step 3: PATCH ───
  console.log('[Restore] Sending PATCH…');
  await graph.callGraph(
    asn.azure_tenant_id,
    `/identity/conditionalAccess/policies/${asn.live_policy_id}`,
    {
      version: 'v1.0',
      method: 'PATCH',
      body: { conditions: { users: { excludeUsers: merged } } },
    }
  );
  console.log('[Restore]   OK — Graph accepted the PATCH.');

  // ─── Step 4: verify ───
  console.log('[Restore] Re-fetching to verify…');
  const after = await graph.callGraph(
    asn.azure_tenant_id,
    `/identity/conditionalAccess/policies/${asn.live_policy_id}`,
    { version: 'v1.0' }
  );
  const newExcludeUsers = after?.conditions?.users?.excludeUsers || [];
  console.log(`[Restore]   New excludeUsers length: ${newExcludeUsers.length}`);

  const missing = merged.filter(id => !newExcludeUsers.includes(id));
  if (missing.length > 0) {
    console.error(`[Restore] WARNING: ${missing.length} IDs are NOT present after PATCH:`);
    missing.forEach(id => console.error(`     - ${id}`));
    console.error('[Restore] Common cause: an ID refers to a user that no longer exists in the tenant directory — Graph silently drops those.');
  } else {
    console.log('[Restore]   All 22 target IDs are present in the live policy. Done.');
  }

  // Sanity check: siblings still look right
  const uAfter = after?.conditions?.users || {};
  const siblingChanged =
    (uAfter.includeUsers  || []).length !== (u.includeUsers  || []).length ||
    (uAfter.includeGroups || []).length !== (u.includeGroups || []).length ||
    (uAfter.excludeGroups || []).length !== (u.excludeGroups || []).length;
  if (siblingChanged) {
    console.error('[Restore] WARNING: sibling field lengths changed after PATCH — inspect the policy manually.');
  }

  console.log('\n[Restore] Next steps:');
  console.log('  1. Assignment is now monitor-mode — drift cycle will flag but NOT wipe.');
  console.log('  2. Do NOT flip back to remediate until the non-remediable-fields guard ships (task #5).');
  console.log('  3. After the next drift cycle fires, use accept-drift-as-exemption to lift these into ca_exemptions.\n');
}

main()
  .then(() => db.close().then(() => process.exit(0)))
  .catch(async (err) => {
    console.error('[Restore] FAILED:', err.message);
    if (err.stack) console.error(err.stack);
    await db.close().catch(() => {});
    process.exit(1);
  });
