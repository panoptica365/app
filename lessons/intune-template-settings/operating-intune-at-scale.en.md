---
title: "Operating Intune at scale — drift, exclusions, lifecycle, the assignment-loss problem"
subtitle: "The most expensive operational pattern in Intune: how delete-and-recreate silently drops per-tenant exclusions, and how to prevent it."
icon: "settings-2"
last_updated: 2026-05-29
---

# Operating Intune at scale — drift, exclusions, lifecycle, the assignment-loss problem

A growing MSP discovered in late 2025 that 12 of their customers had silently lost their per-tenant exclusion groups on the Account Protection Intune template. The exclusions had been carefully configured — kiosk devices excluded so they wouldn't get Windows Hello prompts they couldn't satisfy, specific service accounts excluded from policies that would have broken their workflows. Then someone updated the Account Protection template in Panoptica365 — modernised a few settings, added a new requirement — and pushed the update. The update redeployed the template across all customers. The Intents-style template's underlying behaviour is delete-and-recreate. The old per-tenant exclusion configurations were silently dropped.

Nobody noticed for six weeks. By then, several customers had reported unexplained user lockouts on devices that shouldn't have been in scope.

This is the most expensive operational pattern in Intune. The fix isn't difficult; the awareness is. This lesson is the closer for card 4 — how to operate Intune at scale, what drift means here, how exclusions decay, and the assignment-loss problem that's been called out in every lesson but deserves explicit treatment.

## The assignment-loss problem, in full

Card 4 lesson 1 introduced this; it bears full treatment.

Intune templates come in three template-type families: Settings Catalog (`configurationPolicies`), Endpoint Security Intents (`intents`), and older Device Configurations (`deviceConfigurations`). When Panoptica365 deploys a template update across customer tenants, the underlying behaviour differs by type:

- **Settings Catalog policies** — in-place update via Graph API PATCH. The policy ID stays the same; assignments are preserved. Safe.
- **Device Configurations** — usually in-place update. Mostly safe.
- **Intents / Endpoint Security templates** — *delete-and-recreate*. The old policy is removed and a new one created. Any per-tenant assignment exclusions configured against the old policy ID are not transferred — they're silently lost.

Of the 14 templates in the Panoptica365 library, this delete-and-recreate behaviour affects **Account Protection Settings** specifically (the only Intents-style template in the library). It also affects any imported Intents-style templates the MSP adds (lesson 10).

Microsoft has been working on switching Endpoint Security templates to a true PATCH model rather than delete-recreate, but as of mid-2026 the behaviour persists. Until Microsoft fixes the underlying API, the operator's responsibility is to work around it manually.

The operational discipline:

**Before updating any Intents-style template across the fleet:**
1. Capture the current per-tenant assignments for the template by opening each affected customer's Intune portal and recording the assignment + exclusion groups manually. There is no fleet-wide deployment view in Panoptica365 today, so this is per-customer click-through work.
2. Note any non-default exclusions specifically. The standard "All Devices" assignment will redeploy correctly; bespoke per-customer exclusions are what get lost.

**After the update:**
3. Verify assignments on each affected customer tenant.
4. For any customer where exclusions are missing, restore them manually.

This is annoying, and there's no automated shortcut today — bulk-updating Intents-style templates across a fleet without the manual capture-and-replay step is a foot-cannon. Until Microsoft replaces the delete-recreate behaviour, the manual workflow is the only safe path.

For the typical operator, the practical takeaway: **before pushing any update to the Account Protection template** (or any imported Intents-style template), inventory the affected customers' exclusions. Don't bulk-update Intents-style templates without the replay step.

## Drift detection on Intune templates

Like CA, Intune templates drift over time. The drift categories are similar but the failure modes differ:

**State drift** — a template's deployment state changed unexpectedly. Less common in Intune than CA (Intune doesn't have a Report-only equivalent state that can flip the same way) but possible: a customer's other admin might have deleted a policy entirely, or scoped its assignment so narrowly that it no longer applies to anyone.

**Scope drift** — the assignment scope changed. New include groups added, exclude groups added, groups removed. This is the most consequential drift category for Intune because changing scope can dramatically change which devices the policy affects. A customer's other admin adding a broad exclusion group can effectively disable the policy without disabling it formally.

**Setting drift** — individual settings within a template changed. A specific setting was tuned per-customer (a Defender exclusion path added, a firewall rule adjusted, a Windows Hello PIN minimum loosened). These are the legitimate per-customer customisations that *should* drift — but the operator needs to know about them.

**Configuration value drift** — a Settings Catalog policy's value for a specific setting was changed centrally (a customer's admin clicked through and modified one specific value). Hardest to detect manually because the policy still looks "correct" at a high level; only setting-by-setting comparison catches it.

