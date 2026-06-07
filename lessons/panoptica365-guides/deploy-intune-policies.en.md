---
title: "Deploy Intune policies"
subtitle: "Same template-and-drift model as CA, applied to device configuration: assign, deploy, watch."
icon: "monitor-smartphone"
last_updated: 2026-06-07
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

## The rhythm

Onboard tenant → deploy your standard Intune baseline → forget about it. From then on, drift alerts arrive when someone changes a deployed policy in the customer tenant, and the **Compliant Devices** card on the Overview tab tells you whether devices are actually meeting the bar you set.
