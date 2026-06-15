---
title: "Deploy Intune policies"
subtitle: "Same template-and-drift model as CA, applied to device configuration: assign, deploy, watch."
icon: "monitor-smartphone"
last_updated: 2026-06-15
---

# Deploy Intune policies

If you've read the CA policies guide, this one will feel familiar — deliberately. Intune deployments use the same template-and-drift model: a library you maintain (sidebar → **Intune Policies**), per-tenant deployments, and continuous drift detection on what's live.

The templates themselves — what settings to pick, what a sane Windows baseline looks like — are covered in the **Intune Template Settings** card in Learn. This guide is the mechanics.

## Deploying policies to a tenant

1. Open the tenant dashboard → **Intune Policies** tab. Fresh tenant: *"No Intune policy templates assigned to this tenant yet. Click 'Add Policies' to start."*
2. Click **Add Policies**. The picker lists your Intune template library — settings catalogs, device configurations, compliance policies, admin templates, security baselines.
3. Select the policies to deploy and choose the **assignment target**: **All Users**, **All Devices**, or **None** (deploy unassigned, wire up assignment in the console later).
4. Deploy. Each policy becomes a card showing its name, type, state, assignment target, and a drift badge.

## Drift detection

The drift cycle compares each deployed policy against its template, exactly like CA:

- **ok** — live policy matches.
- **drifted** — a setting was changed tenant-side.
- **accepted** — drift reviewed and accepted by an operator.

Per-card actions: **Check Drift** (compare now), **Deploy** (re-apply), and **Accept** (open the acceptance modal).

## Accepting Intune drift

The acceptance modal offers the same two paths as CA:

- **Accept with expiry** *(recommended)* — accepted until the date you pick (180-day default), reason required. The acceptance appears in the **Exemptions** page. Note that Intune exemptions are **policy-wide** — they accept the deployment's current drift as a whole, not a per-user exception.
- **Accept Once, forever** — indefinite; re-fires only if the drift changes shape.

When an exemption expires or is revoked, the next Intune drift cycle flags the deployment as drifted again, requiring re-review. Nothing silently stays accepted.

## One important caution

Avoid editing Panoptica365-deployed policies directly in the Intune console for per-tenant tweaks (extra exclusion groups, one-off setting changes). The platform's job is to converge live policies back to the template — console-side customizations either trigger perpetual drift alerts or get overwritten on a re-deploy. If a tenant genuinely needs a variation, make it explicit: a separate template, or an accepted, documented, time-boxed drift.

## Adopt existing settings in place (tenant-sourced)

Just like CA, you can adopt a tenant's **existing** Intune configurations instead of pushing your templates first. On the **Intune Policies** tab, click **Import existing settings**. Panoptica reads the tenant's live configurations — across the same types your library supports (settings catalogs, device configurations, compliance policies, administrative templates, security baselines) — and creates a **Tenant-sourced** card (red edge + badge) for each one it doesn't already manage. Anything you deployed from a template is matched by object id and skipped, so you never get duplicates; re-clicking is safe.

Each card is baselined as-found — both the configuration **and its assignments** — and watched for change. A tenant-sourced card's alert reads *"changed from as-found."* Intune drift is caught on the **daily** sweep: unlike new CA policies, Intune changes aren't in the audit-log stream, so there's no minutes-latency path — the daily reconcile is the backstop.

Open a card's **Actions** for three choices:

1. **Stop monitoring** — removes the card; never touches the tenant.
2. **Deactivate in tenant** — Intune has no global "off" switch, so Panoptica **snapshots the full assignment set first**, then removes all assignments so the config applies to no one. **Restore** replays the exact assignments. That pre-snapshot is what makes deactivate reversible — without it, stripping assignments would be a one-way door.
3. **Delete from tenant** — permanently removes the configuration; deleting asks you to type your own name to confirm.

All three are recorded in the MSP audit log and the tenant's Change Log. And as with CA, Panoptica watches every tenant for an Intune configuration created **outside Panoptica** and surfaces it as a tenant-sourced card plus an alert.

## The rhythm

Onboard tenant → deploy your standard Intune baseline → forget about it. From then on, drift alerts arrive when someone changes a deployed policy in the customer tenant, and the **Compliant Devices** card on the Overview tab tells you whether devices are actually meeting the bar you set.