Panoptica365's drift detector covers all four categories for the 14 bundled templates. For imported custom templates (lesson 10), the operator's responsibility includes verifying drift detection is working — Panoptica365 surfaces drift for templates it has a reference for; if a custom template was imported into Panoptica365 properly, the reference is captured and drift detection works automatically.

The operator workflow for drift alerts:

1. **Acknowledge the alert** and identify the type (state / scope / setting / value).
2. **Identify the cause via audit log.** Who made the change, when, from what role.
3. **Decide: accept or revert.**
   - Legitimate per-customer customisation? Accept and update the reference (or accept that the customer has their own variant).
   - Unauthorised change or accidental modification? Revert to the template reference.
4. **Document the decision** in the customer's change log (Panoptica365 does this automatically).

## Exclusions — the persistent decay problem

Just like CA, Intune exclusions accumulate quietly. The mechanism that prevents it:

**Every exclusion has a sunset date.** When an operator adds a device or group to an Intune template's exclusion list, Panoptica365 prompts for a justification and an expiration date. Default expiration is 180 days; operator can adjust.

**Every exclusion is reviewed before expiration.** Panoptica365 alerts the responsible operator before the sunset date. Review: still needed? Renew with fresh justification? Or let it expire and bring the device back in scope?

**Group-based exclusions are audited periodically.** Excluding "Kiosk Devices" (an Entra group) means anyone added to that group later inherits the exclusion. The group membership can change without the template changing. Periodic audits of the group membership are part of the discipline.

The patterns to avoid:

- "Permanent exclusion" with no expiration. Nothing is permanent; templates change, devices change, regulations change. Permanent exclusions become invisible security gaps.
- "Exclude the IT department for convenience." If you're excluding admins from a hardening policy because they find it annoying, you've inverted the security model — the admins are the highest-value targets and need *more* hardening, not less.
- "Exclude one device for a specific incident, never re-include." A device excluded for a temporary technical reason often stays excluded forever because nobody remembers the reason.

The Panoptica365 exemption workflow makes adding exclusions slightly harder than ignoring them. That friction is intentional — it makes the bad patterns harder to commit to than the good ones.

## Lifecycle — how Intune templates evolve

A customer's Intune deployment evolves as their business does. Events that should trigger Intune template review:

- **New device platform introduced.** Customer acquires Mac fleet for a creative team. macOS templates need attention.
- **Major Windows feature update.** Windows 11 25H2 changes some settings' defaults; templates may need adjustment to enforce previous behaviours.
- **New compliance framework.** Customer signs a contract that demands CIS Microsoft 365 Foundations compliance; needs CIS-aligned templates imported.
- **Office moves or business expands.** New trusted IP ranges, new VPN endpoints, new business apps that need allowlisting.
- **Incident response.** Post-compromise, the customer's Intune posture typically hardens.
- **Customer downsizes or merges.** Device population changes; old templates may need cleanup.
- **Microsoft retires or replaces a feature.** Microsoft has been quietly retiring older Intune policy types in favour of Settings Catalog. Templates may need migration.

For each customer, an **annual Intune review** is the right cadence:

1. List all deployed Intune templates per customer.
2. For each template: still appropriate? Still needed? Settings still right?
3. Review exclusion lists. Each entry: still necessary? Sunset date still appropriate?
4. Review drift history. Were there changes in the past year that weren't fully resolved?
5. Compare against the current Panoptica365 bundled library. Templates the customer should be deploying but isn't? New templates added since last review?
6. Document the review.

This is the same annual-review cadence card 3 lesson 9 recommended for CA. Same principles apply: it's an operating discipline, not optional, billable to the customer as part of the security service.

## Licensing dependencies

Some Intune features require Intune Plan 2 (E3 or E5) rather than Intune Plan 1 (Business Premium). For the bundled Panoptica365 library, the templates work at Intune Plan 1 — they were curated to fit the Business Premium scope. But some advanced features the MSP might import don't:

- **Endpoint Privilege Management (EPM)** — local admin elevation control. Requires Intune Plan 2 / E5.
- **Remote Help** — Intune-integrated remote support. Requires Intune Plan 2 / E5.
- **Advanced Endpoint Analytics** — deeper telemetry. Requires Intune Plan 2 / E5.
- **Mobile Threat Defense integration** — third-party MTD partners. Requires Intune Plan 1 minimum but configuration varies.

When importing custom templates that depend on these features, verify the destination tenant has the licence. Deploying a Plan 2 feature to a Plan 1 tenant produces a silent failure — the policy exists but can't activate.

## What Panoptica365 surfaces

There is no single "operating-at-scale" view in Panoptica365 today that aggregates the fleet across customers — be honest about that with your team and don't promise one to your customers. The platform's read model is per-tenant, and the operator's at-scale workflow today is a mix of three things:

- **Drift alerts per template per customer.** Drift detection runs across deployed templates; when a customer's tenant diverges from the bundled (or imported) reference, an alert fires. This is the main "something changed somewhere across my fleet" signal Panoptica365 provides today.
- **The Exemptions section.** When an operator has approved exemptions across customer tenants, the Exemptions view lists them with the option to revoke. It's not a "pending review" queue — it's a record of what's been granted. The operator's discipline of periodically opening it and asking "are all of these still defensible?" is what turns it into a sunset workflow.
- **Per-tenant dashboards, one at a time.** Compliance count tile, devices list, Devices by OS — the same surface lesson 9 described. To do an "at-scale" review today, the operator clicks through tenants one by one.

What does *not* exist today, in case the rest of this lesson led you to expect it:

- A cross-customer "fleet compliance" aggregation
- A "template deployment state per customer per template" matrix view
- A "recent deployment activity across all customers" timeline
- A "devices in problematic compliance states" list
- An exclusion-review queue with sunset dates

The compliance-tile trend arrows give the operator a per-poll directional signal — useful for catching posture drift quickly without remembering yesterday's number. For now, that's the level of cross-customer visibility Panoptica365 provides; deeper aggregation requires the per-tenant click-through described above.

## The annual Intune review — recommended cadence

For each customer, once per year (commonly synchronised with the annual security review and renewal conversation):

1. **List all deployed Intune templates.** What's enabled, what's deployed in audit mode, what was deployed but isn't actively in use.
2. **For each template, verify it's still appropriate.** Conditions match the customer's current reality? Exclusions still defensible?
3. **Review the drift history.** What changed in the past year? Was each change properly resolved (accepted with reference updated, or reverted)?
4. **Compare against the current Panoptica365 library.** Bundled templates that should be deployed but aren't (newly added, recently updated)?
5. **Compare against the customer's current state.** Has the customer's environment changed (new platforms, new licences, new regulatory obligations) in ways that suggest new templates?
6. **Document the review.** The customer's IT director should have a record of the annual review and its conclusions.

This is operating discipline. It's the work that keeps the customer's Intune posture from decaying over years. It's billable as part of the MSP's security service — and it's what differentiates a careful MSP from one that deploys and forgets.

## What this means for the operator

Three takeaways.

**The assignment-loss problem is the most consequential operational pitfall in Intune.** Account Protection Settings (and any imported Intents-style template) requires the inventory-update-replay discipline. Skipping it is how customer exclusions evaporate without anyone noticing.

**Exclusion lists are silent debt.** They accumulate, they decay, they become invisible security gaps. The exemption workflow with sunset dates is the tool to fight this; use it.

**Annual review is non-negotiable.** Intune templates that were appropriate three years ago may not be appropriate today. Without a structured review cadence, customer Intune posture decays. Bill for the review; document it; make it visible to the customer.

## Closing card 4

You've now seen the 14 Panoptica365 Intune templates and the operational mechanics that turn them into a working endpoint hardening practice.

The arc of card 4:

1. Pre-flight for Intune templates — the discipline before any deployment.
2. Compliance policies — defining "compliant" across four platforms.
3. The Security Baseline — your curated Windows hardening bundle.
4. BitLocker Settings — disk encryption posture.
5. Defender for Endpoint configuration — Windows + macOS.
6. Firewall Settings — Windows network defence.
7. ASR Rules + Block mshta.exe — attack surface reduction.
8. Account Protection + Block MSA — credential hardening on the endpoint.
9. The compliance loop in production — drift, signals, monitoring.
10. Importing your own Intune templates — the customisation workflow.
11. Operating Intune at scale — drift, exclusions, lifecycle, the assignment-loss problem (this lesson).

Card 5 (Exchange / Email hardening) starts next. That card shifts from the endpoint to the email surface — the EXO settings that protect the channel attackers use most.

For now: card 4's templates have given you the Windows-side hardening foundation. The compliance loop signals into CA. The customer's endpoint posture goes from factory-default to genuinely-hardened with the bundled library deployed. The MSP that gets this right closes the largest single avenue of attack against SMB Windows fleets.

---

*Sources for the data points in this lesson — Microsoft Learn on Intune policy types and update behaviour ([Microsoft Learn — Intune policy types](https://learn.microsoft.com/en-us/mem/intune/configuration/device-profiles)); Endpoint Security templates and their update model ([Microsoft Learn — Endpoint security policy](https://learn.microsoft.com/en-us/mem/intune/protect/endpoint-security-policy)); Intune licence requirements per feature ([Microsoft Learn — Intune licensing](https://learn.microsoft.com/en-us/mem/intune/fundamentals/licenses)); Microsoft Graph API for policy assignment ([Microsoft Learn — Assignment resource type](https://learn.microsoft.com/en-us/graph/api/resources/intune-shared-deviceconfigurationassignment)).*
